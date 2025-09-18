// 云端teelebot API客户端
import axios from 'axios'
import tgSetting from '../../model/tg/tg-setting.js'

// 兼容logger
const logger = globalThis.logger || console

class CloudTelebotAPI {
  constructor() {
    this.client = null
    this.config = null
    this.healthStatus = false
    this.lastHealthCheck = 0
    this.requestQueue = []
    this.isProcessingQueue = false
    this.stats = {
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      averageResponseTime: 0,
      lastRequestTime: 0
    }
    this.initializeClient()
  }

  /**
   * 初始化API客户端
   */
  initializeClient() {
    try {
      const config = tgSetting.getConfig()
      this.config = config.cloud_teelebot

      if (!this.config?.enabled) {
        logger.debug('[CloudAPI] 云端API未启用')
        return
      }

      // 验证必需配置
      if (!this.config.api_endpoint || !this.config.auth_token) {
        logger.error('[CloudAPI] 缺少必需的API配置: api_endpoint 或 auth_token')
        return
      }

      this.client = axios.create({
        baseURL: this.config.api_endpoint.replace(/\/$/, ''),
        timeout: (this.config.timeout || 30) * 1000,
        headers: {
          'Authorization': `Bearer ${this.config.auth_token}`,
          'Content-Type': 'application/json',
          'User-Agent': 'yunzai-plugin-integration/1.0',
          'Accept': 'application/json'
        },
        // 重试配置
        retry: this.config.retry_count || 3,
        retryDelay: (this.config.retry_delay || 5) * 1000
      })

      // 添加请求拦截器
      this.client.interceptors.request.use(
        config => {
          const requestId = this.generateRequestId()
          config.headers['X-Request-ID'] = requestId
          config.metadata = { startTime: Date.now(), requestId }
          
          logger.debug(`[CloudAPI] 🚀 ${config.method?.toUpperCase()} ${config.url} [${requestId}]`)
          return config
        },
        error => {
          logger.error(`[CloudAPI] ❌ 请求配置错误: ${error.message}`)
          return Promise.reject(error)
        }
      )

      // 添加响应拦截器
      this.client.interceptors.response.use(
        response => {
          const duration = Date.now() - response.config.metadata.startTime
          const requestId = response.config.metadata.requestId
          
          this.updateStats(true, duration)
          logger.debug(`[CloudAPI] ✅ ${response.status} ${response.config.url} (${duration}ms) [${requestId}]`)
          
          return response
        },
        error => {
          const duration = error.config?.metadata ? Date.now() - error.config.metadata.startTime : 0
          const requestId = error.config?.metadata?.requestId || 'unknown'
          
          this.updateStats(false, duration)
          
          if (error.response) {
            const status = error.response.status
            const message = error.response.data?.error?.message || error.message
            logger.error(`[CloudAPI] ❌ ${status} ${error.config?.url} - ${message} (${duration}ms) [${requestId}]`)
          } else if (error.request) {
            logger.error(`[CloudAPI] ❌ 网络错误: ${error.message} (${duration}ms) [${requestId}]`)
          } else {
            logger.error(`[CloudAPI] ❌ 请求错误: ${error.message} [${requestId}]`)
          }
          
          return Promise.reject(error)
        }
      )

      logger.info(`[CloudAPI] 客户端初始化完成: ${this.config.api_endpoint}`)
    } catch (error) {
      logger.error(`[CloudAPI] 初始化失败: ${error.message}`)
    }
  }

  /**
   * 检查客户端是否可用
   */
  isAvailable() {
    return !!(this.client && this.config?.enabled)
  }

