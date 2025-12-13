/**
 * Bilibili 模块入口
 * 聚合所有B站相关功能并导出
 */
import fs from 'node:fs'
import path from 'node:path'

const pluginRoot = path.join(process.cwd(), 'plugins', 'yunzai-plugin-integration')
const appDir = path.join(pluginRoot, 'app', 'bilibili')

// 动态加载所有模块
const modules = {}
const files = fs.readdirSync(appDir).filter(f => f.endsWith('.js'))

for (const file of files) {
  try {
    const modulePath = `./bilibili/${file}`
    const mod = await import(modulePath)
    Object.assign(modules, mod)
  } catch (error) {
    logger.error(`[Bilibili] 加载模块失败 [${file}]: ${error.message}`)
  }
}

export const {
  BilibiliParser,
  BilibiliVideo,
  BilibiliDynamic,
  BilibiliComment,
  BilibiliInteract,
  BilibiliLogin,
  BilibiliPush
} = modules
