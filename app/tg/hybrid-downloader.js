import CloudAPI from './cloud-api.js'
import FileManager from './file-manager.js'
import { buildNodeFromChannelPost, handleAudio } from './monitor.js'
import tgSetting from '../../model/tg/tg-setting.js'
import path from 'node:path'
import fs from 'node:fs'

// 兼容logger
const logger = globalThis.logger || console

class HybridFileDownloader {
  constructor() {
    this.cloudAPI = CloudAPI
    this.fileManager = new FileManager()
    this.stats = {
      cloudDownloads: 0,
      localDownloads: 0,
      failures: 0,
      totalBytes: 0,
      averageSpeed: 0,
      lastDownloadTime: 0
    }
    this.downloadQueue = []
    this.isProcessingQueue = false
    this.maxConcurrentDownloads = 3
    this.activeDownloads = new Map()
  }

  /**
   * 智能下载文件
   * 优先使用云端API，失败时回退到本地方式
   * @param {string} token - Bot token
   * @param {object} proxy - 代理配置
   * @param {string} baseDir - 基础目录
   * @param {object} post - TG消息对象
   * @param {object} agents - HTTP代理agents
   * @param {number} maxBytes - 最大文件大小
   * @param {object} config - 配置对象
   * @returns {Promise<{node: Array, files: Array}>}
   */
  async downloadPost(token, proxy, baseDir, post, agents, maxBytes, config) {
    const startTime = Date.now()
    const channelKey = post.chat?.id || post.chat?.username || 'unknown'
    const messageId = post.message_id
    
    logger.info(`[HybridDownloader] 开始处理消息 ${messageId} from ${channelKey}`)

    try {
      const cloudConfig = config.cloud_teelebot || {}
      
      // 检查是否应该使用云端API
      if (this.shouldUseCloudAPI(post, cloudConfig)) {
        logger.info(`[HybridDownloader] 🌐 使用云端优先模式处理消息 ${messageId}`)
        
        try {
          const result = await this.downloadViaCloud(post, baseDir, cloudConfig, maxBytes)
          if (result.success) {
            this.stats.cloudDownloads++
            this.stats.totalBytes += result.bytes || 0
            this.updateDownloadStats(result.bytes, Date.now() - startTime)
            
            logger.info(`[HybridDownloader] ✅ 云端处理完成: ${result.node.length} 个节点, ${result.files.length} 个文件, ${this.formatBytes(result.bytes)}`)
            return { node: result.node, files: result.files }
          }
        } catch (error) {
          logger.warn(`[HybridDownloader] ⚠️ 云端处理失败: ${error.message}`)
          
          // 如果不允许回退，直接抛出错误
          if (!cloudConfig.fallback_to_local) {
            throw error
          }
          
          logger.info(`[HybridDownloader] 🔄 回退到本地处理模式`)
        }
        
        // 回退到本地处理
        logger.info(`[HybridDownloader] 📱 执行本地回退处理消息 ${messageId}`)
      } else {
        // 直接使用本地模式
        logger.info(`[HybridDownloader] 📱 使用本地模式处理消息 ${messageId}`)
      }

      const result = await this.downloadViaLocal(token, proxy, baseDir, post, agents, maxBytes, config)
      this.stats.localDownloads++
      this.stats.totalBytes += result.bytes || 0
      this.updateDownloadStats(result.bytes, Date.now() - startTime)
      
      logger.info(`[HybridDownloader] ✅ 本地处理完成: ${result.node.length} 个节点, ${result.files.length} 个文件, ${this.formatBytes(result.bytes)}`)
      return { node: result.node, files: result.files }

    } catch (error) {
      this.stats.failures++
      logger.error(`[HybridDownloader] ❌ 下载失败: ${error.message}`)
      
      // 返回错误提示节点
      const errorMsg = this.getErrorMessage(error, post)
      return { node: [errorMsg], files: [] }
    }
  }

