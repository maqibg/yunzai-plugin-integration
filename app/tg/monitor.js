// TG 频道监听与转发核心模块 - 指令触发版本
// - 通过#tg指令手动触发获取频道新消息，将文本/图片/视频下载到本地
// - 按配置转发到 QQ 群/私聊
// - 支持代理、去重、媒体下载等功能
import plugin from '../../../../lib/plugins/plugin.js'
import common from '../../../../lib/common/common.js'
import axios from 'axios'
import { HttpsProxyAgent } from 'https-proxy-agent'
import fs from 'node:fs'
import path from 'node:path'
import tgSetting from '../../model/tg/tg-setting.js'

// 工具：确保目录存在
function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
}

// 工具：持久化状态（去重 / last_update_id）
const pluginRoot = path.join(process.cwd(), 'plugins', 'yunzai-plugin-integration')
const stateDir = path.join(pluginRoot, 'data', 'tg')
const stateFile = path.join(stateDir, 'state.json')
function loadState() {
  try {
    ensureDir(stateDir)
    if (!fs.existsSync(stateFile)) return { last_update_id: 0, processed: {} }
    const raw = fs.readFileSync(stateFile, 'utf8')
    return JSON.parse(raw)
  } catch (e) { return { last_update_id: 0, processed: {} } }
}
function saveState(s) { try { ensureDir(stateDir); fs.writeFileSync(stateFile, JSON.stringify(s, null, 2), 'utf8') } catch (e) {} }

// 工具：路径转 file:// 统一斜杠
function toFileUrl(p) { return 'file://' + p.replace(/\\/g, '/') }

// 文本内容过滤：按配置过滤 Telegram 域名等
function filterContent(text, config) {
  if (!text || typeof text !== 'string') return text
  const filters = config?.filters
  if (!filters?.enable) return text
  let out = text
  if (filters.remove_telegram_domains && Array.isArray(filters.telegram_domains)) {
    const parts = filters.telegram_domains
      .map(d => String(d).trim())
      .filter(Boolean)
      .map(d => d.replace(/\./g, '\\.'))
    if (parts.length) {
      const re = new RegExp(`https?:\\/\\/(?:${parts.join('|')})`, 'gi')
      out = out.replace(re, 'https://')
    }
  }
  return out
}

// 工具：将 Bot API 返回的 file_path 映射为宿主机持久化路径
// 规则：
// - 若 file_path 以 /var/lib/telegram-bot-api/ 开头，则去掉该前缀，直接拼接到挂载根目录
// - 若为相对路径（如 photos/file_123.jpg），则映射为 <root>/<botToken>/<file_path>
function mapBotApiFileToHost(baseDir, botToken, filePath) {
  const root = path.isAbsolute(baseDir)
    ? baseDir
    : path.join(process.cwd(), baseDir || path.join('plugins', 'yunzai-plugin-integration', 'model', 'tg', 'telegram-bot-api', 'telegram-bot-api-data'))

  const fp = String(filePath || '')
  const VAR_PREFIX = '/var/lib/telegram-bot-api/'
  let rel
  if (fp.startsWith(VAR_PREFIX)) {
    rel = fp.slice(VAR_PREFIX.length)
  } else if (fp.startsWith('/')) {
    // 其他绝对路径：去掉开头斜杠后作为相对路径处理
    rel = fp.replace(/^\/+/, '')
  } else {
    // 相对路径：挂到 token 目录下
    rel = path.join(String(botToken || '').trim(), fp)
  }

  // 防穿越
  const safeRel = rel.replace(/\\/g, '/').split('/').filter(p => p && p !== '.' && p !== '..').join(path.sep)
  return path.join(root, safeRel)
}

// 若持久化文件不存在，则通过 /file 路由触发容器缓存
async function ensurePersistentCached(base, token, filePath, proxy) {
  const url = `${base}/file/bot${token}/${filePath}`
  try {
    const agents = agentsForBase(base, proxy)
    await axios.get(url, { responseType: 'stream', ...agents, timeout: 15000 })
  } catch (e) {
    // 忽略触发失败，调用方将根据存在性决定是否跳过
  }
}

