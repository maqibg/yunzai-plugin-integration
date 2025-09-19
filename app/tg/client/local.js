import axios from 'axios'
import fs from 'node:fs'
import path from 'node:path'
import { sendForward } from '../format/qq.js'
import { getChatKey, mergeSignatures, computeSignature } from '../dedup/signature.js'
import { syncTeelebotState } from '../state/store.js'

const logger = globalThis.logger || console

// 本地 Telegram Bot 模式：getUpdates + getFile 下载，提供 teelebot 不可用时的降级能力
export async function pullByLocal(e, channel, limit, state, cfg) {
  const token = String(cfg?.token || '').trim()
  if (!token) throw new Error('未配置 Telegram Bot token')

  const api = (method, params = {}) => callTelegramAPI(token, method, params, cfg)

  const chatKey = getChatKey(channel)
  const lState = state.local || (state.local = { last_update_id: 0, chats: {} })
  const chatState = lState.chats[chatKey] || { recent_signatures: [] }

  const offset = Number(lState.last_update_id || 0) + 1
  const updates = await api('getUpdates', { offset, limit: Math.min(100, Math.max(limit, 1)), timeout: 0 })

  const messages = []
  let maxUpdateId = lState.last_update_id || 0
  let maxMessageId = 0

  for (const u of updates) {
    maxUpdateId = Math.max(maxUpdateId, Number(u.update_id || 0))
    const m = u.channel_post || u.message
    if (!m || !m.chat) continue

    const matchId = channel.id !== undefined ? String(channel.id) : null
    const matchUser = channel.username ? String(channel.username).replace(/^@/, '') : null
    const chatId = String(m.chat.id)
    const chatUser = m.chat.username ? String(m.chat.username) : null
    const matched = (matchId && chatId === matchId) || (matchUser && chatUser && chatUser === matchUser)
    if (!matched) continue

    messages.push(m)
    maxMessageId = Math.max(maxMessageId, Number(m.message_id || 0))
  }

  const nodeList = []
  let skipped = 0

  for (const m of messages.slice(-limit)) {
    const sig = computeSignature(chatKey, normalizeMessageForSig(m))
    const seen = new Set((chatState.recent_signatures || []).map(x => x.sig))
    if (seen.has(sig)) { skipped++; continue }

    const segs = await buildSegmentsFromLocal(api, cfg, chatKey, m, token)
    if (segs.length) nodeList.push(segs)
  }

  const forward = nodeList.length ? await sendForward(e, channel.target, nodeList) : { sent: 0 }

  lState.last_update_id = maxUpdateId
  lState.chats[chatKey] = {
    last_message_id: maxMessageId,
    last_fetch_ts: Date.now(),
    recent_signatures: mergeSignatures(chatState.recent_signatures || [], nodeList.length ? messages : []),
    updated_at: Date.now()
  }

  try { await syncTeelebotState(lState.chats[chatKey], chatKey) } catch {}

  // TTL 清理下载目录（可选）
  try { await ttlCleanup(cfg) } catch {}

  return { sent: forward.sent || 0, skipped }
}

async function callTelegramAPI(token, method, params, cfg) {
  const base = `https://api.telegram.org/bot${token}`
  const url = `${base}/${method}`
  const timeout = 30000
  const axiosCfg = { method: 'get', url, timeout, params }

  const p = cfg?.proxy
  if (p?.enable && p?.host && p?.port) {
    axiosCfg.proxy = { host: p.host, port: Number(p.port), protocol: (p.protocol || 'http') }
  }

  return await withBackoff(async () => {
    const { data } = await axios(axiosCfg)
    if (!data?.ok) {
      const err = new Error(data?.description || `Telegram API 失败: ${method}`)
      err.response = { status: 400 }
      throw err
    }
    return data.result || []
  })
}

async function buildSegmentsFromLocal(api, cfg, chatKey, m, token) {
  const segs = []
  if (m.text) segs.push(m.text)
  if (m.caption && m.caption !== m.text) segs.push(m.caption)

  const maxMb = Number(cfg?.download?.max_file_mb || 20)
  const dlRoot = path.resolve(process.cwd(), cfg?.download?.dir || 'plugins/yunzai-plugin-integration/data/temp/tg')
  const saveDir = path.join(dlRoot, sanitize(chatKey))
  ensureDir(saveDir)

  const files = []
  if (Array.isArray(m.photo) && m.photo.length) {
    const best = m.photo.slice().sort((a,b) => (b.file_size||0)-(a.file_size||0))[0]
    if (best) files.push({ type: 'photo', file_id: best.file_id, file_unique_id: best.file_unique_id, file_size: best.file_size })
  }
  if (m.document) files.push({ type: 'document', file_id: m.document.file_id, file_unique_id: m.document.file_unique_id, file_name: m.document.file_name, file_size: m.document.file_size })
  if (m.video) files.push({ type: 'video', file_id: m.video.file_id, file_unique_id: m.video.file_unique_id, file_name: m.video.file_name, file_size: m.video.file_size })
  if (m.audio) files.push({ type: 'audio', file_id: m.audio.file_id, file_unique_id: m.audio.file_unique_id, file_name: m.audio.file_name, file_size: m.audio.file_size })

  for (const f of files) {
    try {
      if (f.file_size && f.file_size > maxMb * 1024 * 1024) continue
      const info = await api('getFile', { file_id: f.file_id })
      const fp = info?.file_path
      if (!fp) continue
      const fileUrl = `https://api.telegram.org/file/bot${token}/${fp}`
      const filename = f.file_name || path.basename(fp)
      const abs = path.join(saveDir, sanitize(filename))
      const root = path.resolve(saveDir)
      const absNorm = path.resolve(abs)
      if (!absNorm.startsWith(root)) throw new Error('非法路径')

      await downloadWithBackoff(fileUrl, abs)
      segs.push(createFileSegment(abs, filename))
    } catch (err) {
      logger.warn('[TG] 本地下载失败: ' + err.message)
    }
  }
  return segs.filter(Boolean).flat()
}