  /**
   * 判断是否应该使用云端API
   * 修改为云端优先策略：所有消息都先尝试云端API，失败后回退本地
   */
  shouldUseCloudAPI(post, cloudConfig) {
    // 检查云端API是否启用和可用
    if (!cloudConfig.enabled || !this.cloudAPI.isAvailable()) {
      logger.debug('[HybridDownloader] 云端API未启用或不可用，使用本地模式')
      return false
    }

    // 检查健康状态
    if (this.cloudAPI.healthStatus === false) {
      logger.debug('[HybridDownloader] 云端API健康检查失败，使用本地模式')
      return false
    }

    // 检查文件大小是否超过云端限制
    const fileSize = this.getPostFileSize(post)
    const cloudMaxBytes = (cloudConfig.cloud_max_mb || 2000) * 1024 * 1024

    if (fileSize && fileSize > cloudMaxBytes) {
      logger.warn(`[HybridDownloader] 文件大小 ${this.formatBytes(fileSize)} 超过云端限制 ${this.formatBytes(cloudMaxBytes)}`)
      return false
    }

    // 云端优先策略：只要API可用且文件未超限，都优先使用云端
    logger.debug('[HybridDownloader] 云端API可用，优先使用云端处理')
    return true
  }

  /**
   * 通过云端API下载
   */
  async downloadViaCloud(post, baseDir, cloudConfig, maxBytes) {
    const node = []
    const files = []
    let totalBytes = 0

    const channelKey = post.chat?.id || post.chat?.username || 'unknown'
    const saveBase = this.fileManager.buildDownloadDir(baseDir, channelKey)

    // 处理文本
    const text = post.text || post.caption
    if (text) {
      const filteredText = this.fileManager.filterContent(text, cloudConfig)
      node.push(filteredText)
    }

    // 收集所有需要下载的文件
    const downloadTasks = []

    // 处理图片
    if (post.photo && post.photo.length > 0) {
      const task = this.createPhotoDownloadTask(post, saveBase, cloudConfig, maxBytes)
      if (task) downloadTasks.push(task)
    }

    // 处理视频
    if (post.video) {
      const task = this.createVideoDownloadTask(post, saveBase, cloudConfig, maxBytes)
      if (task) downloadTasks.push(task)
    }

    // 处理文档
    if (post.document) {
      const task = this.createDocumentDownloadTask(post, saveBase, cloudConfig, maxBytes)
      if (task) downloadTasks.push(task)
    }

    // 处理音频
    if (post.audio || post.voice) {
      const task = this.createAudioDownloadTask(post, saveBase, cloudConfig, maxBytes)
      if (task) downloadTasks.push(task)
    }

    // 并发下载文件
    const downloadResults = await this.executeDownloadTasks(downloadTasks, cloudConfig)

    // 处理下载结果
    for (const result of downloadResults) {
      if (result.success) {
        node.push(...result.node)
        files.push(...result.files)
        totalBytes += result.bytes
      } else {
        node.push(result.errorMessage)
      }
    }

    return { success: true, node, files, bytes: totalBytes }
  }

  /**
   * 创建图片下载任务
   */
  createPhotoDownloadTask(post, saveBase, cloudConfig, maxBytes) {
    const best = this.selectBestPhoto(post.photo, maxBytes)
    if (!best) {
      return {
        type: 'photo',
        error: '图片超过大小上限，已跳过',
        fileId: null
      }
    }

    const fileId = best.file_id
    const ext = '.jpg'
    const savePath = path.join(saveBase, `m${post.message_id}_p0${ext}`)

    return {
      type: 'photo',
      fileId,
      savePath,
      expectedSize: best.file_size,
      priority: 'normal'
    }
  }

  /**
   * 创建视频下载任务
   */
  createVideoDownloadTask(post, saveBase, cloudConfig, maxBytes) {
    const video = post.video
    if (maxBytes && video.file_size && video.file_size > maxBytes) {
      return {
        type: 'video',
        error: '视频超过大小上限，已跳过',
        fileId: video.file_id
      }
    }

    const fileId = video.file_id
    const ext = '.mp4'
    const savePath = path.join(saveBase, `m${post.message_id}_v0${ext}`)

    return {
      type: 'video',
      fileId,
      savePath,
      expectedSize: video.file_size,
      priority: 'high' // 视频文件优先级高
    }
  }