// 构造代理 Agent：仅支持 http/https（如配置为其它协议，将回退为 https）
function buildAgents(proxy) {
  if (!proxy || proxy.enable === false) return {}
  const { protocol = 'http', host = '127.0.0.1', port = 7890 } = proxy
  const url = `${protocol}://${host}:${port}`
  if (!['http', 'https'].includes(String(protocol).toLowerCase())) {
    logger.warn(`[TG] 仅支持 http/https 代理，已回退为 https 代理（当前 protocol=${protocol}）`)
  }
  const agent = new HttpsProxyAgent(url)
  return { httpAgent: agent, httpsAgent: agent }
}

// 识别是否本地端点（不走代理）
function isLocalBase(base) {
  try {
    const u = new URL(base)
    return ['127.0.0.1', 'localhost', '0.0.0.0'].includes(u.hostname)
  } catch (e) {
    return false
  }
}

// 针对不同端点返回合适的 agents
function agentsForBase(base, proxy) { return isLocalBase(base) ? {} : buildAgents(proxy) }

// 组装可用的 API 基址列表（首选 + 可选回退）
function getApiBases(cfg) {
  const api = cfg?.api || {}
  const prefer = (api.prefer || 'local').toLowerCase()
  const allowFallback = api.fallback_on_fail !== false
  const local = api.base_local || 'http://127.0.0.1:31956'
  const official = api.base_official || 'https://api.telegram.org'
  const list = []
  if (prefer === 'official') {
    list.push(official)
    if (allowFallback) list.push(local)
  } else {
    list.push(local)
    if (allowFallback) list.push(official)
  }
  // 去重
  return [...new Set(list.filter(Boolean))]
}

// 调用 Bot API（GET）并在失败时按配置回退；返回 { data, base }
async function botApiGet(method, params, cfg, proxy, token, signal, timeoutOverride) {
  const api = cfg?.api || {}
  const timeout = Number(api?.request?.timeout_ms || 15000)
  let lastErr = null
  for (const base of getApiBases(cfg)) {
    try {
      const agents = agentsForBase(base, proxy)
      const url = `${base}/bot${token}/${method}`
      const resp = await axios.get(url, { params, ...agents, timeout: timeoutOverride || timeout, signal })
      return { data: resp?.data, base }
    } catch (err) {
      lastErr = err
      logger.warn(`[TG] 调用 ${method} 失败，端点 ${base}：${err?.message || err}`)
      // 尝试下一个端点
    }
  }
  throw lastErr || new Error('Bot API 请求失败')
}

// 通过 TG API 下载文件到本地
async function downloadFile(fileUrl, savePath, agents) {
  const writer = fs.createWriteStream(savePath)
  const resp = await axios.get(fileUrl, { responseType: 'stream', ...agents })
  await new Promise((resolve, reject) => {
    resp.data.pipe(writer)
    writer.on('finish', resolve)
    writer.on('error', reject)
  })
}

