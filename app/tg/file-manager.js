import fs from 'node:fs'
import path from 'node:path'
import { promisify } from 'node:util'

// 兼容logger
const logger = globalThis.logger || console

const stat = promisify(fs.stat)
const readdir = promisify(fs.readdir)
const unlink = promisify(fs.unlink)
const rmdir = promisify(fs.rmdir)

class FileManager {
  constructor() {
    this.pluginRoot = path.join(process.cwd(), 'plugins', 'yunzai-plugin-integration')
    this.tempDir = path.join(this.pluginRoot, 'data', 'temp', 'tg')
    this.cleanupInterval = null
    this.startAutoCleanup()
  }

  /**
   * 确保目录存在
   */
  ensureDir(dir) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true })
      logger.debug(`[FileManager] 创建目录: ${dir}`)
    }
  }

  /**
   * 构建下载目录路径
   * 按频道和日期组织文件
   */
  buildDownloadDir(baseDir, channelKey) {
    const date = new Date()
    const year = date.getFullYear()
    const month = String(date.getMonth() + 1).padStart(2, '0')
    const day = String(date.getDate()).padStart(2, '0')
    
    // 清理频道键，移除无效字符
    const cleanChannelKey = String(channelKey).replace(/[<>:"/\\|?*]/g, '_')
    
    const defaultDir = this.tempDir
    const targetDir = path.join(
      process.cwd(), 
      baseDir || defaultDir, 
      cleanChannelKey, 
      `${year}${month}${day}`
    )
    
    this.ensureDir(targetDir)
    return targetDir
  }

  /**
   * 路径转file:// URL格式
   */
  toFileUrl(filePath) {
    // 统一使用正斜杠，确保跨平台兼容性
    const normalizedPath = filePath.replace(/\\/g, '/')
    return 'file://' + normalizedPath
  }

  /**
   * 内容过滤器
   * 移除或替换敏感内容
   */
  filterContent(text, config) {
    if (!text || typeof text !== 'string') return text
    
    const filters = config?.filters
    if (!filters?.enable) return text
    
    let filteredText = text
    
    try {
      // 过滤Telegram域名
      if (filters.remove_telegram_domains && Array.isArray(filters.telegram_domains)) {
        for (const domain of filters.telegram_domains) {
          const escapedDomain = domain.replace('.', '\\.')
          const regex = new RegExp(`https?://${escapedDomain}`, 'gi')
          filteredText = filteredText.replace(regex, 'https://t.me')
        }
      }
      
      // 过滤敏感关键词
      if (filters.sensitive_keywords && Array.isArray(filters.sensitive_keywords)) {
        for (const keyword of filters.sensitive_keywords) {
          const regex = new RegExp(keyword, 'gi')
          filteredText = filteredText.replace(regex, '***')
        }
      }
      
      // 移除过长的链接
      if (filters.max_url_length) {
        const urlRegex = /https?:\/\/[^\s]+/g
        filteredText = filteredText.replace(urlRegex, (url) => {
          if (url.length > filters.max_url_length) {
            return url.substring(0, filters.max_url_length) + '...'
          }
          return url
        })
      }
      
    } catch (error) {
      logger.warn(`[FileManager] 内容过滤出错: ${error.message}`)
    }
    
    return filteredText
  }

  /**
   * 创建合适的消息段
   * 根据文件类型和大小选择最佳的消息格式
   */
  createMessageSegment(filePath, mimeType, ext, fileName) {
    const fileUrl = this.toFileUrl(filePath)
    const lowerExt = (ext || '').toLowerCase()
    
    try {
      // 图片类型
      if (this.isImageFile(mimeType, lowerExt)) {
        return segment.image(fileUrl)
      }
      
      // 视频类型
      if (this.isVideoFile(mimeType, lowerExt)) {
        if (typeof segment.video === 'function') {
          return segment.video(fileUrl)
        } else {
          return `(视频已保存: ${fileName || path.basename(filePath)})`
        }
      }
      
      // 音频类型
      if (this.isAudioFile(mimeType, lowerExt)) {
        if (typeof segment.record === 'function') {
          return segment.record(fileUrl)
        } else if (typeof segment.file === 'function') {
          return segment.file(fileUrl)
        } else {
          return `(音频已保存: ${fileName || path.basename(filePath)})`
        }
      }
      
      // 其他文件类型
      if (typeof segment.file === 'function') {
        return segment.file(fileUrl)
      } else {
        return `(文件已保存: ${fileName || path.basename(filePath)})`
      }
      
    } catch (error) {
      logger.warn(`[FileManager] 创建消息段失败: ${error.message}`)
      return `(文件已保存: ${fileName || path.basename(filePath)})`
    }
  }

  /**
   * 判断是否为图片文件
   */
  isImageFile(mimeType, ext) {
    const imageMimes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp', 'image/bmp']
    const imageExts = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp']
    
    return (mimeType && imageMimes.includes(mimeType.toLowerCase())) || 
           imageExts.includes(ext)
  }

  /**
   * 判断是否为视频文件
   */
  isVideoFile(mimeType, ext) {
    const videoMimes = ['video/mp4', 'video/mpeg', 'video/quicktime', 'video/x-msvideo', 'video/webm']
    const videoExts = ['.mp4', '.mov', '.mkv', '.avi', '.webm', '.flv', '.wmv']
    
    return (mimeType && videoMimes.some(mime => mimeType.toLowerCase().startsWith(mime))) ||
           videoExts.includes(ext)
  }

  /**
   * 判断是否为音频文件
   */
  isAudioFile(mimeType, ext) {
    const audioMimes = ['audio/mpeg', 'audio/wav', 'audio/ogg', 'audio/mp4', 'audio/aac']
    const audioExts = ['.mp3', '.wav', '.ogg', '.m4a', '.aac', '.flac']
    
    return (mimeType && audioMimes.some(mime => mimeType.toLowerCase().startsWith(mime))) ||
           audioExts.includes(ext)
  }

  /**
   * 清理临时文件
   */
  cleanupFiles(files) {
    if (!Array.isArray(files)) return
    
    let cleanedCount = 0
    let cleanedSize = 0
    
    for (const file of files) {
      try {
        if (fs.existsSync(file)) {
          const stats = fs.statSync(file)
          fs.unlinkSync(file)
          cleanedCount++
          cleanedSize += stats.size
          logger.debug(`[FileManager] 清理文件: ${path.basename(file)}`)
        }
      } catch (error) {
        logger.warn(`[FileManager] 清理文件失败: ${file} - ${error.message}`)
      }
    }
    
    if (cleanedCount > 0) {
      logger.info(`[FileManager] 清理完成: ${cleanedCount} 个文件, ${this.formatBytes(cleanedSize)}`)
    }
  }

  /**
   * 获取文件大小
   */
  async getFileSize(filePath) {
    try {
      const stats = await stat(filePath)
      return stats.size
    } catch {
      return 0
    }
  }

  /**
   * 获取文件信息
   */
  async getFileInfo(filePath) {
    try {
      const stats = await stat(filePath)
      const ext = path.extname(filePath).toLowerCase()
      
      return {
        name: path.basename(filePath),
        size: stats.size,
        extension: ext,
        type: this.getFileTypeByExtension(ext),
        created: stats.birthtime,
        modified: stats.mtime,
        isDirectory: stats.isDirectory(),
        isFile: stats.isFile()
      }
    } catch (error) {
      logger.warn(`[FileManager] 获取文件信息失败: ${filePath} - ${error.message}`)
      return null
    }
  }

  /**
   * 根据扩展名获取文件类型
   */
  getFileTypeByExtension(ext) {
    const typeMap = {
      // 图片
      '.jpg': 'image', '.jpeg': 'image', '.png': 'image', '.gif': 'image', '.webp': 'image', '.bmp': 'image',
      // 视频
      '.mp4': 'video', '.mov': 'video', '.mkv': 'video', '.avi': 'video', '.webm': 'video', '.flv': 'video',
      // 音频
      '.mp3': 'audio', '.wav': 'audio', '.ogg': 'audio', '.m4a': 'audio', '.aac': 'audio', '.flac': 'audio',
      // 文档
      '.pdf': 'document', '.doc': 'document', '.docx': 'document', '.txt': 'document', '.rtf': 'document',
      '.xls': 'document', '.xlsx': 'document', '.ppt': 'document', '.pptx': 'document',
      // 压缩文件
      '.zip': 'archive', '.rar': 'archive', '.7z': 'archive', '.tar': 'archive', '.gz': 'archive'
    }
    
    return typeMap[ext] || 'file'
  }

  /**
   * 批量清理过期文件
   */
  async cleanupExpiredFiles(baseDir, maxAgeDays = 7) {
    const maxAge = maxAgeDays * 24 * 60 * 60 * 1000 // 转换为毫秒
    const now = Date.now()
    let cleanedCount = 0
    let cleanedBytes = 0
    let processedDirs = 0

    const cleanDir = async (dir) => {
      try {
        const entries = await readdir(dir, { withFileTypes: true })
        processedDirs++
        
        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name)
          
          if (entry.isDirectory()) {
            // 递归清理子目录
            await cleanDir(fullPath)
            
            // 检查目录是否为空，如果为空则删除
            try {
              const subEntries = await readdir(fullPath)
              if (subEntries.length === 0) {
                await rmdir(fullPath)
                logger.debug(`[FileManager] 删除空目录: ${fullPath}`)
              }
            } catch (error) {
              logger.debug(`[FileManager] 检查空目录失败: ${fullPath} - ${error.message}`)
            }
            
          } else if (entry.isFile()) {
            try {
              const stats = await stat(fullPath)
              const age = now - stats.mtime.getTime()
              
              if (age > maxAge) {
                cleanedBytes += stats.size
                await unlink(fullPath)
                cleanedCount++
                logger.debug(`[FileManager] 删除过期文件: ${path.basename(fullPath)} (${this.formatBytes(stats.size)})`)
              }
            } catch (error) {
              logger.warn(`[FileManager] 处理文件时出错: ${fullPath} - ${error.message}`)
            }
          }
        }
      } catch (error) {
        logger.warn(`[FileManager] 清理目录时出错: ${dir} - ${error.message}`)
      }
    }

    const targetDir = path.join(process.cwd(), baseDir || this.tempDir)
    
    if (fs.existsSync(targetDir)) {
      logger.info(`[FileManager] 开始清理过期文件: ${targetDir} (${maxAgeDays}天前)`)
      await cleanDir(targetDir)
      
      const result = {
        cleanedFiles: cleanedCount,
        cleanedBytes: cleanedBytes,
        processedDirs: processedDirs,
        cleanedSize: this.formatBytes(cleanedBytes)
      }
      
      if (cleanedCount > 0) {
        logger.info(`[FileManager] 清理完成: ${cleanedCount} 个文件, ${result.cleanedSize}, 检查了 ${processedDirs} 个目录`)
      } else {
        logger.debug(`[FileManager] 清理完成: 无过期文件, 检查了 ${processedDirs} 个目录`)
      }
      
      return result
    } else {
      logger.debug(`[FileManager] 目标目录不存在: ${targetDir}`)
      return { cleanedFiles: 0, cleanedBytes: 0, processedDirs: 0, cleanedSize: '0 B' }
    }
  }

  /**
   * 获取目录统计信息
   */
  async getDirectoryStats(baseDir) {
    const targetDir = path.join(process.cwd(), baseDir || this.tempDir)
    
    if (!fs.existsSync(targetDir)) {
      return { totalFiles: 0, totalSize: 0, totalDirs: 0, formattedSize: '0 B' }
    }

    let totalFiles = 0
    let totalSize = 0
    let totalDirs = 0

    const scanDir = async (dir) => {
      try {
        const entries = await readdir(dir, { withFileTypes: true })
        
        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name)
          
          if (entry.isDirectory()) {
            totalDirs++
            await scanDir(fullPath)
          } else if (entry.isFile()) {
            totalFiles++
            try {
              const stats = await stat(fullPath)
              totalSize += stats.size
            } catch {}
          }
        }
      } catch (error) {
        logger.warn(`[FileManager] 扫描目录失败: ${dir} - ${error.message}`)
      }
    }

    await scanDir(targetDir)

    return {
      totalFiles,
      totalSize,
      totalDirs,
      formattedSize: this.formatBytes(totalSize)
    }
  }

  /**
   * 启动自动清理
   */
  startAutoCleanup() {
    // 每6小时执行一次自动清理
    this.cleanupInterval = setInterval(async () => {
      try {
        const config = await import('../../model/tg/tg-setting.js').then(m => m.default.getConfig())
        const downloadConfig = config.download || {}
        
        if (downloadConfig.auto_cleanup !== false) {
          const maxAge = downloadConfig.cleanup_days || 7
          await this.cleanupExpiredFiles(downloadConfig.dir, maxAge)
        }
      } catch (error) {
        logger.error(`[FileManager] 自动清理失败: ${error.message}`)
      }
    }, 6 * 60 * 60 * 1000) // 6小时

    logger.info('[FileManager] 自动清理定时器已启动 (每6小时)')
  }

  /**
   * 停止自动清理
   */
  stopAutoCleanup() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval)
      this.cleanupInterval = null
      logger.info('[FileManager] 自动清理定时器已停止')
    }
  }

  /**
   * 格式化字节数为可读字符串
   */
  formatBytes(bytes) {
    if (bytes === 0) return '0 B'
    
    const k = 1024
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
  }

  /**
   * 创建安全的文件名
   */
  createSafeFileName(originalName, maxLength = 100) {
    if (!originalName) return 'unnamed_file'
    
    // 移除或替换危险字符
    let safeName = originalName
      .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
      .replace(/\s+/g, '_')
      .replace(/_{2,}/g, '_')
      .trim()
    
    // 限制长度
    if (safeName.length > maxLength) {
      const ext = path.extname(safeName)
      const nameWithoutExt = path.basename(safeName, ext)
      const truncatedName = nameWithoutExt.substring(0, maxLength - ext.length - 1)
      safeName = truncatedName + ext
    }
    
    return safeName || 'unnamed_file'
  }

  /**
   * 生成唯一文件名
   */
  generateUniqueFileName(dir, baseName) {
    let counter = 0
    let fileName = baseName
    
    while (fs.existsSync(path.join(dir, fileName))) {
      counter++
      const ext = path.extname(baseName)
      const nameWithoutExt = path.basename(baseName, ext)
      fileName = `${nameWithoutExt}_${counter}${ext}`
    }
    
    return fileName
  }

  /**
   * 检查磁盘空间
   */
  async checkDiskSpace(dir) {
    try {
      // 这里可以集成更复杂的磁盘空间检查逻辑
      // 目前简单返回目录是否可写
      const testFile = path.join(dir, '.disk_test_' + Date.now())
      
      fs.writeFileSync(testFile, 'test')
      fs.unlinkSync(testFile)
      
      return { available: true, writeable: true }
    } catch (error) {
      logger.warn(`[FileManager] 磁盘空间检查失败: ${error.message}`)
      return { available: false, writeable: false, error: error.message }
    }
  }
}

export default FileManager