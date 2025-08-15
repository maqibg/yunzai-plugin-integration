// TG 频道监听与转发核心模块
// - 通过 getUpdates 监听频道新消息，将文本/图片/视频下载到本地
// - 按配置聚合并合并转发到 QQ 群/私聊
// - 支持代理、去重、手动指令 #tg拉取 与可选定时轮询
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

// 工具：按通道与日期生成保存路径
function buildDownloadDir(baseDir, channelKey) {
  const date = new Date()
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  const dir = path.join(process.cwd(), baseDir || path.join('plugins', 'yunzai-plugin-integration', 'data', 'temp', 'tg'), String(channelKey), `${y}${m}${d}`)
  ensureDir(dir)
  return dir
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

// 解析消息成为一个 QQ 节点（含文本 + 图片/视频占位）与对应临时文件路径
// - maxBytes: 单文件大小上限（字节），超过则跳过下载
// - config: 配置对象，用于过滤内容
async function buildNodeFromChannelPost(token, proxy, baseDir, post, agents, maxBytes, config) {
  const node = []
  const files = []
  const channelKey = post.chat?.id || post.chat?.username || 'unknown'
  const saveBase = buildDownloadDir(baseDir, channelKey)

  // 文本（text 或 caption）- 应用过滤器
  const text = post.text || post.caption
  if (text) {
    // 这里需要获取配置来过滤内容，但避免重复读取配置
    // 将在调用处传入配置
    const filteredText = filterContent(text, config)
    node.push(filteredText)
  }

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
    // getFile
    const getFile = await axios.get(`https://api.telegram.org/bot${token}/getFile`, { params: { file_id: fileId }, ...agents })
    const filePath = getFile?.data?.result?.file_path
    if (filePath) {
      const ext = path.extname(filePath) || '.jpg'
      const savePath = path.join(saveBase, `m${post.message_id}_p0${ext}`)
      const fileUrl = `https://api.telegram.org/file/bot${token}/${filePath}`
      await downloadFile(fileUrl, savePath, agents)
      node.push(segment.image(toFileUrl(savePath)))
      files.push(savePath)
    }
  }

  // 视频：≤上限时直传QQ，超过上限仅提示
  if (post.video) {
    if (maxBytes && post.video.file_size && post.video.file_size > maxBytes) {
      node.push('(视频超过大小上限，已跳过)')
      return { node, files }
    }
    const fileId = post.video.file_id
    const getFile = await axios.get(`https://api.telegram.org/bot${token}/getFile`, { params: { file_id: fileId }, ...agents })
    const filePath = getFile?.data?.result?.file_path
    if (filePath) {
      const ext = path.extname(filePath) || '.mp4'
      const savePath = path.join(saveBase, `m${post.message_id}_v0${ext}`)
      const fileUrl = `https://api.telegram.org/file/bot${token}/${filePath}`
      await downloadFile(fileUrl, savePath, agents)
      // 尝试以视频格式发送到QQ，失败则回退为文本提示
      try {
        if (typeof segment.video === 'function') {
          node.push(segment.video(toFileUrl(savePath)))
        } else {
          node.push(`(视频已保存: ${savePath})`)
        }
      } catch (e) {
        node.push(`(视频已保存: ${savePath})`)
      }
      files.push(savePath)
    }
  }

  // 文件文档：下载后作为文件或图片发送（≤ 上限）
  if (post.document) {
    const doc = post.document
    if (!maxBytes || !doc.file_size || doc.file_size <= maxBytes) {
      const fileId = doc.file_id
      const getFile = await axios.get(`https://api.telegram.org/bot${token}/getFile`, { params: { file_id: fileId }, ...agents })
      const filePath = getFile?.data?.result?.file_path
      if (filePath) {
        // 计算扩展名
        let ext = path.extname(filePath)
        if (!ext) {
          const nameExt = path.extname(doc.file_name || '')
          ext = nameExt || '.bin'
        }
        const savePath = path.join(saveBase, `m${post.message_id}_d0${ext}`)
        const fileUrl = `https://api.telegram.org/file/bot${token}/${filePath}`
        await downloadFile(fileUrl, savePath, agents)
        // 根据类型选择片段：图片优先按图片段发送；视频按视频段；其他按文件段；都不支持则回退文本
        const mime = doc.mime_type || ''
        const lowerExt = (ext || '').toLowerCase()
        try {
          if (mime.startsWith('image/') || ['.jpg', '.jpeg', '.png', '.gif', '.webp'].includes(lowerExt)) {
            node.push(segment.image(toFileUrl(savePath)))
          } else if (mime.startsWith('video/') || ['.mp4', '.mov', '.mkv', '.avi', '.webm'].includes(lowerExt)) {
            if (typeof segment.video === 'function') {
              node.push(segment.video(toFileUrl(savePath)))
            } else {
              node.push(`(视频已保存: ${savePath})`)
            }
          } else {
            // 尝试作为文件发送，失败则文本提示
            if (typeof segment.file === 'function') {
              node.push(segment.file(toFileUrl(savePath)))
            } else {
              node.push(`(文件已保存: ${doc.file_name || path.basename(savePath)})`)
            }
          }
        } catch (e) {
          // 任何发送失败都回退为文本提示
          node.push(`(文件已保存: ${doc.file_name || path.basename(savePath)})`)
        }
        files.push(savePath)
      }
    } else {
      node.push('(文件超过大小上限，已跳过)')
    }
  }

  return { node, files }
}