  /**
   * 创建文档下载任务
   */
  createDocumentDownloadTask(post, saveBase, cloudConfig, maxBytes) {
    const doc = post.document
    if (maxBytes && doc.file_size && doc.file_size > maxBytes) {
      return {
        type: 'document',
        error: '文档超过大小上限，已跳过',
        fileId: doc.file_id
      }
    }

    const fileId = doc.file_id
    let ext = path.extname(doc.file_name || '') || '.bin'
    const savePath = path.join(saveBase, `m${post.message_id}_d0${ext}`)

    return {
      type: 'document',
      fileId,
      savePath,
      expectedSize: doc.file_size,
      fileName: doc.file_name,
      mimeType: doc.mime_type,
      priority: 'normal'
    }
  }

  /**
   * 创建音频下载任务
   */
  createAudioDownloadTask(post, saveBase, cloudConfig, maxBytes) {
    const audio = post.audio || post.voice
    if (maxBytes && audio.file_size && audio.file_size > maxBytes) {
      return {
        type: 'audio',
        error: '音频超过大小上限，已跳过',
        fileId: audio.file_id
      }
    }

    const fileId = audio.file_id
    const ext = post.voice ? '.ogg' : '.mp3'
    const savePath = path.join(saveBase, `m${post.message_id}_a0${ext}`)

    return {
      type: 'audio',
      fileId,
      savePath,
      expectedSize: audio.file_size,
      title: audio.title,
      fileName: audio.file_name,
      priority: 'low'
    }
  }

  /**
   * 执行下载任务
   */
  async executeDownloadTasks(tasks, cloudConfig) {
    if (tasks.length === 0) {
      return []
    }

    // 过滤掉有错误的任务
    const validTasks = tasks.filter(task => !task.error)
    const errorTasks = tasks.filter(task => task.error)

    // 处理错误任务
    const errorResults = errorTasks.map(task => ({
      success: false,
      errorMessage: task.error,
      type: task.type
    }))

    if (validTasks.length === 0) {
      return errorResults
    }

    // 并发下载设置
    const maxConcurrent = cloudConfig.max_concurrent_downloads || 3
    const timeout = (cloudConfig.download_timeout || 300) * 1000

    // 按优先级排序
    validTasks.sort((a, b) => {
      const priorities = { high: 3, normal: 2, low: 1 }
      return priorities[b.priority] - priorities[a.priority]
    })

    // 分批并发下载
    const results = []
    for (let i = 0; i < validTasks.length; i += maxConcurrent) {
      const batch = validTasks.slice(i, i + maxConcurrent)
      
      const batchPromises = batch.map(task => this.downloadSingleFile(task, cloudConfig))
      const batchResults = await Promise.allSettled(batchPromises)
      
      for (let j = 0; j < batchResults.length; j++) {
        const result = batchResults[j]
        const task = batch[j]
        
        if (result.status === 'fulfilled') {
          results.push(result.value)
        } else {
          logger.error(`[HybridDownloader] 下载任务失败: ${task.fileId} - ${result.reason}`)
          results.push({
            success: false,
            errorMessage: `${task.type}下载失败: ${result.reason.message}`,
            type: task.type
          })
        }
      }
      
      // 批次间延迟，避免过于频繁的请求
      if (i + maxConcurrent < validTasks.length) {
        await new Promise(resolve => setTimeout(resolve, 1000))
      }
    }

    return [...results, ...errorResults]
  }

