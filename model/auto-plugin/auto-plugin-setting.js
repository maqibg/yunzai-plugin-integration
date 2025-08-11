import YAML from 'yaml'
import chokidar from 'chokidar'
import fs from 'node:fs'
import { _path, pluginResources, pluginRoot } from "./auto-plugin-path.js";

class Setting {
  constructor () {
    /** 默认设置 */
    this.defPath = `${_path}/plugins/yunzai-plugin-integration/config/default/`
    this.def = {}

    /** 用户设置 */
    this.configPath = `${_path}/plugins/yunzai-plugin-integration/config/`
    this.config = {}

    this.dataPath = `${_path}/plugins/yunzai-plugin-integration/data/`
    this.data = {}

    /** 监听文件 */
    this.watcher = { config: {}, def: {} }
  }

  // 配置对象化 用于锅巴插件界面填充
  merge () {
    let sets = {}
    let appsConfig = fs.readdirSync(this.defPath).filter(file => file.endsWith(".yaml"));
    for (let appConfig of appsConfig) {
      // 依次将每个文本填入键
      let filename = appConfig.replace(/^default-/,'').replace(/.yaml/g, '').trim()
      sets[filename] = this.getConfig(filename)
    }
    return sets
  }

  // 配置对象分析 用于锅巴插件界面设置
  analysis(config) {
    for (let key of Object.keys(config)){
      this.setConfig(key, config[key])
    }
  }

  // 获取对应模块数据文件
  getData (path, filename) {
    path = `${this.dataPath}${path}/`
    try {
      if (!fs.existsSync(`${path}${filename}.yaml`)){ return false}
      return YAML.parse(fs.readFileSync(`${path}${filename}.yaml`, 'utf8'))
    } catch (error) {
      logger.error(`[${filename}] 读取失败 ${error}`)
      return false
    }
  }

  // 写入对应模块数据文件
  setData (path, filename, data) {
    path = `${this.dataPath}${path}/`
    try {
      if (!fs.existsSync(path)){
        // 递归创建目录
        fs.mkdirSync(path, { recursive: true });
      }
      fs.writeFileSync(`${path}${filename}.yaml`, YAML.stringify(data),'utf8')
    } catch (error) {
      logger.error(`[${filename}] 写入失败 ${error}`)
      return false
    }
  }

  // 获取对应模块默认配置
  getdefSet (app) {
    return this.getYaml(app, 'def')
  }

  // 获取对应模块用户配置
  getConfig (app) {
    return { ...this.getdefSet(app), ...this.getYaml(app, 'config') }
  }

  // 设置对应模块用户配置
  setConfig (app, Object) {
    return this.setYaml(app, 'config', { ...this.getdefSet(app), ...Object})
  }

  // 将对象写入YAML文件（保留注释）
  setYaml (app, type, Object){
    let file = this.getFilePath(app, type)
    try {
      // 尝试保留原文件的注释
      let yamlContent = ''
      
      if (fs.existsSync(file)) {
        // 读取原文件内容
        const originalContent = fs.readFileSync(file, 'utf8')
        
        try {
          // 尝试解析原文件，保留注释
          const doc = YAML.parseDocument(originalContent)
          
          // 更新配置值，但保留注释结构
          this.updateYamlDocument(doc, Object)
          
          yamlContent = doc.toString()
        } catch (parseError) {
          // 如果解析失败，使用常规方式
          logger.warn(`[${app}] 无法保留注释，使用常规保存: ${parseError.message}`)
          yamlContent = YAML.stringify(Object)
        }
      } else {
        // 新文件，直接生成
        yamlContent = YAML.stringify(Object)
      }
      
      fs.writeFileSync(file, yamlContent, 'utf8')
    } catch (error) {
      logger.error(`[${app}] 写入失败 ${error}`)
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

  // 读取YAML文件 返回对象
  getYaml (app, type) {
    let file = this.getFilePath(app, type)
    if (this[type][app]) return this[type][app]

    try {
      this[type][app] = YAML.parse(fs.readFileSync(file, 'utf8'))
    } catch (error) {
      logger.error(`[${app}] 格式错误 ${error}`)
      return false
    }
    this.watch(file, app, type)
    return this[type][app]
  }

  // 获取YAML文件目录
  getFilePath (app, type) {
    if (type === 'def') return `${this.defPath}default-${app}.yaml`
    else {
      try {
        if (!fs.existsSync(`${this.configPath}${app}.yaml`)) {
          fs.copyFileSync(`${this.defPath}default-${app}.yaml`, `${this.configPath}${app}.yaml`)
        }
      } catch (error) {
        logger.error(`自动化插件缺失默认文件[${app}]${error}`)
      }
      return `${this.configPath}${app}.yaml`
    }
  }


  // 监听配置文件
  watch (file, app, type = 'def') {
    if (this.watcher[type][app]) return

    const watcher = chokidar.watch(file)
    watcher.on('change', path => {
      delete this[type][app]
      logger.mark(`[自动化插件][修改配置文件][${type}][${app}]`)
      if (this[`change_${app}`]) {
        this[`change_${app}`]()
      }
    })
    this.watcher[type][app] = watcher
  }
}

export default new Setting()
