import fs from 'node:fs'
import path from 'node:path'
import YAML from 'yaml'
import chokidar from 'chokidar'

const _path = process.cwd()
const pluginRoot = path.join(_path, 'plugins', 'yunzai-plugin-integration')

class TgSetting {
  constructor() {
    this.defPath = path.join(pluginRoot, 'config', 'default')
    this.configPath = path.join(pluginRoot, 'config')

    this.config = {}
    this.def = {}
    this.watcher = {}

    this.initConfig()
  }

  initConfig() {
    if (!fs.existsSync(this.configPath)) {
      fs.mkdirSync(this.configPath, { recursive: true })
    }
  }

  getFilePath(name, type = 'config') {
    if (type === 'def') {
      return path.join(this.defPath, `default-${name}.yaml`)
    } else {
      const configFile = path.join(this.configPath, `${name}.yaml`)
      const defFile = path.join(this.defPath, `default-${name}.yaml`)

      if (!fs.existsSync(configFile) && fs.existsSync(defFile)) {
        try {
          fs.copyFileSync(defFile, configFile)
          logger.info(`[TG插件] 已创建配置文件: ${name}.yaml`)
        } catch (error) {
          logger.error(`[TG插件] 创建配置文件失败: ${error.message}`)
        }
      }
      return configFile
    }
  }

  getYaml(name, type = 'config') {
    if (this[type][name]) return this[type][name]

    const filePath = this.getFilePath(name, type)
    if (!fs.existsSync(filePath)) return {}

    try {
      const content = fs.readFileSync(filePath, 'utf8')
      const data = YAML.parse(content)
      this[type][name] = data || {}
      this.watch(filePath, name, type)
      return this[type][name]
    } catch (error) {
      logger.error(`[TG插件] 读取配置失败 [${name}]: ${error.message}`)
      return {}
    }
  }

  getDefConfig(name) {
    return this.getYaml(name, 'def')
  }

  getConfig(name) {
    const defConfig = this.getDefConfig(name)
    const userConfig = this.getYaml(name, 'config')
    return this.mergeConfig(defConfig, userConfig)
  }

  mergeConfig(defConfig, userConfig) {
    const merge = (target, source) => {
      const result = { ...target }
      for (const key in source) {
        if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
          result[key] = merge(target[key] || {}, source[key])
        } else {
          result[key] = source[key]
        }
      }
      return result
    }
    return merge(defConfig, userConfig)
  }

  setConfig(name, data) {
    const filePath = this.getFilePath(name, 'config')
    try {
      let yamlContent = ''
      if (fs.existsSync(filePath)) {
        const originalContent = fs.readFileSync(filePath, 'utf8')
        try {
          const doc = YAML.parseDocument(originalContent)
          this.updateYamlDocument(doc, data)
          yamlContent = doc.toString()
        } catch (parseError) {
          logger.warn(`[TG插件] 无法保留注释，使用常规保存: ${parseError.message}`)
          yamlContent = YAML.stringify(data)
        }
      } else {
        yamlContent = YAML.stringify(data)
      }

      fs.writeFileSync(filePath, yamlContent, 'utf8')
      delete this.config[name]
      logger.info(`[TG插件] 保存配置成功: ${name}.yaml`)
      return true
    } catch (error) {
      logger.error(`[TG插件] 保存配置失败 [${name}]: ${error.message}`)
      return false
    }
  }

  updateYamlDocument(doc, data) {
    if (!doc.contents) return
    const updateNode = (node, newData) => {
      if (node && node.items) {
        for (const item of node.items) {
          if (item.key && item.key.value && newData.hasOwnProperty(item.key.value)) {
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

  watch(filePath, name, type) {
    const watchKey = `${type}_${name}`
    if (this.watcher[watchKey]) return
    try {
      const watcher = chokidar.watch(filePath)
      watcher.on('change', () => {
        delete this[type][name]
        logger.mark(`[TG插件] 配置文件已更新: ${name} [${type}]`)
      })
      this.watcher[watchKey] = watcher
    } catch (error) {
      logger.warn(`[TG插件] 监听配置失败: ${error.message}`)
    }
  }

  // 验证配置完整性
  validateConfig(name) {
    const config = this.getConfig(name)
    const errors = []

    if (name === 'tg-forwarder') {
      // 验证必填字段
      if (!config.telegram?.botToken) {
        errors.push('Telegram Bot Token 未配置')
      }
      
      if (!config.telegram?.channels || config.telegram.channels.length === 0) {
        errors.push('监控频道列表为空')
      }
      
      if (!config.qq?.targetGroups || config.qq.targetGroups.length === 0) {
        errors.push('目标QQ群列表为空')
      }
      
      // 验证数值范围
      if (config.monitor?.interval && config.monitor.interval < 60000) {
        errors.push('监控间隔不能少于60秒')
      }
      
      if (config.files?.maxSize && config.files.maxSize > 52428800) {
        errors.push('文件大小限制不能超过50MB')
      }
    }

    return errors
  }

  // 获取配置状态
  getConfigStatus(name) {
    const errors = this.validateConfig(name)
    const configFile = this.getFilePath(name, 'config')
    const isConfigured = fs.existsSync(configFile)
    
    return {
      isValid: errors.length === 0,
      isConfigured,
      errors,
      configPath: configFile
    }
  }
}

export default new TgSetting()