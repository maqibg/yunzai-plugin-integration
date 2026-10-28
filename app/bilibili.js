/**
 * Bilibili 模块入口
 * 聚合所有B站相关功能并导出
 */
import fs from 'node:fs'
import path from 'node:path'

const pluginRoot = path.join(process.cwd(), 'plugins', 'yunzai-plugin-integration')
const appDir = path.join(pluginRoot, 'app', 'bilibili')

// 动态加载所有模块
const apps = {}
const files = fs.readdirSync(appDir).filter(f => f.endsWith('.js'))

for (const file of files) {
  try {
    const modulePath = `./bilibili/${file}`
    const mod = await import(modulePath)
    // 将每个模块中的类添加到 apps
    for (const [name, cls] of Object.entries(mod)) {
      if (typeof cls === 'function') {
        apps[name] = cls
      }
    }
  } catch (error) {
    logger.error(`[Bilibili] 加载模块失败 [${file}]: ${error.message}`)
  }
}

// 进程启动时自检：重置下载队列，并清掉上次运行遗留的临时文件
try {
  const { startupReset } = await import('../model/bilibili/bilibili-download.js')
  await startupReset()
} catch (error) {
  logger.error(`[Bilibili] 启动自检失败: ${error.message}`)
}

// 导出 apps 对象，供主入口识别
export { apps }