// 处理音频消息
async function handleAudio(token, proxy, baseDir, post, agents, maxBytes) {
  const node = []
  const files = []
  if (!post.audio && !post.voice) return { node, files }
  
  const audio = post.audio || post.voice
  const channelKey = post.chat?.id || post.chat?.username || 'unknown'
  const saveBase = buildDownloadDir(baseDir, channelKey)
  
  if (maxBytes && audio.file_size && audio.file_size > maxBytes) {
    node.push('(音频超过大小上限，已跳过)')
    return { node, files }
  }
  
  const fileId = audio.file_id
  const getFile = await axios.get(`https://api.telegram.org/bot${token}/getFile`, { params: { file_id: fileId }, ...agents })
  const filePath = getFile?.data?.result?.file_path
  if (filePath) {
    const ext = path.extname(filePath) || (post.voice ? '.ogg' : '.mp3')
    const savePath = path.join(saveBase, `m${post.message_id}_a0${ext}`)
    const fileUrl = `https://api.telegram.org/file/bot${token}/${filePath}`
    await downloadFile(fileUrl, savePath, agents)
    
    try {
      if (typeof segment.record === 'function') {
        node.push(segment.record(toFileUrl(savePath)))
      } else if (typeof segment.file === 'function') {
        node.push(segment.file(toFileUrl(savePath)))
      } else {
        node.push(`(音频已保存: ${audio.title || audio.file_name || path.basename(savePath)})`)
      }
    } catch (e) {
      node.push(`(音频已保存: ${audio.title || audio.file_name || path.basename(savePath)})`)
    }
    files.push(savePath)
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
    
    // 构造转发消息格式，参考指令表的实现
    let forwardMessages = []
    for (let item of validList) {
      // 将数组内容合并为单个消息，参考指令表的格式
      forwardMessages.push({
        message: item, // 直接使用数组，让Bot.makeForwardMsg处理
        nickname: Bot.nickname || '云崽',
        user_id: Bot.uin
      })
    }
    
    // 使用Bot.makeForwardMsg
    const forward = await Bot.makeForwardMsg(forwardMessages)
    
    // 关键修改：使用事件上下文发送，而不是直接pickGroup
    if (eCtx && typeof eCtx.reply === 'function') {
      // 有事件上下文时，直接通过上下文发送
      return await eCtx.reply(forward, false, {recallMsg: 0})
    } else {
      // 没有事件上下文时，构造最小化的发送方式
      if (target.type === 'group') {
        const g = Bot.pickGroup(target.id)
        if (!g) {
          throw new Error(`群 ${target.id} 不存在或无法访问`)
        }
        return await g.sendMsg(forward)
      } else {
        const u = Bot.pickUser(target.id)
        if (!u) {
          throw new Error(`用户 ${target.id} 不存在或无法访问`)
        }
        return await u.sendMsg(forward)
      }
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

// 全局请求管理 - 大循环状态管理
let schedulerState = { 
  isManualMode: false,     // 是否处于手动模式
  timerRef: null,          // 定时器引用
  currentCycle: 0,         // 当前小循环计数
  totalCycles: 0,          // 总小循环次数
  collectedUpdates: [],    // 收集的消息缓存
  collectedTargets: new Map() // 收集的目标数据 key: targetKey, value: {target, eCtx, list, files}
}

// 全局Token锁 - 防止多个Bot实例使用同一Token
const globalTokenLocks = new Map() // token -> { lockTime, processId }

// 全局API请求锁 - 确保同一时刻只有一个getUpdates请求
class TelegramRequestManager {
  constructor() {
    this.isRequesting = false
    this.currentController = null
    this.processId = `${process.pid}_${Date.now()}`
  }
  
  // 检查Token锁
  checkTokenLock(token) {
    const lockKey = `tg_${token.slice(-10)}` // 使用Token后10位作为锁标识
    const lockInfo = globalTokenLocks.get(lockKey)
    const now = Date.now()
    
    if (lockInfo && lockInfo.processId !== this.processId) {
      // 检查锁是否过期（5分钟）
      if (now - lockInfo.lockTime < 5 * 60 * 1000) {
        throw new Error(`Token被其他实例占用: ${lockInfo.processId}`)
      }
    }
    
    // 获取或续期锁
    globalTokenLocks.set(lockKey, {
      lockTime: now,
      processId: this.processId
    })
  }
  
  async executeRequest(token, requestFn) {
    // 检查Token锁
    try {
      this.checkTokenLock(token)
    } catch (error) {
      logger.warn(`[TG] ${error.message}`)
      throw new Error('Bot Token被其他实例使用，请检查是否有重复运行')
    }
    
    // 如果已有请求在进行，取消当前请求
    if (this.isRequesting && this.currentController) {
      logger.info('[TG] 取消当前请求，执行新请求')
      this.currentController.abort()
      // 等待取消完成
      await new Promise(resolve => setTimeout(resolve, 200))
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
  
  // 获取当前请求状态
  isActive() {
    return this.isRequesting
  }
}

const telegramAPI = new TelegramRequestManager()

// 内容过滤器
function filterContent(text, config) {
  if (!text || typeof text !== 'string') return text
  
  const filters = config?.filters
  if (!filters?.enable) return text
  
  let filteredText = text
  
  // 过滤Telegram域名
  if (filters.remove_telegram_domains && Array.isArray(filters.telegram_domains)) {
    for (const domain of filters.telegram_domains) {
      // 创建正则：匹配 https://domain 或 http://domain，保留路径
      const regex = new RegExp(`https?://${domain.replace('.', '\\.')}`, 'gi')
      filteredText = filteredText.replace(regex, 'https://')
    }
  }
  
  return filteredText
}

// 日志工具函数
function logDebug(config, message) {
  if (config?.logging?.detailed) {
    logger.debug(message)
  }
}

function logCycle(config, message) {
  if (config?.logging?.show_cycles !== false) {
    logger.info(message)
  }
}

// 收集消息到大循环缓存，不立即发送
async function collectUpdates(e = null, options = {}) {
  const { timeout = 30 } = options
  
  try {
    const cfg = tgSetting.getConfig()
    const {
      token,
      proxy,
      polling = {},
      batch = { size: 8 },
      dedup = { ttl_days: 7 },
      download = { dir: path.join('plugins', 'yunzai-plugin-integration', 'data', 'temp', 'tg') },
      channels = []
    } = cfg || {}

    if (!token) {
      if (e) await e.reply('TG 未配置 token，无法拉取')
      return false
    }

    const agents = buildAgents(proxy)
    const state = loadState()
    const offset = state.last_update_id ? state.last_update_id + 1 : undefined

    // 拉取更新
    const resp = await telegramAPI.executeRequest(token, async (controller) => {
      return await axios.get(`https://api.telegram.org/bot${token}/getUpdates`, {
        params: {
          timeout: timeout,
          offset,
          allowed_updates: ['channel_post', 'edited_channel_post']
        },
        ...agents,
        timeout: Math.max(1000 * (timeout + 10), 20000),
        signal: controller.signal
      })
    })

    const updates = Array.isArray(resp?.data?.result) ? resp.data.result : []
    
    if (updates.length === 0) {
      logDebug(cfg, '[TG] 小循环无新消息')
      return true
    }

    logDebug(cfg, `[TG] 小循环收集到 ${updates.length} 条消息`)

    // 处理消息但不发送，只收集
    const chanArray = Array.isArray(channels) ? channels : []
    const includeSingle = cfg.channelId || cfg.channel_id
    if (includeSingle) {
      chanArray.push({ id: includeSingle, types: ['text', 'photo', 'video'], target: { type: cfg.targetType || 'group', id: cfg.targetId } })
    }

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
      const post = upd.channel_post
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
        
        // 获取或创建目标收集器
        if (!schedulerState.collectedTargets.has(tKey)) {
          const eCtx = e || buildEventCtxForTarget(rule.target)
          schedulerState.collectedTargets.set(tKey, { 
            target: rule.target, 
            eCtx, 
            list: [], 
            files: [],
            groups: new Map() 
          })
        }
        
        const targetData = schedulerState.collectedTargets.get(tKey)
        const maxBytes = Number((download && download.max_file_mb ? download.max_file_mb : 20)) * 1024 * 1024
        
        // 处理媒体内容
        const { node: mainNode, files: mainFiles } = await buildNodeFromChannelPost(token, proxy, download.dir, post, agents, maxBytes, cfg)
        const { node: audioNode, files: audioFiles } = await handleAudio(token, proxy, download.dir, post, agents, maxBytes)
        
        if (post.media_group_id) {
          // 相册处理
          const gKey = `g:${post.media_group_id}`
          if (!targetData.groups.has(gKey)) {
            targetData.groups.set(gKey, { node: [], files: [], hasText: false })
          }
          const group = targetData.groups.get(gKey)
          
          const allNodes = [...mainNode, ...audioNode]
          const allFiles = [...mainFiles, ...audioFiles]
          
          for (const part of allNodes) {
            if (typeof part === 'string') {
              if (!group.hasText) { group.node.push(part); group.hasText = true }
            } else {
              group.node.push(part)
            }
          }
          group.files.push(...allFiles)
        } else {
          // 普通消息
          const allNodes = [...mainNode, ...audioNode]
          const allFiles = [...mainFiles, ...audioFiles]
          
          if (allNodes.length || allFiles.length) {
            targetData.list.push(allNodes)
            targetData.files.push(...allFiles)
          }
        }
        
        processed[dedupKey] = nowTs
      } catch (err) {
        const msg = err?.response?.data?.description || err?.message || '未知错误'
        logger.error(`[TG] 处理消息失败: ${msg}`)
      }
    }

    // 保存状态
    state.last_update_id = maxUpdateId
    state.processed = processed
    saveState(state)

    return true
    
  } catch (error) {
    if (error.name === 'AbortError' || error.code === 'ABORT_ERR') {
      logger.debug('[TG] 请求被取消（正常行为）')
      return false
    }
    throw error
  }
}

// 发送所有收集的消息并清理
async function sendCollectedMessages() {
  if (schedulerState.collectedTargets.size === 0) {
    logger.debug('[TG] 大循环结束，无收集的消息')
    return
  }

  const cfg = tgSetting.getConfig()
  const batchSize = Number(cfg?.batch?.size || 8)
  let totalSent = 0

  for (const [tKey, targetData] of schedulerState.collectedTargets) {
    // 将相册组追加为节点
    if (targetData.groups && targetData.groups.size > 0) {
      for (const g of targetData.groups.values()) {
        if (g.node.length) targetData.list.push(g.node)
        if (g.files.length) targetData.files.push(...g.files)
      }
    }

    if (targetData.list.length === 0) continue

    // 分批发送
    for (let i = 0; i < targetData.list.length; i += batchSize) {
      const chunk = targetData.list.slice(i, i + batchSize)
      try {
        await sendForwardToTarget(targetData.eCtx, targetData.target, chunk)
        totalSent += chunk.length
      } catch (err) {
        const msg = err?.response?.data?.description || err?.message || '未知错误'
        logger.error(`[TG] 大循环转发失败: ${msg}`)
      }
    }

    // 清理临时文件
    for (const f of targetData.files) {
      try { fs.unlinkSync(f) } catch {}
    }
  }

  logger.info(`[TG] 大循环结束，发送 ${totalSent} 条消息`)
  
  // 清空收集的数据
  schedulerState.collectedTargets.clear()
}

async function performDirectPull(e = null, options = {}) {
  const { timeout = 30 } = options
  
  try {
    const cfg = tgSetting.getConfig()
    const {
      token,
      proxy,
      polling = {},
      batch = { size: 8 },
      dedup = { ttl_days: 7 },
      download = { dir: path.join('plugins', 'yunzai-plugin-integration', 'data', 'temp', 'tg') },
      channels = []
    } = cfg || {}

    if (!token) {
      if (e) await e.reply('TG 未配置 token，无法拉取')
      return false
    }

    const agents = buildAgents(proxy)
    const state = loadState()
    const offset = state.last_update_id ? state.last_update_id + 1 : undefined

    // 拉取更新（使用指定超时）- 通过请求管理器确保单一请求
    const resp = await telegramAPI.executeRequest(async (controller) => {
      return await axios.get(`https://api.telegram.org/bot${token}/getUpdates`, {
        params: {
          timeout: timeout,
          offset,
          allowed_updates: ['channel_post', 'edited_channel_post']
        },
        ...agents,
        timeout: Math.max(1000 * (timeout + 10), 20000),
        signal: controller.signal // 支持取消请求
      })
    })

    const updates = Array.isArray(resp?.data?.result) ? resp.data.result : []
    
    if (updates.length === 0) {
      if (e) await e.reply('TG 无新消息')
      return true
    }

    // 处理逻辑与之前相同...
    const listByTarget = new Map()
    const groupByTarget = new Map()

    const chanArray = Array.isArray(channels) ? channels : []
    const includeSingle = cfg.channelId || cfg.channel_id
    if (includeSingle) {
      chanArray.push({ id: includeSingle, types: ['text', 'photo', 'video'], target: { type: cfg.targetType || 'group', id: cfg.targetId } })
    }

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
      const post = upd.channel_post
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
        const { node: mainNode, files: mainFiles } = await buildNodeFromChannelPost(token, proxy, download.dir, post, agents, maxBytes, cfg)
        
        // 处理音频内容
        const { node: audioNode, files: audioFiles } = await handleAudio(token, proxy, download.dir, post, agents, maxBytes)
        
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
    for (const [tKey, item] of listByTarget) {
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
        } catch (err) {
          const msg = err?.response?.data?.description || err?.message || '未知错误'
          logger.error(`[TG] 合并转发发送失败: ${msg}`)
        }
      }
      // 统一删除临时文件
      for (const f of item.files) { try { fs.unlinkSync(f) } catch {} }
    }

    // 保存偏移与去重集
    state.last_update_id = maxUpdateId
    state.processed = processed
    saveState(state)

    if (e) await e.reply('TG 拉取完成')
    return true
    
  } catch (error) {
    // 处理请求被取消的情况
    if (error.name === 'AbortError' || error.code === 'ABORT_ERR') {
      logger.info('[TG] 请求被取消（正常行为）')
      return false
    }
    throw error // 重新抛出其他错误
  }
}

async function pullOnce(e = null, options = {}) {
  const { timeout = null } = options
  
  const cfg = tgSetting.getConfig()
  const actualTimeout = timeout !== null ? timeout : Number(cfg?.polling?.timeout_sec || 30)
  
  // 在大循环模式下，直接收集消息，不立即发送
  return await collectUpdates(e, { timeout: actualTimeout })
}

// 停止自动轮询
function stopAutoPolling() {
  schedulerState.isManualMode = true
  
  if (schedulerState.timerRef) {
    clearTimeout(schedulerState.timerRef)
    schedulerState.timerRef = null
    logger.info('[TG] 停止自动轮询')
  }
  
  // 同时清理全局定时器引用（兼容性）
  if (globalThis.__yunzai_tg_timer) {
    clearTimeout(globalThis.__yunzai_tg_timer)
    globalThis.__yunzai_tg_timer = null
  }
}

// 重启自动轮询
function startAutoPolling() {
  schedulerState.isManualMode = false
  logger.info('[TG] 重启自动轮询')
  
  // 清理旧的定时器
  if (schedulerState.timerRef) {
    clearTimeout(schedulerState.timerRef)
  }
  if (globalThis.__yunzai_tg_timer) {
    clearTimeout(globalThis.__yunzai_tg_timer)
    globalThis.__yunzai_tg_timer = null
  }
  
  // 启动新的轮询
  setupTimer()
}

// 智能手动拉取：将短轮询结果加入大循环，立即发送，重置循环
async function smartManualPull(e) {
  // 1. 停止自动轮询
  stopAutoPolling()
  
  // 2. 等待当前请求完成或被取消
  let waitCount = 0
  while (telegramAPI.isActive() && waitCount < 10) {
    await new Promise(resolve => setTimeout(resolve, 100))
    waitCount++
  }
  
  try {
    // 3. 执行短轮询，收集到当前大循环
    logger.info(`[TG] 手动拉取，当前大循环已完成 ${schedulerState.currentCycle}/${schedulerState.totalCycles} 个小循环`)
    await collectUpdates(e, { timeout: 2 })
    
    // 4. 立即发送所有收集的消息（包括之前大循环的）
    await sendCollectedMessages()
    
    // 5. 重置大循环计数
    schedulerState.currentCycle = 0
    logger.info('[TG] 手动拉取完成，大循环计数已重置')
    
  } finally {
    // 6. 1秒后重启自动轮询
    setTimeout(() => {
      startAutoPolling()
    }, 1000)
  }
}

// 定时器：大循环调度机制
function setupTimer() {
  try {
    const cfg = tgSetting.getConfig()
    const enable = cfg?.polling?.enable
    const smallInterval = Number(cfg?.polling?.interval_ms || 5000)      // 小循环间隔5秒
    const timeoutSec = Number(cfg?.polling?.timeout_sec || 30)           // 长轮询30秒
    const cyclesPerBatch = Number(cfg?.polling?.cycles_per_batch || 3)   // 大循环包含3个小循环
    const batchInterval = Number(cfg?.polling?.batch_interval_ms || 20000) // 大循环间隔20秒
    
    if (!enable) return
    
    // 如果在手动模式或已有定时器，不创建
    if (schedulerState.isManualMode || schedulerState.timerRef || globalThis.__yunzai_tg_timer) {
      return
    }

    // 初始化循环状态
    schedulerState.currentCycle = 0
    schedulerState.totalCycles = cyclesPerBatch

    const scheduleSmallCycle = () => {
      // 检查手动模式
      if (schedulerState.isManualMode) {
        logger.debug('[TG] 手动模式中，延迟重试')
        schedulerState.timerRef = setTimeout(scheduleSmallCycle, 5000)
        globalThis.__yunzai_tg_timer = schedulerState.timerRef
        return
      }
      
      schedulerState.timerRef = setTimeout(async () => {
        try {
          // 每次执行时获取最新配置
          const cfg = tgSetting.getConfig()
          
          // 再次检查手动模式
          if (schedulerState.isManualMode) {
            scheduleSmallCycle()
            return
          }
          
          // 执行小循环：收集消息
          logCycle(cfg, `[TG] 执行小循环 ${schedulerState.currentCycle + 1}/${schedulerState.totalCycles}`)
          await collectUpdates(null, { timeout: timeoutSec })
          
          // 增加循环计数
          schedulerState.currentCycle++
          
          // 检查是否完成大循环
          if (schedulerState.currentCycle >= schedulerState.totalCycles) {
            logger.info('[TG] 大循环完成，发送收集的消息')
            await sendCollectedMessages()
            
            // 重置循环计数
            schedulerState.currentCycle = 0
            
            // 大循环间隔后继续
            logger.info(`[TG] 大循环间隔 ${batchInterval}ms`)
            schedulerState.timerRef = setTimeout(scheduleSmallCycle, batchInterval)
            globalThis.__yunzai_tg_timer = schedulerState.timerRef
          } else {
            // 小循环间隔后继续
            logDebug(cfg, `[TG] 小循环间隔 ${smallInterval}ms`)
            schedulerState.timerRef = setTimeout(scheduleSmallCycle, smallInterval)
            globalThis.__yunzai_tg_timer = schedulerState.timerRef
          }
          
        } catch (err) {
          const msg = err?.response?.data?.description || err?.message || '未知错误'
          logger.error(`[TG] 循环执行失败: ${msg}`)
          
          // 错误时重新调度
          if (!schedulerState.isManualMode) {
            scheduleSmallCycle()
          }
        }
      }, 1000) // 初始启动延迟1秒
      
      // 兼容全局引用
      globalThis.__yunzai_tg_timer = schedulerState.timerRef
    }
    
    scheduleSmallCycle()
    logger.info(`[TG] 启动大循环调度：${cyclesPerBatch}×(${timeoutSec}s轮询+${smallInterval}ms间隔) + ${batchInterval}ms大循环间隔`)
  } catch (e) {
    logger.warn(`[TG] 定时器初始化失败: ${e?.message || '未知错误'}`)
  }
}

setupTimer()

export default class TgMonitor extends plugin {
  constructor() {
    super({
      name: 'TG 监听与转发',
      dsc: '#tg拉取 或 #拉取tg 从 TG 拉取消息并转发到 QQ',
      event: 'message',
      priority: 500,
      rule: [
        { reg: '^#tg拉取$', fnc: 'manualPull' },
        { reg: '^#拉取tg$', fnc: 'manualPull' }
      ]
    })
  }

  // 手动拉取
  async manualPull(e) {
    try {
      await smartManualPull(e)
    } catch (err) {
      const msg = err?.response?.data?.description || err?.message || '未知错误'
      logger.error(`[TG] 智能手动拉取失败: ${msg}`)
      await e.reply('TG 智能拉取失败，请查看日志')
      
      // 确保恢复自动轮询
      setTimeout(() => {
        startAutoPolling()
      }, 2000)
    }
    return true
  }
}