// 解析消息成为一个 QQ 节点（直接读取容器持久化缓存，不再复制/下载）
async function buildNodeFromChannelPost(token, proxy, baseDir, post, agents, maxBytes, cfg) {
  const node = []
  const files = []

  // 文本（text 或 caption）- 应用过滤器
  const text = post.text || post.caption
  if (text) node.push(filterContent(text, cfg))

  // 图片：从同一张不同规格中，选择不超过上限的最大一张
  if (Array.isArray(post.photo) && post.photo.length) {
    let best = null
    // 按尺寸由小到大排序，取不超限的最大项
    const sorted = [...post.photo].sort((a, b) => (a.file_size || 0) - (b.file_size || 0))
    for (const p of sorted) {
      if (!maxBytes || !p.file_size || p.file_size <= maxBytes) best = p
    }
    if (!best) {
      node.push('(图片超过大小上限，已跳过)')
      return { node, files }
    }
    const fileId = best.file_id
    // 通过包装的 botApiGet 获取文件信息（携带 base 用于下载）
    const { data: gfData, base: usedBase } = await botApiGet('getFile', { file_id: fileId }, cfg, proxy, token)
    const filePath = gfData?.result?.file_path
    if (filePath) {
      const abs = mapBotApiFileToHost(baseDir, token, filePath)
      if (!fs.existsSync(abs)) await ensurePersistentCached(usedBase, token, filePath, proxy)
      if (fs.existsSync(abs)) { node.push(segment.image(toFileUrl(abs))); files.push(abs) }
      else { node.push('(图片缓存未就绪，已跳过)') }
    }
  }

  // 视频：≤上限时直传QQ，超过上限仅提示
  if (post.video) {
    if (maxBytes && post.video.file_size && post.video.file_size > maxBytes) {
      node.push('(视频超过大小上限，已跳过)')
      return { node, files }
    }
    const fileId = post.video.file_id
    const { data: gfData, base: usedBase } = await botApiGet('getFile', { file_id: fileId }, cfg, proxy, token)
    const filePath = gfData?.result?.file_path
    if (filePath) {
      const abs = mapBotApiFileToHost(baseDir, token, filePath)
      if (!fs.existsSync(abs)) await ensurePersistentCached(usedBase, token, filePath, proxy)
      if (fs.existsSync(abs)) {
        try {
          if (typeof segment.video === 'function') {
            node.push(segment.video(toFileUrl(abs)))
          } else {
            node.push(`(视频已缓存: ${path.basename(abs)})`)
          }
        } catch (e) {
          node.push(`(视频已缓存: ${path.basename(abs)})`)
        }
        files.push(abs)
      } else {
        node.push('(视频缓存未就绪，已跳过)')
      }
    }
  }

  // 文件文档：下载后作为文件或图片发送（≤ 上限）
  if (post.document) {
    const doc = post.document
    if (!maxBytes || !doc.file_size || doc.file_size <= maxBytes) {
      const fileId = doc.file_id
      const { data: gfData, base: usedBase } = await botApiGet('getFile', { file_id: fileId }, cfg, proxy, token)
      const filePath = gfData?.result?.file_path
      if (filePath) {
        const abs = mapBotApiFileToHost(baseDir, token, filePath)
        if (!fs.existsSync(abs)) await ensurePersistentCached(usedBase, token, filePath, proxy)
        if (fs.existsSync(abs)) {
          const mime = doc.mime_type || ''
          const lowerExt = (path.extname(abs) || '').toLowerCase()
          try {
            if (mime.startsWith('image/') || ['.jpg', '.jpeg', '.png', '.gif', '.webp'].includes(lowerExt)) node.push(segment.image(toFileUrl(abs)))
            else if (mime.startsWith('video/') || ['.mp4', '.mov', '.mkv', '.avi', '.webm'].includes(lowerExt)) {
              if (typeof segment.video === 'function') node.push(segment.video(toFileUrl(abs)))
              else node.push(`(视频已缓存: ${path.basename(abs)})`)
            } else {
              if (typeof segment.file === 'function') node.push(segment.file(toFileUrl(abs)))
              else node.push(`(文件已缓存: ${doc.file_name || path.basename(abs)})`)
            }
          } catch (e) {
            node.push(`(文件已缓存: ${doc.file_name || path.basename(abs)})`)
          }
          files.push(abs)
        } else {
          node.push('(文件缓存未就绪，已跳过)')
        }
      }
    } else {
      node.push('(文件超过大小上限，已跳过)')
    }
  }

  return { node, files }
}

