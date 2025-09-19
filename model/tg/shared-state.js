// 统一状态管理模块 (model/tg/shared-state.js)
// 作用：
// - 为yunzai和teelebot提供统一的状态文件格式
// - 管理去重数据和拉取偏移量
// - 确保两个系统状态同步

import fs from 'node:fs'
import path from 'node:path'

// 兼容logger
const logger = globalThis.logger || console

class SharedStateManager {
  constructor() {
    this.pluginRoot = path.join(process.cwd(), 'plugins', 'yunzai-plugin-integration')
    this.stateDir = path.join(this.pluginRoot, 'data', 'tg')
    this.stateFile = path.join(this.stateDir, 'state.json')
    
    // 确保目录存在
    this.ensureDir(this.stateDir)
  }
  
  /**
   * 确保目录存在
   */
  ensureDir(dir) {
    try {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true })
      }
    } catch (error) {
      logger.error(`[SharedState] 创建目录失败: ${error.message}`)
    }
  }
  
  /**
   * 加载状态文件
   */
  loadState() {
    try {
      if (!fs.existsSync(this.stateFile)) {
        return this.getDefaultState()
      }
      
      const raw = fs.readFileSync(this.stateFile, 'utf8')
      const state = JSON.parse(raw)
      
      // 验证状态文件格式
      return this.validateState(state)
      
    } catch (error) {
      logger.error(`[SharedState] 加载状态文件失败: ${error.message}`)
      return this.getDefaultState()
    }
  }
  
  /**
   * 保存状态文件
   */
  saveState(state) {
    try {
      this.ensureDir(this.stateDir)
      
      // 验证并清理状态
      const cleanedState = this.cleanupState(state)
      
      fs.writeFileSync(this.stateFile, JSON.stringify(cleanedState, null, 2), 'utf8')
      logger.debug('[SharedState] 状态文件保存成功')
      
      return true
      
    } catch (error) {
      logger.error(`[SharedState] 保存状态文件失败: ${error.message}`)
      return false
    }
  }
  
  /**
   * 获取默认状态
   */
  getDefaultState() {
    return {
      last_update_id: 0,
      processed: {},
      cleanup_at: Date.now(),
      version: '1.0.0',
      created_at: Date.now()
    }
  }
  
  /**
   * 验证状态文件格式
   */
  validateState(state) {
    if (!state || typeof state !== 'object') {
      return this.getDefaultState()
    }
    
    // 确保必要字段存在
    const validatedState = {
      last_update_id: Number(state.last_update_id) || 0,
      processed: state.processed && typeof state.processed === 'object' ? state.processed : {},
      cleanup_at: Number(state.cleanup_at) || Date.now(),
      version: state.version || '1.0.0',
      created_at: Number(state.created_at) || Date.now()
    }
    
    return validatedState
  }
  
  /**
   * 清理过期的处理记录
   */
  cleanupState(state, ttlDays = 7) {
    const cleanedState = { ...state }
    const cutoffTime = Date.now() - (ttlDays * 24 * 60 * 60 * 1000)
    
    if (cleanedState.processed) {
      for (const channelKey of Object.keys(cleanedState.processed)) {
        const channelData = cleanedState.processed[channelKey]
        
        if (typeof channelData === 'object') {
          // 清理过期的消息记录
          for (const messageId of Object.keys(channelData)) {
            if (Number(channelData[messageId]) < cutoffTime) {
              delete channelData[messageId]
            }
          }
          
          // 如果频道记录为空，删除整个频道记录
          if (Object.keys(channelData).length === 0) {
            delete cleanedState.processed[channelKey]
          }
        }
      }
    }
    
    cleanedState.cleanup_at = Date.now()
    return cleanedState
  }
  
  /**
   * 检查消息是否已处理
   */
  isMessageProcessed(state, channelId, messageId) {
    if (!state.processed) return false
    
    const channelKey = `channel_${channelId}`
    const channelData = state.processed[channelKey]
    
    if (!channelData || typeof channelData !== 'object') return false
    
    return String(messageId) in channelData
  }
  
  /**
   * 标记消息为已处理
   */
  markMessageProcessed(state, channelId, messageId) {
    if (!state.processed) {
      state.processed = {}
    }
    
    const channelKey = `channel_${channelId}`
    if (!state.processed[channelKey]) {
      state.processed[channelKey] = {}
    }
    
    state.processed[channelKey][String(messageId)] = Date.now()
    
    return state
  }
  
  /**
   * 更新拉取偏移量
   */
  updateLastUpdateId(state, updateId) {
    state.last_update_id = Math.max(state.last_update_id || 0, Number(updateId) || 0)
    return state
  }
  
  /**
   * 获取统计信息
   */
  getStatistics(state) {
    const stats = {
      last_update_id: state.last_update_id || 0,
      channels_count: 0,
      total_processed: 0,
      cleanup_at: state.cleanup_at || 0,
      version: state.version || '1.0.0',
      created_at: state.created_at || 0
    }
    
    if (state.processed) {
      stats.channels_count = Object.keys(state.processed).length
      
      for (const channelData of Object.values(state.processed)) {
        if (typeof channelData === 'object') {
          stats.total_processed += Object.keys(channelData).length
        }
      }
    }
    
    return stats
  }
  
  /**
   * 获取状态文件路径（供teelebot使用）
   */
  getStateFilePath() {
    return this.stateFile
  }
  
  /**
   * 检查状态文件是否存在
   */
  exists() {
    return fs.existsSync(this.stateFile)
  }
  
  /**
   * 创建状态文件锁（防止并发写入）
   */
  async withLock(operation) {
    const lockFile = this.stateFile + '.lock'
    const maxWaitTime = 5000 // 5秒超时
    const checkInterval = 100 // 100ms检查间隔
    
    let waitTime = 0
    
    // 等待锁释放
    while (fs.existsSync(lockFile) && waitTime < maxWaitTime) {
      await new Promise(resolve => setTimeout(resolve, checkInterval))
      waitTime += checkInterval
    }
    
    if (waitTime >= maxWaitTime) {
      logger.warn('[SharedState] 等待文件锁超时，强制执行操作')
    }
    
    try {
      // 创建锁文件
      fs.writeFileSync(lockFile, String(Date.now()), 'utf8')
      
      // 执行操作
      const result = await operation()
      
      return result
      
    } finally {
      // 释放锁
      try {
        if (fs.existsSync(lockFile)) {
          fs.unlinkSync(lockFile)
        }
      } catch (error) {
        logger.warn(`[SharedState] 释放文件锁失败: ${error.message}`)
      }
    }
  }
}

// 导出单例实例
export default new SharedStateManager()