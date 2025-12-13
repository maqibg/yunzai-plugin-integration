/**
 * 提瓦特小助手配置管理
 */
import fs from 'node:fs'
import path from 'node:path'
import YAML from 'yaml'
import chokidar from 'chokidar'

const _path = process.cwd()
const pluginRoot = path.join(_path, 'plugins', 'yunzai-plugin-integration')

class TeyvatSetting {
  constructor() {
    this.defPath = path.join(pluginRoot, 'config', 'default')
    this.configPath = path.join(pluginRoot, 'config')
    // 数据文件放在 data/yunzai-plugin-integration/teyvat/ 目录下
    this.dataPath = path.join(_path, 'data', 'yunzai-plugin-integration', 'teyvat')

    this.config = {}
    this.def = {}
    this.watcher = {}

    this.initConfig()
  }

  initConfig() {
    if (!fs.existsSync(this.configPath)) {
      fs.mkdirSync(this.configPath, { recursive: true })
    }
    if (!fs.existsSync(this.dataPath)) {
      fs.mkdirSync(this.dataPath, { recursive: true })
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
          logger.info(`[提瓦特小助手] 已创建配置文件: ${name}.yaml`)
        } catch (error) {
          logger.error(`[提瓦特小助手] 创建配置文件失败: ${error.message}`)
        }
      }
      return configFile
    }
  }

  getYaml(name, type = 'config') {
    if (this[type][name]) return this[type][name]

    const filePath = this.getFilePath(name, type)
    if (!fs.existsSync(filePath)) {
      return {}
    }

    try {
      const content = fs.readFileSync(filePath, 'utf8')
      const data = YAML.parse(content)
      this[type][name] = data || {}
      this.watch(filePath, name, type)
      return this[type][name]
    } catch (error) {
      logger.error(`[提瓦特小助手] 读取配置失败 [${name}]: ${error.message}`)
      return {}
    }
  }

  getDefConfig(name) {
    return this.getYaml(name, 'def')
  }

  getConfig(name = 'teyvat-config') {
    const defConfig = this.getDefConfig(name)
    const userConfig = this.getYaml(name, 'config')
    return { ...defConfig, ...userConfig }
  }

  setConfig(name, data) {
    const filePath = this.getFilePath(name, 'config')
    try {
      let yamlContent = YAML.stringify(data)
      fs.writeFileSync(filePath, yamlContent, 'utf8')
      delete this.config[name]
      logger.info(`[提瓦特小助手] 保存配置成功: ${name}.yaml`)
      return true
    } catch (error) {
      logger.error(`[提瓦特小助手] 保存配置失败 [${name}]: ${error.message}`)
      return false
    }
  }

  watch(filePath, name, type) {
    const watchKey = `${type}_${name}`
    if (this.watcher[watchKey]) return

    try {
      const watcher = chokidar.watch(filePath)
      watcher.on('change', () => {
        delete this[type][name]
        logger.mark(`[提瓦特小助手] 配置文件已更新: ${name}`)
      })
      this.watcher[watchKey] = watcher
    } catch (error) {
      logger.warn(`[提瓦特小助手] 监听配置文件失败: ${error.message}`)
    }
  }

  // JSON 数据存储
  getJsonPath(name) {
    return path.join(this.dataPath, `${name}.json`)
  }

  setJson(name, data) {
    const filePath = this.getJsonPath(name)
    try {
      fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8')
      return true
    } catch (error) {
      logger.error(`[提瓦特小助手] 保存数据失败 [${name}]: ${error.message}`)
      return false
    }
  }

  getJson(name) {
    const filePath = this.getJsonPath(name)
    if (!fs.existsSync(filePath)) return null

    try {
      const content = fs.readFileSync(filePath, 'utf8')
      return JSON.parse(content)
    } catch (error) {
      logger.error(`[提瓦特小助手] 读取数据失败 [${name}]: ${error.message}`)
      return null
    }
  }

  // 获取提瓦特API配置数据
  getTeyvatUrlJson() {
    const data = this.getJson('TeyvatUrlJson')
    return data || {}
  }

  setTeyvatUrlJson(data) {
    return this.setJson('TeyvatUrlJson', data)
  }
}

export default new TeyvatSetting()
