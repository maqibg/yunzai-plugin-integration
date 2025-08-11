import fs from 'node:fs'
import path from 'node:path'
import YAML from 'yaml'
import chokidar from 'chokidar'

const _path = process.cwd()
const pluginRoot = path.join(_path, 'plugins', 'yunzai-plugin-integration')

class HsSetting {
  constructor() {
    // 配置文件路径
    this.defPath = path.join(pluginRoot, 'config', 'default')
    this.configPath = path.join(pluginRoot, 'config')
    
    // 配置缓存
    this.config = {}
    this.def = {}
    this.watcher = {}

    this.initConfig()
  }

  initConfig() {
    // 确保配置目录存在
    if (!fs.existsSync(this.configPath)) {
      fs.mkdirSync(this.configPath, { recursive: true })
    }
  }

  /**
   * 获取配置文件路径
   * @param {string} name 配置名称
   * @param {string} type 类型: 'def' | 'config'
   */
  getFilePath(name, type = 'config') {
    if (type === 'def') {
      return path.join(this.defPath, `default-${name}.yaml`)
    } else {
      const configFile = path.join(this.configPath, `${name}.yaml`)
      const defFile = path.join(this.defPath, `default-${name}.yaml`)
      
      // 如果用户配置不存在，从默认配置复制
      if (!fs.existsSync(configFile) && fs.existsSync(defFile)) {
        try {
          fs.copyFileSync(defFile, configFile)
          logger.info(`[HS插件] 已创建配置文件: ${name}.yaml`)
        } catch (error) {
          logger.error(`[HS插件] 创建配置文件失败: ${error.message}`)
        }
      }
      return configFile
    }
  }

  /**
   * 读取YAML配置文件
   * @param {string} name 配置名称 
   * @param {string} type 类型: 'def' | 'config'
   */
  getYaml(name, type = 'config') {
    if (this[type][name]) return this[type][name]

    const filePath = this.getFilePath(name, type)
    if (!fs.existsSync(filePath)) {
      logger.warn(`[HS插件] 配置文件不存在: ${filePath}`)
      return {}
    }

    try {
      const content = fs.readFileSync(filePath, 'utf8')
      const data = YAML.parse(content)
      this[type][name] = data || {}
      this.watch(filePath, name, type)
      return this[type][name]
    } catch (error) {
      logger.error(`[HS插件] 读取配置文件失败 [${name}]: ${error.message}`)
      return {}
    }
  }

  /**
   * 获取默认配置
   * @param {string} name 配置名称
   */
  getDefConfig(name) {
    return this.getYaml(name, 'def')
  }

  /**
   * 获取用户配置（合并默认配置）
   * @param {string} name 配置名称
   */
  getConfig(name) {
    const defConfig = this.getDefConfig(name)
    const userConfig = this.getYaml(name, 'config')
    return { ...defConfig, ...userConfig }
  }

  /**
   * 保存配置（保留注释）
   * @param {string} name 配置名称
   * @param {object} data 配置数据
   */
  setConfig(name, data) {
    const filePath = this.getFilePath(name, 'config')
    try {
      // 尝试保留原文件的注释
      let yamlContent = ''
      
      if (fs.existsSync(filePath)) {
        // 读取原文件内容
        const originalContent = fs.readFileSync(filePath, 'utf8')
        
        try {
          // 尝试解析原文件，保留注释
          const doc = YAML.parseDocument(originalContent)
          
          // 更新配置值，但保留注释结构
          this.updateYamlDocument(doc, data)
          
          yamlContent = doc.toString()
        } catch (parseError) {
          // 如果解析失败，使用常规方式
          logger.warn(`[HS插件] 无法保留注释，使用常规保存: ${parseError.message}`)
          yamlContent = YAML.stringify(data)
        }
      } else {
        // 新文件，直接生成
        yamlContent = YAML.stringify(data)
      }
      
      fs.writeFileSync(filePath, yamlContent, 'utf8')
      // 清除缓存，强制重新读取
      delete this.config[name]
      logger.info(`[HS插件] 保存配置成功: ${name}.yaml`)
      return true
    } catch (error) {
      logger.error(`[HS插件] 保存配置失败 [${name}]: ${error.message}`)
      return false
    }
  }

  /**
   * 递归更新YAML文档节点，保留注释
   * @param {object} doc YAML文档对象
   * @param {object} data 新数据
   */
  updateYamlDocument(doc, data) {
    if (!doc.contents) return
    
    const updateNode = (node, newData) => {
      if (node && node.items) {
        // 处理映射类型
        for (const item of node.items) {
          if (item.key && item.key.value && newData.hasOwnProperty(item.key.value)) {
            const key = item.key.value
            const newValue = newData[key]
            
            if (typeof newValue === 'object' && newValue !== null && !Array.isArray(newValue)) {
              // 递归处理嵌套对象
              if (item.value && item.value.items) {
                updateNode(item.value, newValue)
              }
            } else {
              // 直接更新值
              item.value = doc.createNode(newValue)
            }
          }
        }
        
        // 添加新的键值对（如果原文件中不存在）
        for (const [key, value] of Object.entries(newData)) {
          const exists = node.items.some(item => 
            item.key && item.key.value === key
          )
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
   * @param {string} filePath 文件路径
   * @param {string} name 配置名称
   * @param {string} type 类型
   */
  watch(filePath, name, type) {
    const watchKey = `${type}_${name}`
    if (this.watcher[watchKey]) return

    try {
      const watcher = chokidar.watch(filePath)
      watcher.on('change', () => {
        delete this[type][name]
        logger.mark(`[HS插件] 配置文件已更新: ${name} [${type}]`)
      })
      this.watcher[watchKey] = watcher
    } catch (error) {
      logger.warn(`[HS插件] 监听配置文件失败: ${error.message}`)
    }
  }
}

// 导出单例
export default new HsSetting()