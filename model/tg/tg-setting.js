// TG 配置读写模块（model/tg/tg-setting.js）
// 作用：
// - 首次运行将 config/default/dafult-tg-config.yaml 拷贝为 config/tg-config.yaml
// - 提供 getConfig() 合并默认与用户配置；setConfig() 写回并尽量保留注释
// - 监听配置文件变更（chokidar），自动失效缓存
import fs from 'node:fs'
import path from 'node:path'
import YAML from 'yaml'
import chokidar from 'chokidar'

// 兼容logger
const logger = globalThis.logger || console

// 基于现有 setting 模板实现，适配 tg-config
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

  // 计算配置文件路径
  // - type:'def' 使用 dafult-tg-config.yaml（按需求保留该拼写）
  // - type:'config' 使用 tg-config.yaml（如不存在则从默认复制）
  getFilePath(name, type = 'config') {
    if (type === 'def') {
      // 名称参数无意义，固定映射到默认模板
      return path.join(this.defPath, 'dafult-tg-config.yaml')
    } else {
      const configFile = path.join(this.configPath, 'tg-config.yaml')
      const defFile = path.join(this.defPath, 'dafult-tg-config.yaml')
      if (!fs.existsSync(configFile) && fs.existsSync(defFile)) {
        try {
          fs.copyFileSync(defFile, configFile)
          logger.info('[TG] 已创建配置文件: tg-config.yaml')
        } catch (err) {
          logger.error('[TG] 创建配置文件失败:', err)
        }
      }
      return configFile
    }
  }

  getYaml(type = 'config') {
    const cacheKey = type
    if (this[type]._one) return this[type]._one

    const filePath = this.getFilePath('tg-config', type)
    if (!fs.existsSync(filePath)) {
      logger.warn(`[TG] 配置文件不存在: ${filePath}`)
      return {}
    }
    try {
      const content = fs.readFileSync(filePath, 'utf8')
      const data = YAML.parse(content)
      this[type]._one = data || {}
      this.watch(filePath, type)
      return this[type]._one
    } catch (err) {
      logger.error(`[TG] 读取配置失败: ${err.message}`)
      return {}
    }
  }

  getDefConfig() { return this.getYaml('def') }

  // 获取用户配置（合并默认）
  getConfig() {
    const defConfig = this.getDefConfig()
    const userConfig = this.getYaml('config')
    return { ...defConfig, ...userConfig }
  }

  setConfig(data) {
    const filePath = this.getFilePath('tg-config', 'config')
    try {
      let yamlContent = ''
      if (fs.existsSync(filePath)) {
        const originalContent = fs.readFileSync(filePath, 'utf8')
        try {
          const doc = YAML.parseDocument(originalContent)
          this.updateYamlDocument(doc, data)
          yamlContent = doc.toString()
        } catch (e) {
          logger.warn('[TG] 无法保留注释，使用常规保存:', e.message)
          yamlContent = YAML.stringify(data)
        }
      } else {
        yamlContent = YAML.stringify(data)
      }
      fs.writeFileSync(filePath, yamlContent, 'utf8')
      delete this.config._one
      logger.info('[TG] 保存配置成功: tg-config.yaml')
      return true
    } catch (err) {
      logger.error('[TG] 保存配置失败:', err.message)
      return false
    }
  }

  // 尝试在不破坏注释与键顺序的情况下更新 YAML 文档
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
          const exists = node.items.some(i => i.key && i.key.value === key)
          if (!exists) {
            node.items.push(doc.createPair(doc.createNode(key), doc.createNode(value)))
          }
        }
      }
    }
    updateNode(doc.contents, data)
  }

  // 监听配置文件变更，失效缓存并提示日志
  watch(filePath, type) {
    const key = `watch_${type}`
    if (this.watcher[key]) return
    try {
      const watcher = chokidar.watch(filePath)
      watcher.on('change', () => {
        delete this[type]._one
        logger.mark(`[TG] 配置文件已更新: ${type}`)
      })
      this.watcher[key] = watcher
    } catch (err) {
      logger.warn('[TG] 监听配置失败:', err.message)
    }
  }
}

export default new TgSetting()
