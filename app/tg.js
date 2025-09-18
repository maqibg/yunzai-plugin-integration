// TG 模块入口（app/tg.js）
// 作用：
// - 动态加载 app/tg/ 目录下的所有子模块（如 monitor.js）
// - 将各子模块导出的默认类聚合到 apps，供 index.js 动态注册到 Yunzai
// - 兼容 Windows 路径解析
// 注意：此文件本身不包含业务逻辑，仅负责聚合与装载

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'url'

// 统一解析当前目录，适配 Windows 路径
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const tgDir = path.join(__dirname, 'tg')

let apps = {}

try {
  if (!fs.existsSync(tgDir)) {
    // 若不存在 tg 子目录则跳过加载，便于按需启用
    logger.warn('[yunzai-plugin-integration] tg 目录不存在，跳过加载')
  } else {
    // 只加载 monitor.js，其他文件是工具类不需要注册为plugin
    const pluginFiles = ['monitor.js']  // 只有这个文件包含plugin类
    
    let ret = await Promise.allSettled(pluginFiles.map(f => import(`./tg/${f}`)))
    for (let i in pluginFiles) {
      const name = pluginFiles[i].replace('.js', '')
      if (ret[i].status !== 'fulfilled') {
        logger.error(`[yunzai-plugin-integration] tg 子模块载入失败：${name}`)
        logger.error(ret[i].reason)
        continue
      }
      const exp = ret[i].value
      const keys = Object.keys(exp)
      if (keys.length > 0) {
        // 查找默认导出的plugin类
        const pluginClass = exp.default
        if (pluginClass && typeof pluginClass === 'function') {
          // 以 tg- 前缀注册模块，避免与其他模块键名冲突
          apps[`tg-${name.toLowerCase()}`] = pluginClass
          logger.info(`[yunzai-plugin-integration] tg 功能加载成功: ${name}`)
        }
      }
    }
  }
} catch (err) {
  logger.error('[yunzai-plugin-integration] tg 目录读取失败:', err)
}

export { apps }
