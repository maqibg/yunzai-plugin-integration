import axios from 'axios'
import path from 'node:path'
import fs from 'node:fs'
import { sendForward } from '../format/qq.js'
import { mergeSignatures, getChatKey } from '../dedup/signature.js'

const logger = globalThis.logger || console

export async function pullByTeelebot(e, channel, limit, state, cloudCfg) {
  const endpoint = String(cloudCfg.api_endpoint || '').replace(/\/$/, '')
  if (!endpoint) throw new Error('未配置 cloud_teelebot.api_endpoint')

  const headers = {}
  if (cloudCfg.auth_token) headers.Authorization = `Bearer ${cloudCfg.auth_token}`
  const timeout = Number(cloudCfg.timeout || 30) * 1000

  const chatKey = getChatKey(channel)
  const tState = state.teelebot || (state.teelebot = { chats: {} })
  const chatState = tState.chats[chatKey] || { recent_signatures: [] }

    const idStr = ((channel.id ?? '') + '').trim()
  const userStr = ((channel.username ?? '') + '').replace(/^@/, '').trim()
  const chatId = idStr || userStr
  if (!chatId) throw new Error('频道配置缺少 id 或 username')

  const payload = {
    chat_id: chatId,
    limit,
    known_signatures: (chatState.recent_signatures || []).map(x => x.sig).filter(Boolean)
  }
  if (chatState.last_message_id) payload.min_message_id = chatState.last_message_id
  if (chatState.last_fetch_ts) payload.since_ts = chatState.last_fetch_ts

  const { data } = await axios.post(`${endpoint}/api/tg/pull`, payload, { headers, timeout })
  if (!data?.ok) throw new Error(data?.error || 'teelebot 返回失败')

  const downloadRoot = cloudCfg.download_root
    ? path.resolve(cloudCfg.download_root)
    : path.resolve(process.cwd(), 'plugins', 'teelebot', 'plugins', 'TGDownloader', 'download')

  const nodeList = []
  const cleanupSet = new Set()
  for (const item of data.messages || []) {
    const segs = buildSegmentsFromTeelebot(downloadRoot, item)
    if (segs.length) nodeList.push(segs)
    if (item.folder) cleanupSet.add(item.folder)
  }

  const forward = await sendForward(e, channel.target, nodeList)

  const digest = data.state || {}
  tState.chats[chatKey] = {
    last_message_id: Number(digest.last_message_id || chatState.last_message_id || 0),
    last_fetch_ts: Number(digest.last_fetch_ts || Date.now()),
    recent_signatures: mergeSignatures(chatState.recent_signatures || [], data.messages || []),
    updated_at: Date.now()
  }

  if (cleanupSet.size) {
    try {
      await axios.post(`${endpoint}/api/tg/cleanup`, { paths: Array.from(cleanupSet) }, { headers, timeout })
    } catch (err) {
      logger.warn('[TG] 清理 teelebot 导出目录失败：' + err.message)
    }
  }

  return { sent: forward.sent, skipped: (data.failed || []).length }
}

function buildSegmentsFromTeelebot(root, item) {
  const segs = []
  if (item.text) segs.push(item.text)
  if (item.caption && item.caption !== item.text) segs.push(item.caption)
  for (const f of item.files || []) {
    try {
      const abs = path.resolve(root, item.folder || '', f.path || '')
      if (!abs.startsWith(path.resolve(root))) throw new Error('非法路径')
      if (!fs.existsSync(abs)) continue
      segs.push(createFileSegment(abs, f.name))
    } catch (err) {
      // 忽略单文件失败
    }
  }
  return segs.filter(Boolean).flat()
}

function createFileSegment(absPath, fileName) {
  const ext = path.extname(fileName || absPath).toLowerCase()
  const seg = globalThis.segment || {}
  if (['.jpg','.jpeg','.png','.gif','.bmp','.webp'].includes(ext)) return seg.image ? seg.image(absPath) : absPath
  if (['.mp4','.mov','.mkv','.avi'].includes(ext)) return seg.video ? seg.video(absPath) : absPath
  if (['.mp3','.ogg','.wav','.m4a'].includes(ext)) return seg.record ? seg.record(absPath) : absPath
  return seg.file ? seg.file(absPath) : [`[文件] ${fileName || path.basename(absPath)}`, absPath]
}


