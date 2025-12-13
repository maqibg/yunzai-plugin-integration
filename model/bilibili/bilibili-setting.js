/**
 * Bilibili 配置管理类
 * 提供配置读取、写入、热更新功能
 */
import fs from 'node:fs'
import path from 'node:path'
import YAML from 'yaml'
import chokidar from 'chokidar'
import { DATA_DIR, TEMP_DIR } from './bilibili-const.js'

const _path = process.cwd()
const pluginRoot = path.join(_path, 'plugins', 'yunzai-plugin-integration')

class BilibiliSetting {
  constructor() {
    this.defPath = path.join(pluginRoot, 'config', 'default')
    this.configPath = path.join(pluginRoot, 'config')
    this.dataPath = path.join(pluginRoot, DATA_DIR)
    this.tempPath = path.join(pluginRoot, TEMP_DIR)

    // 配置缓存
    this.config = {}
    this.def = {}
    this.watcher = {}

    this.initPaths()
  }

  /**
   * 初始化必要的目录和配置文件
   */
  initPaths() {
    const dirs = [this.configPath, this.dataPath, this.tempPath]
    for (const dir of dirs) {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true })
      }
    }

    // 检查并复制默认配置文件
    this.ensureConfigFile()
  }

  /**
   * 确保配置文件存在，不存在则从默认配置复制
   */
  ensureConfigFile() {
    const configFile = path.join(this.configPath, 'bilibili.yaml')
    const defFile = path.join(this.defPath, 'default-bilibili.yaml')

    if (!fs.existsSync(configFile) && fs.existsSync(defFile)) {
      try {
        fs.copyFileSync(defFile, configFile)
        logger.info('[Bilibili] 已自动创建配置文件: bilibili.yaml')
      } catch (error) {
        logger.error(`[Bilibili] 创建配置文件失败: ${error.message}`)
      }
    }
  }

  /**
   * 获取配置文件路径
   * @param {string} type 类型: 'def' | 'config'
   */
  getFilePath(type = 'config') {
    if (type === 'def') {
      return path.join(this.defPath, 'default-bilibili.yaml')
    } else {
      const configFile = path.join(this.configPath, 'bilibili.yaml')
      const defFile = path.join(this.defPath, 'default-bilibili.yaml')

      // 如果用户配置不存在，从默认配置复制
      if (!fs.existsSync(configFile) && fs.existsSync(defFile)) {
        try {
          fs.copyFileSync(defFile, configFile)
          logger.info('[Bilibili] 已创建配置文件: bilibili.yaml')
        } catch (error) {
          logger.error(`[Bilibili] 创建配置文件失败: ${error.message}`)
        }
      }
      return configFile
    }
  }

  /**
   * 读取YAML配置文件
   * @param {string} type 类型: 'def' | 'config'
   */
  getYaml(type = 'config') {
    if (this[type].bilibili) return this[type].bilibili

    const filePath = this.getFilePath(type)
    if (!fs.existsSync(filePath)) {
      logger.warn(`[Bilibili] 配置文件不存在: ${filePath}`)
      return {}
    }

    try {
      const content = fs.readFileSync(filePath, 'utf8')
      const data = YAML.parse(content)
      this[type].bilibili = data || {}
      this.watch(filePath, type)
      return this[type].bilibili
    } catch (error) {
      logger.error(`[Bilibili] 读取配置文件失败: ${error.message}`)
      return {}
    }
  }

  /**
   * 获取默认配置
   */
  getDefConfig() {
    return this.getYaml('def')
  }

  /**
   * 获取用户配置（合并默认配置）
   */
  getConfig() {
    const defConfig = this.getDefConfig()
    const userConfig = this.getYaml('config')
    return this.deepMerge(defConfig, userConfig)
  }

  /**
   * 深度合并对象
   */
  deepMerge(target, source) {
    const result = { ...target }
    for (const key in source) {
      if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
        result[key] = this.deepMerge(result[key] || {}, source[key])
      } else {
        result[key] = source[key]
      }
    }
    return result
  }

  /**
   * 保存配置（保留注释）
   * @param {object} data 配置数据
   */
  setConfig(data) {
    const filePath = this.getFilePath('config')
    try {
      let yamlContent = ''

      if (fs.existsSync(filePath)) {
        const originalContent = fs.readFileSync(filePath, 'utf8')
        try {
          const doc = YAML.parseDocument(originalContent)
          this.updateYamlDocument(doc, data)
          yamlContent = doc.toString()
        } catch (parseError) {
          logger.warn(`[Bilibili] 无法保留注释，使用常规保存: ${parseError.message}`)
          yamlContent = YAML.stringify(data)
        }
      } else {
        yamlContent = YAML.stringify(data)
      }

      fs.writeFileSync(filePath, yamlContent, 'utf8')
      delete this.config.bilibili
      logger.info('[Bilibili] 保存配置成功')
      return true
    } catch (error) {
      logger.error(`[Bilibili] 保存配置失败: ${error.message}`)
      return false
    }
  }

  /**
   * 更新单个配置项
   * @param {string} key 配置键（支持点号分隔，如 'video.quality'）
   * @param {any} value 配置值
   */
  setConfigItem(key, value) {
    const config = this.getConfig()
    const keys = key.split('.')
    let obj = config

    for (let i = 0; i < keys.length - 1; i++) {
      if (!obj[keys[i]]) obj[keys[i]] = {}
      obj = obj[keys[i]]
    }
    obj[keys[keys.length - 1]] = value

    return this.setConfig(config)
  }

  /**
   * 递归更新YAML文档节点，保留注释
   */
  updateYamlDocument(doc, data) {
    if (!doc.contents) return

    const updateNode = (node, newData) => {
      if (node && node.items) {
        for (const item of node.items) {
          if (item.key && item.key.value && Object.prototype.hasOwnProperty.call(newData, item.key.value)) {
            const key = item.key.value
            const newValue = newData[key]

            if (typeof newValue === 'object' && newValue !== null && !Array.isArray(newValue)) {
              if (item.value && item.value.items) {
                updateNode(item.value, newValue)
              }
            } else {
              item.value = doc.createNode(newValue)
            }
          }
        }

        for (const [key, value] of Object.entries(newData)) {
          const exists = node.items.some(item => item.key && item.key.value === key)
          if (!exists) {
            const keyNode = doc.createNode(key)
            const valueNode = doc.createNode(value)
            node.items.push(doc.createPair(keyNode, valueNode))
          }
        }
      }
    }

    updateNode(doc.contents, data)
  }

  /**
   * 监听配置文件变化
   */
  watch(filePath, type) {
    const watchKey = `${type}_bilibili`
    if (this.watcher[watchKey]) return

    try {
      const watcher = chokidar.watch(filePath)
      watcher.on('change', () => {
        delete this[type].bilibili
        logger.mark(`[Bilibili] 配置文件已更新 [${type}]`)
      })
      this.watcher[watchKey] = watcher
    } catch (error) {
      logger.warn(`[Bilibili] 监听配置文件失败: ${error.message}`)
    }
  }

  /**
   * 获取数据文件路径
   */
  getDataFilePath(name) {
    return path.join(this.dataPath, `${name}.json`)
  }

  /**
   * 保存数据文件
   */
  setData(name, data) {
    const filePath = this.getDataFilePath(name)
    try {
      fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8')
      return true
    } catch (error) {
      logger.error(`[Bilibili] 保存数据失败 [${name}]: ${error.message}`)
      return false
    }
  }

  /**
   * 读取数据文件
   */
  getData(name) {
    const filePath = this.getDataFilePath(name)
    if (!fs.existsSync(filePath)) return null

    try {
      const content = fs.readFileSync(filePath, 'utf8')
      return JSON.parse(content)
    } catch (error) {
      logger.error(`[Bilibili] 读取数据失败 [${name}]: ${error.message}`)
      return null
    }
  }

  /**
   * 获取临时文件路径
   */
  getTempFilePath(filename) {
    return path.join(this.tempPath, filename)
  }

  /**
   * 清空临时文件
   */
  clearTemp() {
    try {
      if (fs.existsSync(this.tempPath)) {
        fs.rmSync(this.tempPath, { recursive: true })
        fs.mkdirSync(this.tempPath, { recursive: true })
      }
      return true
    } catch (error) {
      logger.error(`[Bilibili] 清空缓存失败: ${error.message}`)
      return false
    }
  }

  /**
   * 获取推送配置文件路径
   */
  getPushFilePath() {
    return path.join(this.dataPath, 'push.yaml')
  }

  /**
   * 获取推送配置
   */
  getPushConfig() {
    const filePath = this.getPushFilePath()
    if (!fs.existsSync(filePath)) return {}

    try {
      const content = fs.readFileSync(filePath, 'utf8')
      return YAML.parse(content) || {}
    } catch (error) {
      logger.error(`[Bilibili] 读取推送配置失败: ${error.message}`)
      return {}
    }
  }

  /**
   * 保存推送配置
   */
  setPushConfig(data) {
    const filePath = this.getPushFilePath()
    try {
      fs.writeFileSync(filePath, YAML.stringify(data), 'utf8')
      return true
    } catch (error) {
      logger.error(`[Bilibili] 保存推送配置失败: ${error.message}`)
      return false
    }
  }

  /**
   * 添加推送订阅
   */
  addPushSubscription(mid, groupId) {
    const config = this.getPushConfig()
    const midStr = String(mid)

    if (!config[midStr]) {
      config[midStr] = []
    }
    if (!config[midStr].includes(groupId)) {
      config[midStr].push(groupId)
    }

    return this.setPushConfig(config)
  }

  /**
   * 删除推送订阅
   */
  removePushSubscription(mid, groupId) {
    const config = this.getPushConfig()
    const midStr = String(mid)

    if (config[midStr]) {
      const index = config[midStr].indexOf(groupId)
      if (index > -1) {
        config[midStr].splice(index, 1)
        if (config[midStr].length === 0) {
          delete config[midStr]
        }
      }
    }

    return this.setPushConfig(config)
  }

  /**
   * 获取Cookie
   */
  getCookie() {
    const config = this.getConfig()
    return config?.auth?.cookie || ''
  }

  /**
   * 设置Cookie
   */
  setCookie(cookie, refreshToken = '') {
    const config = this.getConfig()
    config.auth = config.auth || {}
    config.auth.cookie = cookie
    if (refreshToken) {
      config.auth.refresh_token = refreshToken
    }
    return this.setConfig(config)
  }

  /**
   * 获取刷新令牌
   */
  getRefreshToken() {
    const config = this.getConfig()
    return config?.auth?.refresh_token || ''
  }
}

export default new BilibiliSetting()
