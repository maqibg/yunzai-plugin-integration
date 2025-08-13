import fs from 'fs'
import { fileURLToPath } from 'url'
import path from 'path'

// 修正Windows下的路径解析问题
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const rconsoleDir = path.join(__dirname, 'rconsole')

let apps = {}

try {
  if (!fs.existsSync(rconsoleDir)) {
    logger.warn('[yunzai-plugin-integration] rconsole目录不存在，跳过加载')
  } else {
    const files = fs.readdirSync(rconsoleDir).filter(file => file.endsWith('.js'))

    for (let file of files) {
      try {
        let name = file.replace('.js', '')
        let app = await import(`./rconsole/${file}`)

        if (app.default) {
          apps[`rconsole-${name}`] = app.default
        } else {
          let keys = Object.keys(app)
          if (keys.length > 0) {
            apps[`rconsole-${name}`] = app[keys[0]]
          }
        }
        logger.info(`[yunzai-plugin-integration] rconsole功能加载成功: ${name}`)
      } catch (err) {
        logger.error(`[yunzai-plugin-integration] rconsole功能加载失败: ${file}`, err)
      }
    }
  }
} catch (err) {
  logger.error('[yunzai-plugin-integration] rconsole目录读取失败:', err)
}

export { apps }

