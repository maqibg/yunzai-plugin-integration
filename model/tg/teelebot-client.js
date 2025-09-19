// teelebot通信客户端模块 (model/tg/teelebot-client.js)
// 作用：
// - 与teelebot插件的HTTP API进行通信
// - 处理拉取请求和状态查询
// - 管理连接池和错误处理

import axios from 'axios'
import path from 'node:path'
import fs from 'node:fs'

// 兼容logger
const logger = globalThis.logger || console

class TeelebotClient {
  constructor(config = {}) {
    this.apiUrl = config.api_url || 'http://localhost:8089'
    this.timeout = config.timeout || 30000
    this.retryAttempts = config.retry_attempts || 3
    this.retryDelay = config.retry_delay || 1000
    
    // 创建axios实例
    this.httpClient = axios.create({
      baseURL: this.apiUrl,
      timeout: this.timeout,
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'yunzai-plugin-integration/1.0.0'
      }
    })
    
    // 请求拦截器
    this.httpClient.interceptors.request.use(
      config => {
        logger.debug(`[TgClient] 发送请求: ${config.method.toUpperCase()} ${config.url}`)
        return config
      },
      error => {
        logger.error(`[TgClient] 请求拦截异常: ${error.message}`)
        return Promise.reject(error)
      }
    )
    
