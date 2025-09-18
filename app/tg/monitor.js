// TG 频道监听与转发核心模块 - 指令触发版本 + 混合下载器
// - 通过#tg指令手动触发获取频道新消息，将文本/图片/视频下载到本地
// - 集成混合下载器，支持云端API和本地回退策略
// - 按配置转发到 QQ 群/私聊
// - 支持代理、去重、媒体下载等功能
import plugin from '../../../../lib/plugins/plugin.js'
import common from '../../../../lib/common/common.js'
import axios from 'axios'
import { HttpsProxyAgent } from 'https-proxy-agent'
import fs from 'node:fs'
import path from 'node:path'
import tgSetting from '../../model/tg/tg-setting.js'
import HybridFileDownloader from './hybrid-downloader.js'

// 兼容logger
const logger = globalThis.logger || console
// segment用于构建QQ消息段
const segment = globalThis.segment || {}

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
const hybridDownloader = new HybridFileDownloader()

// 指令触发的TG消息拉取和转发
async function pullTelegramMessages(e) {
  try {
    const cfg = tgSetting.getConfig()
    const {
      token,
      proxy,
      batch = { size: 8 },
      dedup = { ttl_days: 7 },
      download = { dir: path.join('plugins', 'yunzai-plugin-integration', 'data', 'temp', 'tg') },
      channels = [],
      cloud_teelebot = {}
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
    
    // 读取状态
    const state = loadState()
    
    // 准备频道配置，包含last_message_id信息
    const channelsWithState = channels.map(channel => ({
      ...channel,
      last_message_id: state.channel_states?.[channel.id]?.last_message_id || 0
    }))

    // 优先尝试云端API拉取
    if (cloud_teelebot.enabled) {
      try {
        logger.info('[TG] 🌐 尝试使用云端API拉取消息...')
        
        const CloudAPI = (await import('./cloud-api.js')).default
        
        if (CloudAPI.isAvailable()) {
          // 先进行健康检查，确保API服务器真正可用
          const isHealthy = await CloudAPI.healthCheck()
          if (!isHealthy) {
            logger.warn('[TG] 云端API健康检查失败，回退到本地模式')
          } else {
            logger.info('[TG] 云端API健康检查通过，开始拉取消息')
            const cloudResult = await CloudAPI.fetchChannelMessages(channelsWithState)
            
            if (cloudResult.success && cloudResult.summary.total_messages > 0) {
              logger.info(`[TG] ✅ 云端API拉取成功: ${cloudResult.summary.total_messages} 条消息`)
              
              // 处理云端拉取的消息
              const processedResults = await processCloudMessages(cloudResult, cfg, e)
              
              if (processedResults.success) {
                // 更新状态
                updateChannelStates(state, cloudResult.channels)
                saveState(state)
                
                await e.reply(`[TG] ✅ 云端模式拉取完成，共处理 ${processedResults.totalMessages} 条消息`)
                return true
              }
            } else {
              await e.reply('[TG] 云端API：无新消息')
              return true
            }
          }
        } else {
          logger.warn('[TG] 云端API不可用，回退到本地模式')
        }
        
      } catch (error) {
        logger.warn(`[TG] 云端API拉取失败: ${error.message}`)
        
        if (!cloud_teelebot.fallback_to_local) {
          await e.reply(`[TG] 云端拉取失败且禁用本地回退: ${error.message}`)
          return false
        }
        
        logger.info('[TG] 🔄 回退到本地拉取模式')
      }
    }

    // 本地拉取模式（原有逻辑）
    logger.info('[TG] 📱 使用本地模式拉取消息...')
    
    const agents = buildAgents(proxy)
    const offset = state.last_update_id ? state.last_update_id + 1 : undefined

    // 拉取更新（短轮询，快速获取）
    const resp = await telegramAPI.executeRequest(token, async (controller) => {
      return await axios.get(`https://api.telegram.org/bot${token}/getUpdates`, {
        params: {
          timeout: 5, // 短轮询，5秒超时
          offset,
          allowed_updates: ['channel_post', 'edited_channel_post']
        },
        ...agents,
        timeout: 15000, // HTTP请求超时15秒
        signal: controller.signal
      })
    })

    const updates = Array.isArray(resp?.data?.result) ? resp.data.result : []
    
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
        
        // 使用混合下载器处理媒体内容
        const downloadResult = await hybridDownloader.downloadPost(
          token, 
          proxy, 
          download.dir, 
          post, 
          agents, 
          maxBytes, 
          cfg
        )
        
        if (post.media_group_id) {
          if (!groupByTarget.has(tKey)) groupByTarget.set(tKey, new Map())
          const groups = groupByTarget.get(tKey)
          const gKey = `g:${post.media_group_id}`
          if (!groups.has(gKey)) groups.set(gKey, { node: [], files: [], hasText: false })
          const group = groups.get(gKey)
          
          const allNodes = downloadResult.node || []
          const allFiles = downloadResult.files || []
          
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
          const allNodes = downloadResult.node || []
          const allFiles = downloadResult.files || []
          
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
        }
      }
      // 统一删除临时文件
      for (const f of item.files) { try { fs.unlinkSync(f) } catch {} }
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

// 导出原有函数供混合下载器回退使用
export async function buildNodeFromChannelPost(token, proxy, baseDir, post, agents, maxBytes, config) {
  const node = []
  const files = []
  const channelKey = post.chat?.id || post.chat?.username || 'unknown'
  
  // 确保目录存在
  const date = new Date()
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  
  const pluginRoot = path.join(process.cwd(), 'plugins', 'yunzai-plugin-integration');
  const defaultDir = path.join(pluginRoot, 'data', 'temp', 'tg');
  const saveBase = path.join(process.cwd(), baseDir || defaultDir, String(channelKey), `${y}${m}${d}`)
  ensureDir(saveBase)

  // 内容过滤器
  function filterContent(text, config) {
    if (!text || typeof text !== 'string') return text
    
    const filters = config?.filters
    if (!filters?.enable) return text
    
    let filteredText = text
    
    // 过滤Telegram域名
    if (filters.remove_telegram_domains && Array.isArray(filters.telegram_domains)) {
      for (const domain of filters.telegram_domains) {
        const regex = new RegExp(`https?://${domain.replace('.', '\\.')}`, 'gi')
        filteredText = filteredText.replace(regex, 'https://')
      }
    }
    
    return filteredText
  }

  // 下载文件工具函数
  async function downloadFile(fileUrl, savePath, agents) {
    const writer = fs.createWriteStream(savePath)
    const resp = await axios.get(fileUrl, { responseType: 'stream', ...agents })
    await new Promise((resolve, reject) => {
      resp.data.pipe(writer)
      writer.on('finish', resolve)
      writer.on('error', reject)
    })
  }

  // 路径转file:// URL格式
  function toFileUrl(p) { return 'file://' + p.replace(/\\/g, '/') }

  // 文本（text 或 caption）- 应用过滤器
  const text = post.text || post.caption
  if (text) {
    const filteredText = filterContent(text, config)
    node.push(filteredText)
  }

  // 图片：从同一张不同规格中，选择不超过上限的最大一张
  if (Array.isArray(post.photo) && post.photo.length) {
    let best = null
    const sorted = [...post.photo].sort((a, b) => (a.file_size || 0) - (b.file_size || 0))
    for (const p of sorted) {
      if (!maxBytes || !p.file_size || p.file_size <= maxBytes) best = p
    }
    if (!best) {
      node.push('(图片超过大小上限，已跳过)')
      return { node, files }
    }
    const fileId = best.file_id
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
        let ext = path.extname(filePath)
        if (!ext) {
          const nameExt = path.extname(doc.file_name || '')
          ext = nameExt || '.bin'
        }
        const savePath = path.join(saveBase, `m${post.message_id}_d0${ext}`)
        const fileUrl = `https://api.telegram.org/file/bot${token}/${filePath}`
        await downloadFile(fileUrl, savePath, agents)
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
            if (typeof segment.file === 'function') {
              node.push(segment.file(toFileUrl(savePath)))
            } else {
              node.push(`(文件已保存: ${doc.file_name || path.basename(savePath)})`)
            }
          }
        } catch (e) {
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

// 导出音频处理函数供混合下载器回退使用
export async function handleAudio(token, proxy, baseDir, post, agents, maxBytes) {
  const node = []
  const files = []
  if (!post.audio && !post.voice) return { node, files }
  
  const audio = post.audio || post.voice
  const channelKey = post.chat?.id || post.chat?.username || 'unknown'
  
  // 确保目录存在
  const date = new Date()
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  
  const pluginRoot = path.join(process.cwd(), 'plugins', 'yunzai-plugin-integration');
  const defaultDir = path.join(pluginRoot, 'data', 'temp', 'tg');
  const saveBase = path.join(process.cwd(), baseDir || defaultDir, String(channelKey), `${y}${m}${d}`)
  ensureDir(saveBase)
  
  if (maxBytes && audio.file_size && audio.file_size > maxBytes) {
    node.push('(音频超过大小上限，已跳过)')
    return { node, files }
  }
  
  // 下载文件工具函数
  async function downloadFile(fileUrl, savePath, agents) {
    const writer = fs.createWriteStream(savePath)
    const resp = await axios.get(fileUrl, { responseType: 'stream', ...agents })
    await new Promise((resolve, reject) => {
      resp.data.pipe(writer)
      writer.on('finish', resolve)
      writer.on('error', reject)
    })
  }

  // 路径转file:// URL格式
  function toFileUrl(p) { return 'file://' + p.replace(/\\/g, '/') }
  
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

/**
 * 处理云端API拉取的消息
 */
async function processCloudMessages(cloudResult, config, e) {
  try {
    let totalMessages = 0
    const allNodes = []

    for (const channelResult of cloudResult.channels) {
      if (!channelResult.success || !channelResult.messages.length) {
        continue
      }

      logger.info(`[TG] 处理频道 ${channelResult.channel_id} 的 ${channelResult.messages.length} 条消息`)

      for (const message of channelResult.messages) {
        try {
          // 使用云端消息处理云端文件下载
          const processedResult = await processCloudMessage(message, config)
          
          if (processedResult && processedResult.nodes.length > 0) {
            allNodes.push(...processedResult.nodes)
            totalMessages++
          }
        } catch (error) {
          logger.error(`[TG] 处理云端消息失败: ${error.message}`)
        }
      }
    }

    if (allNodes.length === 0) {
      return { success: true, totalMessages: 0 }
    }

    // 批量转发消息
    const batchSize = config.batch?.size || 8
    const batches = []
    for (let i = 0; i < allNodes.length; i += batchSize) {
      batches.push(allNodes.slice(i, i + batchSize))
    }

    logger.info(`[TG] 开始批量转发，共 ${batches.length} 批`)

    for (const [index, batch] of batches.entries()) {
      try {
        // 找到目标配置
        for (const channel of config.channels) {
          if (channel.target) {
            await sendForwardMessage(batch, channel.target)
            logger.info(`[TG] 第 ${index + 1}/${batches.length} 批转发完成`)
          }
        }
      } catch (error) {
        logger.error(`[TG] 第 ${index + 1} 批转发失败: ${error.message}`)
      }
    }

    return { success: true, totalMessages }

  } catch (error) {
    logger.error(`[TG] 云端消息处理失败: ${error.message}`)
    return { success: false, error: error.message }
  }
}

/**
 * 处理单个云端消息
 */
async function processCloudMessage(message, config) {
  try {
    const nodes = []

    // 处理文本内容
    if (message.text || message.caption) {
      const text = filterContent(message.text || message.caption, config)
      nodes.push(text)
    }

    // 处理文件（云端已提供下载链接）
    if (message.files && message.files.length > 0) {
      for (const file of message.files) {
        try {
          // 使用云端提供的下载链接直接下载
          const downloadResult = await downloadCloudFile(file, config)
          if (downloadResult && downloadResult.node) {
            nodes.push(downloadResult.node)
          }
        } catch (error) {
          logger.error(`[TG] 云端文件下载失败: ${error.message}`)
          nodes.push(`(文件下载失败: ${file.file_name || file.type})`)
        }
      }
    }

    return { nodes }

  } catch (error) {
    logger.error(`[TG] 处理云端消息失败: ${error.message}`)
    return null
  }
}

/**
 * 下载云端文件
 */
async function downloadCloudFile(file, config) {
  try {
    if (!file.download_url) {
      throw new Error('缺少下载链接')
    }

    // 构建保存路径
    const downloadDir = config.download?.dir || path.join('plugins', 'yunzai-plugin-integration', 'data', 'temp', 'tg')
    ensureDir(downloadDir)

    const fileName = file.file_name || `${file.file_id}.${getFileExtension(file.type)}`
    const savePath = path.join(downloadDir, fileName)

    // 使用axios下载文件
    const response = await axios.get(file.download_url, {
      responseType: 'stream',
      timeout: 30000
    })

    const writer = fs.createWriteStream(savePath)
    response.data.pipe(writer)

    await new Promise((resolve, reject) => {
      writer.on('finish', resolve)
      writer.on('error', reject)
    })

    // 生成消息段
    const fileUrl = 'file://' + savePath.replace(/\\/g, '/')
    let node

    switch (file.type) {
      case 'photo':
        node = typeof segment?.image === 'function' ? segment.image(fileUrl) : `(图片已保存: ${fileName})`
        break
      case 'video':
      case 'animation':
        node = typeof segment?.video === 'function' ? segment.video(fileUrl) : `(视频已保存: ${fileName})`
        break
      case 'audio':
      case 'voice':
        node = typeof segment?.record === 'function' ? segment.record(fileUrl) : `(音频已保存: ${fileName})`
        break
      default:
        node = `(文件已保存: ${fileName})`
    }

    return { node, filePath: savePath }

  } catch (error) {
    logger.error(`[TG] 云端文件下载失败: ${error.message}`)
    throw error
  }
}

/**
 * 获取文件扩展名
 */
function getFileExtension(fileType) {
  const extensionMap = {
    photo: 'jpg',
    video: 'mp4',
    audio: 'mp3',
    voice: 'ogg',
    document: 'pdf',
    animation: 'gif'
  }
  return extensionMap[fileType] || 'bin'
}

/**
 * 更新频道状态
 */
function updateChannelStates(state, channelResults) {
  if (!state.channel_states) {
    state.channel_states = {}
  }

  for (const result of channelResults) {
    if (result.success && result.latest_message_id) {
      state.channel_states[result.channel_id] = {
        last_message_id: result.latest_message_id,
        last_update: Date.now()
      }
    }
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
        { reg: '^#tg$', fnc: 'manualPull' },
        { reg: '^#tg拉取$', fnc: 'manualPull' },
        { reg: '^#拉取tg$', fnc: 'manualPull' }
      ]
    })
  }

  // 手动拉取TG消息
  async manualPull(e) {
    return await pullTelegramMessages(e)
  }
}