// 处理音频消息
async function handleAudio(token, proxy, baseDir, post, agents, maxBytes, cfg) {
  const node = []
  const files = []
  if (!post.audio && !post.voice) return { node, files }
  
  const audio = post.audio || post.voice
  
  if (maxBytes && audio.file_size && audio.file_size > maxBytes) {
    node.push('(音频超过大小上限，已跳过)')
    return { node, files }
  }
  
  const fileId = audio.file_id
  const { data: gfData, base: usedBase } = await botApiGet('getFile', { file_id: fileId }, cfg, proxy, token)
  const filePath = gfData?.result?.file_path
  if (filePath) {
    const abs = mapBotApiFileToHost(baseDir, token, filePath)
    if (!fs.existsSync(abs)) await ensurePersistentCached(usedBase, token, filePath, proxy)
    if (fs.existsSync(abs)) {
      try {
        if (typeof segment.record === 'function') node.push(segment.record(toFileUrl(abs)))
        else if (typeof segment.file === 'function') node.push(segment.file(toFileUrl(abs)))
        else node.push(`(音频已缓存: ${audio.title || audio.file_name || path.basename(abs)})`)
      } catch (e) {
        node.push(`(音频已缓存: ${audio.title || audio.file_name || path.basename(abs)})`)
      }
      files.push(abs)
    } else {
      node.push('(音频缓存未就绪，已跳过)')
    }
  }
  
  return { node, files }
}

// 组装并发送合并转发到目标；目标 target: { type: 'group'|'user', id: number }
async function sendForwardToTarget(eCtx, target, list) {
  try {
    // 验证转发内容
    if (!list || list.length === 0) {
      logger.warn('[TG] 转发列表为空，跳过发送')
      return null
    }
    
    // 过滤空节点
    const validList = list.filter(item => item && Array.isArray(item) && item.length > 0)
    if (validList.length === 0) {
      logger.warn('[TG] 没有有效的转发内容，跳过发送')
      return null
    }
    
    logger.debug(`[TG] 准备转发 ${validList.length} 条消息到 ${target.type}:${target.id}`)
    
    // 完全按照yuki-plugin的方式构建forwardNodes
    const forwardNodes = []
    
    // 添加实际消息节点
    for (let item of validList) {
      forwardNodes.push({
        nickname: '瘤萎',
        user_id: String(80000000),  // 使用固定虚拟ID，字符串格式
        message: item,              // 保持数组格式
        time: Date.now()
      })
    }
    
    // 使用Bot.makeForwardMsg，如yuki-plugin
    const forwardMsg = await Bot.makeForwardMsg(forwardNodes)
    
    // 发送转发消息
    if (target.type === 'group') {
      const g = Bot.pickGroup(target.id)
      if (!g) {
        throw new Error(`群 ${target.id} 不存在或无法访问`)
      }
      return await g.sendMsg(forwardMsg)
    } else {
      const u = Bot.pickUser(target.id)
      if (!u) {
        throw new Error(`用户 ${target.id} 不存在或无法访问`)
      }
      return await u.sendMsg(forwardMsg)
    }
    
  } catch (error) {
    // 详细的错误信息
    logger.error(`[TG] 转发到 ${target.type}:${target.id} 失败`)
    logger.error(`[TG] 错误详情: ${error.message}`)
    if (error.stack) {
      logger.debug(`[TG] 错误堆栈: ${error.stack}`)
    }
    throw error
  }
}

// 为目标构造一个用于 makeForwardMsg 的上下文事件（最小化模拟）
function buildEventCtxForTarget(target) {
  if (target.type === 'group') {
    return { isGroup: true, group_id: target.id, group: Bot.pickGroup(target.id), bot: Bot }
  }
  return { isGroup: false, user_id: target.id, friend: Bot.pickUser(target.id), bot: Bot }
}

// 全局API请求锁 - 确保同一时刻只有一个getUpdates请求
class TelegramRequestManager {
  constructor() {
    this.isRequesting = false
    this.currentController = null
    this.processId = `${process.pid}_${Date.now()}`
  }
  
  async executeRequest(token, requestFn) {
    // 如果已有请求在进行，等待完成
    if (this.isRequesting) {
      logger.info('[TG] 等待当前请求完成...')
      let waitCount = 0
      while (this.isRequesting && waitCount < 100) { // 最多等待10秒
        await new Promise(resolve => setTimeout(resolve, 100))
        waitCount++
      }
    }
    
    this.isRequesting = true
    this.currentController = new AbortController()
    
    try {
      const result = await requestFn(this.currentController)
      return result
    } finally {
      this.isRequesting = false
      this.currentController = null
    }
  }
}

