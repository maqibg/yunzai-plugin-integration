/**
 * 视频/图文解析模块入口
 * 聚合抖音、快手、小红书、小黑盒解析并导出
 */
import fs from 'node:fs'
import path from 'node:path'
import { cleanTempFiles } from '../model/parser/parser-fetch.js'

const pluginRoot = path.join(process.cwd(), 'plugins', 'yunzai-plugin-integration')
const appDir = path.join(pluginRoot, 'app', 'parser')

// 动态加载所有模块
const apps = {}
const files = fs.readdirSync(appDir).filter(f => f.endsWith('.js'))

for (const file of files) {
  try {
    const modulePath = `./parser/${file}`
    const mod = await import(modulePath)
    // 将每个模块中的类添加到 apps
    for (const [name, cls] of Object.entries(mod)) {
      if (typeof cls === 'function') {
        apps[name] = cls
      }
    }
  } catch (error) {
    logger.error(`[解析] 加载模块失败 [${file}]: ${error.message}`)
  }
}

// 进程启动时清掉上次运行残留的临时文件：下载中途被 kill 会留下半截视频，
// 不清理会只增不减地占满磁盘
try {
  const removed = cleanTempFiles()
  if (removed > 0) logger.mark(`[解析] 启动清理临时文件 ${removed} 个`)
} catch (error) {
  logger.error(`[解析] 启动清理失败: ${error.message}`)
}

export { apps }