async function downloadWithBackoff(url, filepath) {
  await withBackoff(async () => {
    const { data } = await axios({ url, method: 'get', responseType: 'stream', timeout: 300000 })
    await new Promise((resolve, reject) => {
      const ws = fs.createWriteStream(filepath)
      data.pipe(ws)
      ws.on('finish', resolve)
      ws.on('error', reject)
    })
  })
}

async function withBackoff(fn) {
  try {
    return await fn()
  } catch (err1) {
    const status = err1?.response?.status
    const isTimeout = (err1?.code === 'ECONNABORTED') || /timeout/i.test(String(err1?.message||''))
    // 退避策略：429 → 20s；5xx/超时 → 2s；最多一次重试
    const delayMs = status === 429 ? 20000 : ((status >= 500 || isTimeout) ? 2000 : 0)
    if (delayMs === 0) throw err1
    await new Promise(r => setTimeout(r, delayMs))
    return await fn()
  }
}

async function ttlCleanup(cfg){
  const enable = cfg?.download?.auto_cleanup
  const days = Number(cfg?.download?.cleanup_days || 0)
  const root = cfg?.download?.dir ? path.resolve(process.cwd(), cfg.download.dir) : path.resolve(process.cwd(), 'plugins/yunzai-plugin-integration/data/temp/tg')
  if (!enable || !days || days < 1) return
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000
  try {
    if (!fs.existsSync(root)) return
    const entries = fs.readdirSync(root)
    for (const name of entries){
      const abs = path.resolve(root, name)
      if (!abs.startsWith(root)) continue
      let stat
      try { stat = fs.statSync(abs) } catch { continue }
      if (stat.isDirectory()) {
        // 清理目录内过期文件，若空再删目录
        cleanupDir(abs, cutoff)
        try { if (isEmpty(abs)) fs.rmdirSync(abs) } catch {}
      } else {
        if (stat.mtimeMs < cutoff) { try { fs.unlinkSync(abs) } catch {} }
      }
    }
  } catch {}
}

function cleanupDir(dir, cutoff){
  for (const name of fs.readdirSync(dir)){
    const p = path.join(dir, name)
    let s
    try { s = fs.statSync(p) } catch { continue }
    if (s.isDirectory()) cleanupDir(p, cutoff)
    else if (s.mtimeMs < cutoff) { try { fs.unlinkSync(p) } catch {} }
  }
}

function isEmpty(dir){
  try { return fs.readdirSync(dir).length === 0 } catch { return true }
}

function createFileSegment(absPath, fileName) {
  const ext = path.extname(fileName || absPath).toLowerCase()
  const seg = globalThis.segment || {}
  if (['.jpg','.jpeg','.png','.gif','.bmp','.webp'].includes(ext)) return seg.image ? seg.image(absPath) : absPath
  if (['.mp4','.mov','.mkv','.avi'].includes(ext)) return seg.video ? seg.video(absPath) : absPath
  if (['.mp3','.ogg','.wav','.m4a'].includes(ext)) return seg.record ? seg.record(absPath) : absPath
  return seg.file ? seg.file(absPath) : [`[文件] ${fileName || path.basename(absPath)}`, absPath]
}

function ensureDir(d){ if (!fs.existsSync(d)) fs.mkdirSync(d,{recursive:true}) }
function sanitize(s){ return String(s||'').replace(/[^a-zA-Z0-9._-]+/g,'_') }

function normalizeMessageForSig(m){
  const base = { message_id: m.message_id, media_group_id: m.media_group_id, text: m.text, caption: m.caption, attachments: [] }
  if (Array.isArray(m.photo)) base.attachments.push(...m.photo.map(p=>({ file_unique_id: p.file_unique_id })))
  if (m.document) base.attachments.push({ file_unique_id: m.document.file_unique_id })
  if (m.video) base.attachments.push({ file_unique_id: m.video.file_unique_id })
  if (m.audio) base.attachments.push({ file_unique_id: m.audio.file_unique_id })
  return base
}