  /**
   * 获取文件下载链接
   * @param {string} fileId - Telegram文件ID
   * @param {object} options - 选项参数
   * @returns {Promise<{download_url: string, expires_at: number, file_size?: number}>}
   */
  async getFileDownloadLink(fileId, options = {}) {
    if (!this.isAvailable()) {
      throw new Error('云端API客户端不可用')
    }

    try {
      const requestData = {
        file_id: fileId,
        options: {
          expire_time: options.expire_time || 3600,
          allow_cache: options.allow_cache !== false,
          priority: options.priority || 'normal',
          ...options
        }
      }

      const response = await this.client.post('/api/file-link', requestData)
      
      if (!response.data?.success) {
        const error = response.data?.error
        throw new Error(error?.message || 'API返回失败状态')
      }

      const data = response.data.data
      if (!data?.download_url) {
        throw new Error('API响应缺少download_url字段')
      }

      logger.debug(`[CloudAPI] 📎 获取文件链接成功: ${fileId} -> ${data.download_url}`)
      return data

    } catch (error) {
      // 详细的错误处理
      if (error.response?.status === 404) {
        throw new Error('文件未找到或已过期')
      } else if (error.response?.status === 401) {
        throw new Error('API认证失败，请检查token配置')
      } else if (error.response?.status === 429) {
        const retryAfter = error.response.headers['retry-after'] || 60
        throw new Error(`API请求频率超限，请 ${retryAfter} 秒后重试`)
      } else if (error.response?.status === 413) {
        throw new Error('文件大小超过服务器限制')
      } else if (error.code === 'ECONNABORTED') {
        throw new Error('请求超时，请检查网络连接')
      } else if (error.code === 'ENOTFOUND') {
        throw new Error('无法连接到云端API服务器，请检查网络配置')
      } else {
        throw new Error(`获取文件链接失败: ${error.message}`)
      }
    }
  }

  /**
   * 批量获取文件下载链接
   * @param {Array} fileRequests - 文件请求数组
   * @param {object} options - 全局选项
   * @returns {Promise<{results: Array, summary: object}>}
   */
  async getFileDownloadLinks(fileRequests, options = {}) {
    if (!this.isAvailable()) {
      throw new Error('云端API客户端不可用')
    }

    if (!Array.isArray(fileRequests) || fileRequests.length === 0) {
      throw new Error('fileRequests必须是非空数组')
    }

    // 限制批量请求数量
    const maxBatchSize = this.config.max_batch_size || 10
    if (fileRequests.length > maxBatchSize) {
      throw new Error(`批量请求最多支持${maxBatchSize}个文件`)
    }

    try {
      const requestData = {
        files: fileRequests.map(req => ({
          file_id: req.file_id,
          priority: req.priority || 'normal',
          ...req
        })),
        options: {
          expire_time: options.expire_time || 3600,
          parallel_processing: options.parallel_processing !== false,
          ...options
        }
      }

      const response = await this.client.post('/api/file-links/batch', requestData)
      
      if (!response.data?.success) {
        const error = response.data?.error
        throw new Error(error?.message || 'API返回失败状态')
      }

      const data = response.data.data
      logger.info(`[CloudAPI] 📦 批量获取文件链接: ${data.summary.successful}/${data.summary.total} 成功`)
      
      return data

    } catch (error) {
      if (error.response?.status === 400) {
        throw new Error('批量请求参数错误: ' + (error.response.data?.error?.message || '未知错误'))
      } else {
        throw new Error(`批量获取文件链接失败: ${error.message}`)
      }
    }
  }