const telegramAPI = new TelegramRequestManager()

// 指令触发的TG消息拉取和转发
async function pullTelegramMessages(e) {
  try {
    const cfg = tgSetting.getConfig()
    const {
      token,
      proxy,
      batch = { size: 8 },
      dedup = { ttl_days: 7 },
      download = { dir: path.join('plugins', 'yunzai-plugin-integration', 'model', 'tg', 'telegram-bot-api', 'telegram-bot-api-data') },
      channels = []
    } = cfg || {}

    if (!token) {
      await e.reply('TG 未配置 token，无法拉取')
      return false
    }

    if (channels.length === 0) {
      await e.reply('TG 未配置监听频道，请先在配置文件中添加频道信息')
      return true  // 返回true表示正常结束，不是错误
    }

    logger.info('[TG] 开始手动拉取TG消息...')
    
    // 注意：官方端点请求可走代理；本地端点直连
    const agents = buildAgents(proxy)
    const baseDir = download.dir
    const state = loadState()
    const offset = state.last_update_id ? state.last_update_id + 1 : undefined

    // 拉取更新（短轮询，快速获取）
    const { data: updatesData } = await telegramAPI.executeRequest(token, async (controller) => {
      return await botApiGet('getUpdates', {
        timeout: 5, // 短轮询，5秒超时
        offset,
        // 支持群组(supergroup/group)与频道(channel)消息
        allowed_updates: ['message', 'channel_post']
      }, cfg, proxy, token, controller.signal, 15000)
    })

    const updates = Array.isArray(updatesData?.result) ? updatesData.result : []
    
    if (updates.length === 0) {
      await e.reply('TG 无新消息')
      logger.info('[TG] 拉取完成，无新消息')
      return true
    }

    logger.info(`[TG] 获取到 ${updates.length} 条消息，开始处理...`)

    // 处理消息
    const listByTarget = new Map()
    const groupByTarget = new Map()

    const chanArray = Array.isArray(channels) ? channels : []
    const matchers = chanArray.map(c => ({
      id: typeof c.id === 'string' ? c.id : Number(c.id),
      username: c.username,
      types: c.types || ['text', 'photo', 'video'],
      target: c.target
    }))

    let maxUpdateId = state.last_update_id || 0
    const processed = state.processed || {}
    const nowTs = Date.now()
    const ttlMs = (dedup.ttl_days || 7) * 24 * 3600 * 1000

    // 清理过期去重项
    for (const k of Object.keys(processed)) {
      if (nowTs - processed[k] > ttlMs) delete processed[k]
    }

    for (const upd of updates) {
      maxUpdateId = Math.max(maxUpdateId, Number(upd.update_id || 0))
      const post = upd.channel_post || upd.message
      if (!post || !post.chat) continue

      const chId = post.chat.id
      const chName = post.chat.username
      const rule = matchers.find(m => (m.id && String(m.id) === String(chId)) || (m.username && m.username === chName))
      if (!rule) continue

      const dedupKey = `${chId}:${post.message_id}`
      if (processed[dedupKey]) continue

      // 过滤类型
      const hasText = !!(post.text || post.caption)
      const hasPhoto = Array.isArray(post.photo) && post.photo.length > 0
      const hasVideo = !!post.video
      const hasDoc = !!post.document
      const hasAudio = !!(post.audio || post.voice)
      
      if ((hasText && !rule.types.includes('text')) || 
          (hasPhoto && !rule.types.includes('photo')) || 
          (hasVideo && !rule.types.includes('video')) || 
          (hasDoc && !rule.types.includes('document')) ||
          (hasAudio && !rule.types.includes('audio'))) {
        continue
      }

      try {
        const tKey = `${rule.target?.type}:${rule.target?.id}`
        if (!listByTarget.has(tKey)) {
          const eCtx = e || buildEventCtxForTarget(rule.target)
          listByTarget.set(tKey, { target: rule.target, eCtx, list: [], files: [] })
        }
        const maxBytes = Number((download && download.max_file_mb ? download.max_file_mb : 20)) * 1024 * 1024
        
        // 处理主要媒体内容
        const { node: mainNode, files: mainFiles } = await buildNodeFromChannelPost(token, proxy, baseDir, post, agents, maxBytes, cfg)
        
        // 处理音频内容
        const { node: audioNode, files: audioFiles } = await handleAudio(token, proxy, baseDir, post, agents, maxBytes, cfg)
        
        if (post.media_group_id) {
          if (!groupByTarget.has(tKey)) groupByTarget.set(tKey, new Map())
          const groups = groupByTarget.get(tKey)
          const gKey = `g:${post.media_group_id}`
          if (!groups.has(gKey)) groups.set(gKey, { node: [], files: [], hasText: false })
          const group = groups.get(gKey)
          
          const allNodes = [...mainNode, ...audioNode]
          const allFiles = [...mainFiles, ...audioFiles]
          
          if (allNodes.length === 0 && allFiles.length === 0) {
            processed[dedupKey] = nowTs
            continue
          }
          
          for (const part of allNodes) {
            if (typeof part === 'string') {
              if (!group.hasText) { group.node.push(part); group.hasText = true }
            } else {
              group.node.push(part)
            }
          }
          group.files.push(...allFiles)
          processed[dedupKey] = nowTs
        } else {
          const allNodes = [...mainNode, ...audioNode]
          const allFiles = [...mainFiles, ...audioFiles]
          
          if (!allNodes.length && allFiles.length === 0) {
            processed[dedupKey] = nowTs
            continue
          }
          const bucket = listByTarget.get(tKey)
          bucket.list.push(allNodes)
          bucket.files.push(...allFiles)
          processed[dedupKey] = nowTs
        }
      } catch (err) {
        const msg = err?.response?.data?.description || err?.message || '未知错误'
        logger.error(`[TG] 处理消息失败: ${msg}`)
      }
    }

    // 发送与清理
    let totalSent = 0
    for (const [tKey, item] of listByTarget) {
      let hadError = false
      if (groupByTarget.has(tKey)) {
        const groups = groupByTarget.get(tKey)
        for (const g of groups.values()) {
          if (g.node.length) item.list.push(g.node)
          if (g.files.length) item.files.push(...g.files)
        }
      }
      const size = Number((batch && batch.size) || 8)
      for (let i = 0; i < item.list.length; i += size) {
        const chunk = item.list.slice(i, i + size)
        try {
          await sendForwardToTarget(item.eCtx, item.target, chunk)
          totalSent += chunk.length
        } catch (err) {
          const msg = err?.response?.data?.description || err?.message || '未知错误'
          logger.error(`[TG] 合并转发发送失败: ${msg}`)
          hadError = true
        }
      }
      // 按策略清理：仅删除白名单目录内的已转发文件
      try {
        const cleanup = (cfg && cfg.cleanup) || {}
        const rootDir = path.isAbsolute(download.dir) ? download.dir : path.join(process.cwd(), download.dir)
        if (cleanup.delete_after_forward !== false && Array.isArray(item.files) && item.files.length) {
          const allowDirs = Array.isArray(cleanup.allow_dirs) && cleanup.allow_dirs.length ? cleanup.allow_dirs : ['photos','videos','documents','audio','voice','stickers','animations','temp']
          const allowSet = new Set(allowDirs)
          for (const abs of item.files) {
            try {
              if (!abs) continue
              const resolved = path.resolve(abs)
              const resolvedRoot = path.resolve(rootDir)
              if (!resolved.startsWith(resolvedRoot + path.sep)) { logger.warn(`[TG] 跳过清理(越界): ${abs}`); continue }
              const rel = path.relative(resolvedRoot, resolved)
              const segs = rel.split(path.sep)
              if (segs.length < 2) { logger.warn(`[TG] 跳过清理(层级异常): ${rel}`); continue }
              const subdir = segs[1]
              if (!allowSet.has(subdir)) { logger.warn(`[TG] 跳过清理(目录不在白名单): ${rel}`); continue }
              fs.unlinkSync(resolved)
              logger.info(`[TG] 已删除文件: ${rel}`)
            } catch (er) {
              logger.warn(`[TG] 删除文件失败: ${er.message}`)
            }
          }
        }
      } catch (er) {
        logger.warn(`[TG] 清理阶段异常: ${er.message}`)
      }
    }

    // 保存偏移与去重集
    state.last_update_id = maxUpdateId
    state.processed = processed
    saveState(state)

    const replyMsg = totalSent > 0 ? `TG 拉取完成，转发了 ${totalSent} 条消息` : 'TG 拉取完成，无新消息需转发'
    await e.reply(replyMsg)
    logger.info(`[TG] ${replyMsg}`)
    return true
    
  } catch (error) {
    const msg = error?.response?.data?.description || error?.message || '未知错误'
    logger.error(`[TG] 拉取失败: ${msg}`)
    await e.reply('TG 拉取失败，请查看日志')
    return false
  }
}