    // 响应拦截器
    this.httpClient.interceptors.response.use(
      response => {
        logger.debug(`[TgClient] 收到响应: ${response.status} ${response.config.url}`)
        return response
      },
      error => {
        logger.error(`[TgClient] 响应异常: ${error.message}`)
        return Promise.reject(error)
      }
    )
  }
  
  /**
   * 检查teelebot服务健康状态
   */
  async checkHealth() {
    try {
      const response = await this.httpClient.get('/api/tg/health')
      const isHealthy = response.data?.success === true
      
      if (isHealthy) {
        logger.debug('[TgClient] teelebot服务健康')
      } else {
        logger.warn('[TgClient] teelebot服务状态异常')
      }
      
      return {
        success: isHealthy,
        status: response.data?.status || 'unknown',
        timestamp: response.data?.timestamp || Date.now()
      }
      
    } catch (error) {
      logger.error(`[TgClient] 健康检查失败: ${error.message}`)
      return {
        success: false,
        error: error.message,
        timestamp: Date.now()
      }
    }
  }
  
  /**
   * 获取teelebot状态信息
   */
  async getStatus() {
    try {
      const response = await this.httpClient.get('/api/tg/status')
      
      if (response.data?.success) {
        logger.debug('[TgClient] 获取状态成功')
        return {
          success: true,
          data: response.data,
          timestamp: Date.now()
        }
      } else {
        logger.warn('[TgClient] 获取状态失败')
        return {
          success: false,
          error: '状态响应无效',
          timestamp: Date.now()
        }
      }
      
    } catch (error) {
      logger.error(`[TgClient] 获取状态异常: ${error.message}`)
      return {
        success: false,
        error: error.message,
        timestamp: Date.now()
      }
    }
  }
  
  /**
   * 拉取Telegram消息
   */
  async pullMessages(options = {}) {
    const {
      channels = [],
      download_dir = './download',
      state_file = '',
      batch_size = 50
    } = options
    
    try {
      logger.info(`[TgClient] 开始拉取消息: ${channels.length} 个频道`)
      
      // 验证参数
      if (!Array.isArray(channels) || channels.length === 0) {
        throw new Error('频道列表不能为空')
      }
      
      // 发送拉取请求
      const response = await this.retryRequest(async () => {
        return await this.httpClient.post('/api/tg/pull', {
          channels,
          download_dir,
          state_file,
          batch_size
        })
      })
      
      if (response.data?.success) {
        const files = response.data.files || []
        const lastUpdateId = response.data.last_update_id || 0
        
        logger.info(`[TgClient] 拉取完成: ${files.length} 个文件`)
        
        return {
          success: true,
          files,
          last_update_id: lastUpdateId,
          processed_count: files.length,
          message: response.data.message || '拉取完成',
          timestamp: Date.now()
        }
      } else {
        throw new Error(response.data?.error || '拉取请求失败')
      }
      
    } catch (error) {
      logger.error(`[TgClient] 拉取消息异常: ${error.message}`)
      return {
        success: false,
        error: error.message,
        files: [],
        timestamp: Date.now()
      }
    }
  }
  
  /**
   * 清理下载文件
   */
  async cleanupFiles(options = {}) {
    const {
      days = 7,
      dir = './download'
    } = options
    
    try {
      logger.info(`[TgClient] 开始清理文件: ${days} 天前`)
      
      const response = await this.httpClient.delete('/api/tg/cleanup', {
        params: { days, dir }
      })
      
      if (response.data?.success) {
        const cleanedFiles = response.data.cleaned_files || []
        
        logger.info(`[TgClient] 清理完成: ${cleanedFiles.length} 个文件`)
        
        return {
          success: true,
          cleaned_files: cleanedFiles,
          cleaned_count: cleanedFiles.length,
          message: response.data.message || '清理完成',
          timestamp: Date.now()
        }
      } else {
        throw new Error(response.data?.error || '清理请求失败')
      }
      
    } catch (error) {
      logger.error(`[TgClient] 清理文件异常: ${error.message}`)
      return {
        success: false,
        error: error.message,
        cleaned_files: [],
        timestamp: Date.now()
      }
    }
  }
  
  /**
   * 配置teelebot监控
   */
  async configure(options = {}) {
    const {
      channels = [],
      is_monitoring = false
    } = options
    
    try {
      logger.info('[TgClient] 更新teelebot配置')
      
      const response = await this.httpClient.post('/api/tg/configure', {
        channels,
        is_monitoring
      })
      
      if (response.data?.success) {
        logger.info('[TgClient] 配置更新成功')
        return {
          success: true,
          monitor_state: response.data.monitor_state,
          message: response.data.message || '配置更新成功',
          timestamp: Date.now()
        }
      } else {
        throw new Error(response.data?.error || '配置更新失败')
      }
      
    } catch (error) {
      logger.error(`[TgClient] 配置更新异常: ${error.message}`)
      return {
        success: false,
        error: error.message,
        timestamp: Date.now()
      }
    }
  }
  
  /**
   * 重试请求
   */
  async retryRequest(requestFn, attempts = this.retryAttempts) {
    let lastError = null
    
    for (let i = 0; i < attempts; i++) {
      try {
        return await requestFn()
      } catch (error) {
        lastError = error
        
        if (i < attempts - 1) {
          const delay = this.retryDelay * Math.pow(2, i) // 指数退避
          logger.warn(`[TgClient] 请求失败，${delay}ms后重试 (${i + 1}/${attempts}): ${error.message}`)
          await this.sleep(delay)
        }
      }
    }
    
    throw lastError
  }
  
  /**
   * 睡眠函数
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms))
  }
  
  /**
   * 验证文件是否存在
   */
  async validateDownloadedFiles(files) {
    const validFiles = []
    const invalidFiles = []
    
    for (const file of files) {
      try {
        if (file.path && fs.existsSync(file.path)) {
          const stat = fs.statSync(file.path)
          if (stat.isFile()) {
            validFiles.push({
              ...file,
              actual_size: stat.size,
              modified_time: stat.mtime
            })
          } else {
            invalidFiles.push({ ...file, error: '不是有效文件' })
          }
        } else {
          invalidFiles.push({ ...file, error: '文件不存在' })
        }
      } catch (error) {
        invalidFiles.push({ ...file, error: error.message })
      }
    }
    
    if (invalidFiles.length > 0) {
      logger.warn(`[TgClient] 发现 ${invalidFiles.length} 个无效文件`)
    }
    
    return {
      valid_files: validFiles,
      invalid_files: invalidFiles,
      valid_count: validFiles.length,
      invalid_count: invalidFiles.length
    }
  }
  
  /**
   * 处理下载文件为yunzai格式
   */
  async processDownloadedFiles(files, config = {}) {
    const processedFiles = []
    
    try {
      // 验证文件
      const validation = await this.validateDownloadedFiles(files)
      
      for (const file of validation.valid_files) {
        try {
          const processed = await this.convertFileToYunzaiFormat(file, config)
          if (processed) {
            processedFiles.push(processed)
          }
        } catch (error) {
          logger.error(`[TgClient] 处理文件失败 ${file.path}: ${error.message}`)
        }
      }
      
      logger.info(`[TgClient] 文件处理完成: ${processedFiles.length}/${files.length}`)
      
      return {
        success: true,
        processed_files: processedFiles,
        processed_count: processedFiles.length,
        total_count: files.length,
        invalid_files: validation.invalid_files
      }
      
    } catch (error) {
      logger.error(`[TgClient] 处理文件异常: ${error.message}`)
      return {
        success: false,
        error: error.message,
        processed_files: [],
        processed_count: 0
      }
    }
  }
  
  /**
   * 转换文件为yunzai格式
   */
  async convertFileToYunzaiFormat(file, config = {}) {
    try {
      const filePath = file.path
      const fileType = file.type
      
      // 工具：路径转 file:// 统一斜杠
      const toFileUrl = (p) => 'file://' + p.replace(/\\/g, '/')
      
      switch (fileType) {
        case 'text':
          // 文本内容直接返回
          if (fs.existsSync(filePath)) {
            const textContent = fs.readFileSync(filePath, 'utf-8')
            return textContent
          }
          break
          
        case 'photo':
          // 图片转为segment
          return segment.image(toFileUrl(filePath))
          
        case 'video':
          // 视频转为segment
          try {
            if (typeof segment.video === 'function') {
              return segment.video(toFileUrl(filePath))
            } else {
              return `(视频已保存: ${path.basename(filePath)})`
            }
          } catch (e) {
            return `(视频已保存: ${path.basename(filePath)})`
          }
          
        case 'audio':
        case 'voice':
          // 音频转为segment
          try {
            if (typeof segment.record === 'function') {
              return segment.record(toFileUrl(filePath))
            } else if (typeof segment.file === 'function') {
              return segment.file(toFileUrl(filePath))
            } else {
              return `(音频已保存: ${path.basename(filePath)})`
            }
          } catch (e) {
            return `(音频已保存: ${path.basename(filePath)})`
          }
          
        case 'document':
          // 文档处理
          try {
            const ext = path.extname(filePath).toLowerCase()
            const mimeType = file.mime_type || ''
            
            if (mimeType.startsWith('image/') || ['.jpg', '.jpeg', '.png', '.gif', '.webp'].includes(ext)) {
              return segment.image(toFileUrl(filePath))
            } else if (mimeType.startsWith('video/') || ['.mp4', '.mov', '.mkv', '.avi', '.webm'].includes(ext)) {
              if (typeof segment.video === 'function') {
                return segment.video(toFileUrl(filePath))
              } else {
                return `(视频已保存: ${path.basename(filePath)})`
              }
            } else {
              if (typeof segment.file === 'function') {
                return segment.file(toFileUrl(filePath))
              } else {
                return `(文件已保存: ${path.basename(filePath)})`
              }
            }
          } catch (e) {
            return `(文件已保存: ${path.basename(filePath)})`
          }
          
        default:
          return `(文件已保存: ${path.basename(filePath)})`
      }
      
    } catch (error) {
      logger.error(`[TgClient] 转换文件格式异常: ${error.message}`)
      return null
    }
  }
}

export default TeelebotClient