  /**
   * 下载单个文件
   */
  async downloadSingleFile(task, cloudConfig) {
    const startTime = Date.now()
    
    try {
      logger.debug(`[HybridDownloader] 📥 开始下载 ${task.type}: ${task.fileId}`)
      
      // 获取下载链接
      const linkInfo = await this.cloudAPI.getFileDownloadLink(task.fileId, {
        expire_time: 3600,
        priority: task.priority
      })
      
      // 创建进度回调
      const onProgress = (loaded, total, percent) => {
        if (percent % 10 === 0 || percent > 90) { // 减少日志频率
          logger.debug(`[HybridDownloader] 📊 ${task.type} 下载进度: ${percent}% (${this.formatBytes(loaded)}/${this.formatBytes(total)})`)
        }
      }
      
      // 下载文件
      await this.cloudAPI.downloadFileDirectly(linkInfo.download_url, task.savePath, {
        maxSize: task.expectedSize ? task.expectedSize * 1.1 : undefined, // 允许10%的大小误差
        timeout: cloudConfig.download_timeout || 300,
        onProgress
      })

      // 验证下载的文件
      const actualSize = await this.fileManager.getFileSize(task.savePath)
      if (actualSize === 0) {
        throw new Error('下载的文件为空')
      }

      // 创建消息段
      const messageSegment = this.createMessageSegment(task)
      
      const downloadTime = Date.now() - startTime
      logger.info(`[HybridDownloader] ✅ ${task.type} 下载完成: ${this.formatBytes(actualSize)} (${downloadTime}ms)`)

      return {
        success: true,
        node: [messageSegment],
        files: [task.savePath],
        bytes: actualSize,
        type: task.type,
        downloadTime
      }

    } catch (error) {
      // 清理失败的文件
      try {
        if (fs.existsSync(task.savePath)) {
          fs.unlinkSync(task.savePath)
        }
      } catch {}

      throw new Error(`${task.type}下载失败: ${error.message}`)
    }
  }

  /**
   * 创建消息段
   */
  createMessageSegment(task) {
    const fileUrl = this.fileManager.toFileUrl(task.savePath)
    
    try {
      switch (task.type) {
        case 'photo':
          return segment.image(fileUrl)
          
        case 'video':
          if (typeof segment.video === 'function') {
            return segment.video(fileUrl)
          } else {
            return `(视频已保存: ${path.basename(task.savePath)})`
          }
          
        case 'audio':
          if (typeof segment.record === 'function') {
            return segment.record(fileUrl)
          } else if (typeof segment.file === 'function') {
            return segment.file(fileUrl)
          } else {
            return `(音频已保存: ${task.title || task.fileName || path.basename(task.savePath)})`
          }
          
        case 'document':
          // 根据MIME类型智能选择消息段类型
          if (task.mimeType?.startsWith('image/')) {
            return segment.image(fileUrl)
          } else if (task.mimeType?.startsWith('video/')) {
            if (typeof segment.video === 'function') {
              return segment.video(fileUrl)
            }
          } else if (typeof segment.file === 'function') {
            return segment.file(fileUrl)
          }
          
          return `(文件已保存: ${task.fileName || path.basename(task.savePath)})`
          
        default:
          return `(文件已保存: ${path.basename(task.savePath)})`
      }
    } catch (error) {
      logger.warn(`[HybridDownloader] 创建消息段失败: ${error.message}`)
      return `(${task.type}已保存: ${task.fileName || path.basename(task.savePath)})`
    }
  }

  /**
   * 本地下载方式（保持原有逻辑）
   */
  async downloadViaLocal(token, proxy, baseDir, post, agents, maxBytes, config) {
    logger.debug(`[HybridDownloader] 📱 调用本地下载函数处理消息`)
    
    try {
      // 动态导入原有的下载函数
      const monitorModule = await import('./monitor.js')
      const { buildNodeFromChannelPost, handleAudio } = monitorModule
      
      // 调用原有的下载函数
      const mainResult = await buildNodeFromChannelPost(token, proxy, baseDir, post, agents, maxBytes, config)
      const audioResult = await handleAudio(token, proxy, baseDir, post, agents, maxBytes)
      
      const allNodes = [...mainResult.node, ...audioResult.node]
      const allFiles = [...mainResult.files, ...audioResult.files]
      
      // 计算总字节数
      let totalBytes = 0
      for (const file of allFiles) {
        try {
          const stats = await fs.promises.stat(file)
          totalBytes += stats.size
        } catch {}
      }
      
      return { success: true, node: allNodes, files: allFiles, bytes: totalBytes }
    } catch (error) {
      logger.error(`[HybridDownloader] 本地下载失败: ${error.message}`)
      throw error
    }
  }