  /**
   * 直接下载文件到本地
   * @param {string} downloadUrl - 下载链接
   * @param {string} savePath - 保存路径
   * @param {object} options - 下载选项
   */
  async downloadFileDirectly(downloadUrl, savePath, options = {}) {
    const fs = await import('node:fs')
    const path = await import('node:path')

    // 确保目录存在
    const dir = path.dirname(savePath)
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true })
    }

    const writer = fs.createWriteStream(savePath)
    const timeout = (options.timeout || this.config.download_timeout || 60) * 1000
    const maxSize = options.maxSize || this.config.max_file_size || 2 * 1024 * 1024 * 1024 // 2GB

    try {
      logger.debug(`[CloudAPI] 📥 开始下载文件: ${downloadUrl} -> ${savePath}`)
      
      const response = await axios.get(downloadUrl, {
        responseType: 'stream',
        timeout,
        maxRedirects: 5,
        headers: {
          'User-Agent': 'yunzai-plugin-integration/1.0'
        },
        // 下载进度回调
        onDownloadProgress: options.onProgress ? (progressEvent) => {
          const percentCompleted = Math.round((progressEvent.loaded * 100) / progressEvent.total)
          options.onProgress(progressEvent.loaded, progressEvent.total, percentCompleted)
        } : undefined
      })

      // 检查响应状态
      if (response.status !== 200) {
        throw new Error(`下载失败，HTTP状态: ${response.status}`)
      }

      // 检查文件大小
      const contentLength = response.headers['content-length']
      if (contentLength) {
        const fileSize = parseInt(contentLength)
        if (fileSize > maxSize) {
          throw new Error(`文件过大: ${this.formatBytes(fileSize)} > ${this.formatBytes(maxSize)}`)
        }
      }

      // 流式下载
      await new Promise((resolve, reject) => {
        let downloadedBytes = 0
        let lastProgressTime = Date.now()

        response.data.on('data', (chunk) => {
          downloadedBytes += chunk.length
          
          // 检查文件大小限制
          if (downloadedBytes > maxSize) {
            writer.destroy()
            reject(new Error(`下载中止: 文件大小超过限制 ${this.formatBytes(maxSize)}`))
            return
          }

          // 进度回调（限制频率）
          const now = Date.now()
          if (options.onProgress && now - lastProgressTime > 1000) { // 每秒最多一次
            const total = parseInt(contentLength) || downloadedBytes
            const percent = Math.round((downloadedBytes * 100) / total)
            options.onProgress(downloadedBytes, total, percent)
            lastProgressTime = now
          }
        })

        response.data.pipe(writer)
        
        writer.on('finish', () => {
          logger.debug(`[CloudAPI] ✅ 文件下载完成: ${savePath} (${this.formatBytes(downloadedBytes)})`)
          resolve()
        })
        
        writer.on('error', (error) => {
          logger.error(`[CloudAPI] ❌ 文件写入错误: ${error.message}`)
          reject(error)
        })

        response.data.on('error', (error) => {
          logger.error(`[CloudAPI] ❌ 下载流错误: ${error.message}`)
          reject(error)
        })

        // 超时处理
        const timeoutId = setTimeout(() => {
          writer.destroy()
          reject(new Error(`下载超时: ${timeout}ms`))
        }, timeout)

        writer.on('finish', () => clearTimeout(timeoutId))
        writer.on('error', () => clearTimeout(timeoutId))
      })

    } catch (error) {
      // 清理失败的文件
      try {
        if (fs.existsSync(savePath)) {
          fs.unlinkSync(savePath)
        }
      } catch (cleanupError) {
        logger.warn(`[CloudAPI] 清理失败文件时出错: ${cleanupError.message}`)
      }

      if (error.code === 'ECONNABORTED') {
        throw new Error(`下载超时: ${timeout}ms`)
      } else if (error.code === 'ENOTFOUND') {
        throw new Error('网络连接失败，请检查网络配置')
      } else {
        throw error
      }
    }
  }

  /**
   * 健康检查
   * @returns {Promise<boolean>}
   */
  async healthCheck() {
    if (!this.isAvailable()) {
      return false
    }

    // 缓存健康检查结果，避免频繁请求
    const now = Date.now()
    const cacheTime = (this.config.health_check_cache || 30) * 1000
    
    if (now - this.lastHealthCheck < cacheTime) {
      return this.healthStatus
    }

    try {
      const response = await this.client.get('/api/health', { 
        timeout: 10000,
        // 健康检查不重试
        retry: 0
      })
      
      const status = String(response.data?.data?.status || '').toLowerCase()
      const isHealthy = response.status === 200 && response.data?.success && ['ok', 'healthy'].includes(status)
      this.healthStatus = isHealthy
      this.lastHealthCheck = now
      
      if (isHealthy) {
        logger.debug('[CloudAPI] 💚 健康检查通过')
      } else {
        logger.warn('[CloudAPI] 💛 健康检查失败: API响应异常')
      }
      
      return isHealthy

    } catch (error) {
      this.healthStatus = false
      this.lastHealthCheck = now
      
      logger.warn(`[CloudAPI] 💔 健康检查失败: ${error.message}`)
      return false
    }
  }

  /**
   * 获取API统计信息
   * @returns {Promise<object>}
   */
  async getStats() {
    if (!this.isAvailable()) {
      throw new Error('云端API客户端不可用')
    }

    try {
      const response = await this.client.get('/api/stats')
      return response.data?.data || response.data
    } catch (error) {
      if (error.response?.status === 401) {
        throw new Error('获取统计信息需要管理员权限')
      }
      throw new Error(`获取统计信息失败: ${error.message}`)
    }
  }

  /**
   * 重新加载配置
   */
  reloadConfig() {
    logger.info('[CloudAPI] 🔄 重新加载配置...')
    this.initializeClient()
  }

  /**
   * 获取客户端统计信息
   */
  getClientStats() {
    return {
      ...this.stats,
      isAvailable: this.isAvailable(),
      healthStatus: this.healthStatus,
      lastHealthCheck: this.lastHealthCheck,
      config: {
        endpoint: this.config?.api_endpoint,
        timeout: this.config?.timeout,
        enabled: this.config?.enabled
      }
    }
  }

  /**
   * 更新统计信息
   */
  updateStats(success, responseTime) {
    this.stats.totalRequests++
    this.stats.lastRequestTime = Date.now()
    
    if (success) {
      this.stats.successfulRequests++
    } else {
      this.stats.failedRequests++
    }
    
    // 更新平均响应时间
    const total = this.stats.totalRequests
    const currentAvg = this.stats.averageResponseTime
    this.stats.averageResponseTime = (currentAvg * (total - 1) + responseTime) / total
  }

  /**
   * 生成请求ID
   */
  generateRequestId() {
    const timestamp = Date.now().toString(36)
    const random = Math.random().toString(36).substr(2, 5)
    return `${timestamp}_${random}`
  }

  /**
   * 格式化字节数
   */
  formatBytes(bytes) {
    if (bytes === 0) return '0 B'
    
    const k = 1024
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
  }

  /**
   * 队列处理模式（可选功能）
   */
  async addToQueue(requestFn) {
    return new Promise((resolve, reject) => {
      this.requestQueue.push({ requestFn, resolve, reject })
      this.processQueue()
    })
  }

  async processQueue() {
    if (this.isProcessingQueue || this.requestQueue.length === 0) {
      return
    }

    this.isProcessingQueue = true

    while (this.requestQueue.length > 0) {
      const { requestFn, resolve, reject } = this.requestQueue.shift()
      
      try {
        const result = await requestFn()
        resolve(result)
      } catch (error) {
        reject(error)
      }

      // 防止过于频繁的请求
      await new Promise(resolve => setTimeout(resolve, 100))
    }

    this.isProcessingQueue = false
  }

  /**
   * 拉取频道消息
   * @param {Array} channels - 频道配置数组
   * @returns {Promise<Object>} 消息拉取结果
   */
  async fetchChannelMessages(channels) {
    if (!this.isAvailable()) {
      throw new Error('云端API不可用')
    }

    if (!Array.isArray(channels) || channels.length === 0) {
      throw new Error('频道配置不能为空')
    }

    try {
      const startTime = Date.now()
      
      logger.info(`[CloudAPI] 🔄 开始拉取 ${channels.length} 个频道的消息`)

      const requestData = {
        channels: channels.map(channel => ({
          channel_id: channel.id || channel.channel_id || null,
          channel_username: channel.username || channel.channel_username || null,
          state_key: channel.state_key || null,
          last_message_id: channel.last_message_id || 0,
          limit: channel.limit || 50
        }))
      }

      const response = await this.client.post('/api/channel-messages', requestData)
      
      if (!response.data?.success) {
        const error = response.data?.error
        throw new Error(error?.message || 'API返回失败状态')
      }

      const data = response.data.data
      const responseTime = Date.now() - startTime

      // 更新统计
      this.updateStats(responseTime, true)

      logger.info(`[CloudAPI] ✅ 频道消息拉取完成: ${data.summary.total_messages} 条消息 (${responseTime}ms)`)

      return {
        success: true,
        channels: data.results,
        summary: data.summary,
        responseTime
      }

    } catch (error) {
      this.updateStats(0, false)
      logger.error(`[CloudAPI] ❌ 频道消息拉取失败: ${error.message}`)
      throw error
    }
  }

  /**
   * 处理云端消息结果，转换为本地格式
   * @param {Object} cloudMessage - 云端消息格式
   * @returns {Object} 本地消息格式
   */
  convertCloudMessageToLocal(cloudMessage) {
    try {
      const localMessage = {
        message_id: cloudMessage.message_id,
        date: cloudMessage.date,
        chat: cloudMessage.chat,
        text: cloudMessage.text,
        caption: cloudMessage.caption,
        // 转换文件信息
        files: cloudMessage.files || []
      }

      // 处理各种文件类型，将云端下载链接转换为本地可用格式
      for (const file of localMessage.files) {
        // 保留原有的file_id等信息，但使用云端提供的下载链接
        file.cloud_download_url = file.download_url
        // 可以根据需要添加其他转换逻辑
      }

      return localMessage

    } catch (error) {
      logger.error(`[CloudAPI] 消息格式转换失败: ${error.message}`)
      return null
    }
  }

}

// 导出单例实例
export default new CloudTelebotAPI()

