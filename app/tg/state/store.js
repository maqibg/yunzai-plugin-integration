import fs from 'node:fs'
import path from 'node:path'

const logger = globalThis.logger || console

const PLUGIN_ROOT = path.join(process.cwd(), 'plugins', 'yunzai-plugin-integration')
const STATE_DIR = path.join(PLUGIN_ROOT, 'data', 'tg')
const STATE_FILE = path.join(STATE_DIR, 'state.json')
const DEFAULT_STATE = { teelebot: { chats: {} }, local: { last_update_id: 0, chats: {} } }

// teelebot 持久化镜像目录（根据你的说明）
const TEELEBOT_MIRROR = path.join(PLUGIN_ROOT, 'model', 'tg', 'teelebot')
const TEELEBOT_STATE = path.join(TEELEBOT_MIRROR, 'plugins', 'TGDownloader', 'state.json')

export function loadState() {
  ensureDir(STATE_DIR)
  if (!fs.existsSync(STATE_FILE)) return JSON.parse(JSON.stringify(DEFAULT_STATE))
  try {
    const data = JSON.parse(fs.readFileSync(STATE_FILE,'utf8'))
    return normalizeState(data)
  } catch (e) {
    logger.warn('[TG] 读取状态失败，使用默认状态：' + e.message)
    return JSON.parse(JSON.stringify(DEFAULT_STATE))
  }
}

export function saveState(state) {
  ensureDir(STATE_DIR)
  const normalized = normalizeState(state)
  const tmp = STATE_FILE + '.tmp'
  fs.writeFileSync(tmp, JSON.stringify(normalized,null,2), 'utf8')
  fs.renameSync(tmp, STATE_FILE)
}

export async function syncTeelebotState(localDigest, chatKey) {
  try {
    // 确保镜像目录结构存在
    const dir = path.dirname(TEELEBOT_STATE)
    ensureDir(dir)

    let mirror = { digest: {} }
    if (fs.existsSync(TEELEBOT_STATE)) {
      try { mirror = JSON.parse(fs.readFileSync(TEELEBOT_STATE,'utf8')) || { digest: {} } } catch { mirror = { digest: {} } }
    }
    mirror.digest = mirror.digest || {}
    const old = mirror.digest[chatKey] || { last_message_id: 0, last_fetch_ts: 0, recent_signatures: [] }

    const newerIsLocal = Number(localDigest.last_fetch_ts || 0) >= Number(old.last_fetch_ts || 0)
    const base = newerIsLocal ? localDigest : old

    mirror.digest[chatKey] = {
      last_message_id: Math.max(Number(base.last_message_id||0), Number(old.last_message_id||0)),
      last_fetch_ts: Math.max(Number(base.last_fetch_ts||0), Number(old.last_fetch_ts||0)),
      recent_signatures: mergeSignaturesArray(old.recent_signatures||[], localDigest.recent_signatures||[])
    }

    const tmp = TEELEBOT_STATE + '.tmp'
    fs.writeFileSync(tmp, JSON.stringify(mirror,null,2), 'utf8')
    fs.renameSync(tmp, TEELEBOT_STATE)
  } catch (e) {
    logger.warn('[TG] 同步 teelebot 镜像状态失败：' + e.message)
  }
}

function mergeSignaturesArray(a,b){
  const arr = [...(a||[]), ...(b||[])].slice(-500)
  const seen = new Set()
  const out = []
  for (const it of arr){
    const key = it && it.sig
    if (!key || seen.has(key)) continue
    seen.add(key)
    out.push({ sig: key, ts: Number(it.ts||0) })
  }
  return out
}

function normalizeState(st) {
  const c = JSON.parse(JSON.stringify(DEFAULT_STATE))
  if (st && typeof st === 'object') {
    if (st.teelebot && typeof st.teelebot === 'object') c.teelebot.chats = st.teelebot.chats || {}
    if (st.local && typeof st.local === 'object') {
      c.local.last_update_id = st.local.last_update_id || 0
      c.local.chats = st.local.chats || {}
    }
  }
  return c
}

function ensureDir(d){ if (!fs.existsSync(d)) fs.mkdirSync(d,{recursive:true}) }