  /**
   * 获取消息中文件的大小
   */
  getPostFileSize(post) {
    let maxSize = 0
    
    if (post.photo && post.photo.length > 0) {
      maxSize = Math.max(maxSize, ...post.photo.map(p => p.file_size || 0))
    }
    if (post.video && post.video.file_size) {
      maxSize = Math.max(maxSize, post.video.file_size)
    }
    if (post.document && post.document.file_size) {
      maxSize = Math.max(maxSize, post.document.file_size)
    }
    if (post.audio && post.audio.file_size) {
      maxSize = Math.max(maxSize, post.audio.file_size)
    }
    if (post.voice && post.voice.file_size) {
      maxSize = Math.max(maxSize, post.voice.file_size)
    }
    
    return maxSize
  }

  /**
   * 获取消息文件类型
   */
  getPostFileType(post) {
    if (post.photo) return 'photo'
    if (post.video) return 'video'
    if (post.document) return 'document'
    if (post.audio) return 'audio'
    if (post.voice) return 'voice'
    return 'unknown'
  }

  /**
   * 选择最佳图片规格
   */
  selectBestPhoto(photos, maxBytes) {
    let best = null
    const sorted = [...photos].sort((a, b) => (a.file_size || 0) - (b.file_size || 0))
    
    for (const photo of sorted) {
      if (!maxBytes || !photo.file_size || photo.file_size <= maxBytes) {
        best = photo
      }
    }
    
    return best
  }

  /**
   * 生成错误消息
   */
  getErrorMessage(error, post) {
    const fileType = this.getPostFileType(post)
    const fileTypeMap = {
      photo: '图片',
      video: '视频', 
      document: '文档',
      audio: '音频',
      voice: '语音',
      unknown: '文件'
    }
    
    const typeName = fileTypeMap[fileType] || '文件'
    return `(${typeName}下载失败: ${error.message})`
  }

  /**
   * 更新下载统计
   */
  updateDownloadStats(bytes, duration) {
    this.stats.lastDownloadTime = Date.now()
    
    if (bytes && duration) {
      const speed = bytes / (duration / 1000) // bytes per second
      const totalDownloads = this.stats.cloudDownloads + this.stats.localDownloads
      
      if (totalDownloads === 1) {
        this.stats.averageSpeed = speed
      } else {
        this.stats.averageSpeed = (this.stats.averageSpeed * (totalDownloads - 1) + speed) / totalDownloads
      }
    }
  }

  /**
   * 格式化字节数
   */
  formatBytes(bytes) {
    if (!bytes || bytes === 0) return '0 B'
    
    const k = 1024
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
  }

  /**
   * 获取下载统计
   */
  getStats() {
    return {
      ...this.stats,
      successRate: this.stats.cloudDownloads + this.stats.localDownloads > 0 
        ? ((this.stats.cloudDownloads + this.stats.localDownloads) / (this.stats.cloudDownloads + this.stats.localDownloads + this.stats.failures) * 100).toFixed(2) + '%'
        : '0%',
      cloudRatio: this.stats.cloudDownloads + this.stats.localDownloads > 0
        ? ((this.stats.cloudDownloads) / (this.stats.cloudDownloads + this.stats.localDownloads) * 100).toFixed(2) + '%'
        : '0%',
      averageSpeedFormatted: this.formatBytes(this.stats.averageSpeed) + '/s',
      totalBytesFormatted: this.formatBytes(this.stats.totalBytes)
    }
  }

  /**
   * 重置统计
   */
  resetStats() {
    this.stats = {
      cloudDownloads: 0,
      localDownloads: 0,
      failures: 0,
      totalBytes: 0,
      averageSpeed: 0,
      lastDownloadTime: 0
    }
    logger.info('[HybridDownloader] 统计信息已重置')
  }

  /**
   * 清理活跃下载记录
   */
  cleanupActiveDownloads() {
    const now = Date.now()
    const timeout = 300000 // 5分钟超时
    
    for (const [fileId, downloadInfo] of this.activeDownloads.entries()) {
      if (now - downloadInfo.startTime > timeout) {
        this.activeDownloads.delete(fileId)
        logger.warn(`[HybridDownloader] 清理超时下载记录: ${fileId}`)
      }
    }
  }
}

export default HybridFileDownloader