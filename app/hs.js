import fs from 'fs'
import { fileURLToPath } from 'url'
import path from 'path'

// 修正Windows下的路径解析问题
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const hsDir = path.join(__dirname, 'hs')

let apps = {}

try {
  // 检查目录是否存在
  if (!fs.existsSync(hsDir)) {
    logger.warn('[yunzai-plugin-integration] hs目录不存在，跳过加载')
  } else {
    const files = fs.readdirSync(hsDir).filter(file => file.endsWith('.js'))
    
    for (let file of files) {
      try {
        let name = file.replace('.js', '')
        let app = await import(`./hs/${file}`)
        
        if (app.default) {
          apps[`hs-${name}`] = app.default
        } else {
          // 如果没有default导出，取第一个导出的类
          let keys = Object.keys(app)
          if (keys.length > 0) {
            apps[`hs-${name}`] = app[keys[0]]
          }
        }
        logger.info(`[yunzai-plugin-integration] hs功能加载成功: ${name}`)
      } catch (err) {
        logger.error(`[yunzai-plugin-integration] hs功能加载失败: ${file}`, err)
      }
    }
  }
} catch (err) {
  logger.error('[yunzai-plugin-integration] hs目录读取失败:', err)
}

export { apps }