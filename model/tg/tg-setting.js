// TG 配置读写模块（model/tg/tg-setting.js）
// 说明：
// - 首次运行将 config/default/default-tg-config.yaml 复制为 config/tg-config.yaml
// - 提供 getConfig() 合并默认+用户配置；setConfig() 写回并尽量保留注释
// - 配置文件变更支持 chokidar 自动失效缓存
import fs from 'node:fs'
import path from 'node:path'
import YAML from 'yaml'
import chokidar from 'chokidar'

// 统一 logger
const logger = globalThis.logger || console

// 插件根目录
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

  // 解析默认/用户配置文件路径
  // - type:'def' 返回默认模板路径（优先 default-tg-config.yaml，兼容历史拼写 dafult-…）
  // - type:'config' 返回实际配置路径；不存在时拷贝默认模板
  getFilePath(name, type = 'config') {
    const defNew = path.join(this.defPath, 'default-tg-config.yaml')
    const defOld = path.join(this.defPath, 'dafult-tg-config.yaml') // 兼容旧拼写

    if (type === 'def') {
      // 优先新命名，回退旧文件
      if (fs.existsSync(defNew)) return defNew
      if (fs.existsSync(defOld)) return defOld
      return defNew
    } else {
      const configFile = path.join(this.configPath, 'tg-config.yaml')
      if (!fs.existsSync(configFile)) {
        try {
          const src = fs.existsSync(defNew) ? defNew : (fs.existsSync(defOld) ? defOld : null)
          if (src) {
            fs.copyFileSync(src, configFile)
            logger.info('[TG] 已创建默认配置: tg-config.yaml')
          } else {
            logger.warn('[TG] 未找到默认模板(default-tg-config.yaml)')
          }
        } catch (err) {
          logger.error('[TG] 复制默认配置失败:', err)
        }
      }
      return configFile
    }
  }

  getYaml(type = 'config') {
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

  // 获取用户配置，合并默认
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
          logger.warn('[TG] 无法保留注释，使用重写保存:', e.message)
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
      logger.error('[TG] 写入配置失败:', err.message)
      return false
    }
  }

  // 在不破坏注释的前提下，更新 YAML 文档
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
          const exists = node.items.some(i => i.key && i.key.value === key)
          if (!exists) node.items.push(doc.createPair(doc.createNode(key), doc.createNode(value)))
        }
      }
    }
    updateNode(doc.contents, data)
  }

  // 监听配置文件，热更新缓存并提示日志
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