export default class TgMonitor extends plugin {
  constructor() {
    super({
      name: 'TG 监听与转发',
      dsc: '#tg 从 TG 频道拉取消息并转发到 QQ',
      event: 'message',
      priority: 500,
      rule: [
        { reg: '^#tg$', fnc: 'manualPull', permission: 'master' },
        { reg: '^#tg拉取$', fnc: 'manualPull', permission: 'master' },
        { reg: '^#拉取tg$', fnc: 'manualPull', permission: 'master' },
        { reg: '^#tg清理$', fnc: 'manualClean', permission: 'master' }
      ]
    })
  }

  // 手动拉取TG消息
  async manualPull(e) {
    if (!e.isMaster) {
      await e.reply('仅主人可用')
      return false
    }
    return await pullTelegramMessages(e)
  }

  // 手动清理缓存目录（仅主人可用）
  async manualClean(e) {
    try {
      if (!e.isMaster) {
        await e.reply('仅主人可用')
        return false
      }
      const cfg = tgSetting.getConfig()
      const download = cfg?.download || {}
      const cleanup = cfg?.cleanup || {}
      const rootDir = path.isAbsolute(download.dir) ? download.dir : path.join(process.cwd(), download.dir || path.join('plugins','yunzai-plugin-integration','model','tg','telegram-bot-api','telegram-bot-api-data'))
      const allowDirs = Array.isArray(cleanup.allow_dirs) && cleanup.allow_dirs.length ? cleanup.allow_dirs : ['photos','videos','documents','audio','voice','stickers','animations','temp']

      const statSafe = p => { try { return fs.statSync(p) } catch { return null } }
      const rmFilesRecursively = dir => {
        let removed = 0
        const s = statSafe(dir)
        if (!s || !s.isDirectory()) return 0
        for (const name of fs.readdirSync(dir)) {
          const fp = path.join(dir, name)
          const st = statSafe(fp)
          if (!st) continue
          if (st.isDirectory()) {
            removed += rmFilesRecursively(fp)
            // 保留空目录；如需删除空目录，可在此判断 fs.rmdirSync(fp)（可选）
          } else {
            try { fs.unlinkSync(fp); removed++ } catch {}
          }
        }
        return removed
      }

      const rootStat = statSafe(rootDir)
      if (!rootStat || !rootStat.isDirectory()) {
        await e.reply('缓存目录不存在，无需清理')
        return true
      }

      let total = 0, tokens = 0
      for (const tokenDir of fs.readdirSync(rootDir)) {
        const tokenPath = path.join(rootDir, tokenDir)
        const st = statSafe(tokenPath)
        if (!st || !st.isDirectory()) continue
        tokens++
        for (const sub of allowDirs) {
          const p = path.join(tokenPath, sub)
          total += rmFilesRecursively(p)
        }
      }
      const msg = `TG 清理完成，共扫描 ${tokens} 个令牌目录，删除 ${total} 个文件。`
      logger.info(`[TG] ${msg}`)
      await e.reply(msg)
      return true
    } catch (err) {
      logger.error(`[TG] 清理失败: ${err?.message || err}`)
      await e.reply('TG 清理失败，请查看日志')
      return false
    }
  }
}
