/**
 * 提瓦特小助手模块入口
 * 功能：队伍伤害计算、成就排行、宝箱排行等
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const teyvatDir = path.join(__dirname, 'teyvat')

// 获取所有 teyvat 功能模块
const files = fs.existsSync(teyvatDir)
  ? fs.readdirSync(teyvatDir).filter(file => file.endsWith('.js'))
  : []

if (files.length === 0) {
  logger.warn('[提瓦特小助手] teyvat 目录下没有找到 .js 文件')
}

// 动态导入所有模块
let ret = []
files.forEach((file) => {
  ret.push(import(`./teyvat/${file}`))
})

ret = await Promise.allSettled(ret)

let apps = {}
for (let i in files) {
  let name = files[i].replace('.js', '').replace('Teyvat', '')

  if (ret[i].status !== 'fulfilled') {
    logger.error(`[提瓦特小助手] 载入子模块错误：${logger.red(name)}`)
    logger.error(ret[i].reason)
    continue
  }

  const moduleExports = ret[i].value
  const keys = Object.keys(moduleExports)
  if (keys.length > 0) {
    apps[`teyvat-${name.toLowerCase()}`] = moduleExports[keys[0]]
    logger.info(`[提瓦特小助手] 成功载入: ${logger.green(name)}`)
  }
}

logger.info(`[提瓦特小助手] 共载入 ${Object.keys(apps).length} 个功能模块`)

export { apps }
