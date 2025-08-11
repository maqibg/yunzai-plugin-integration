import fs from 'fs'
import path from 'path'

const files = fs.readdirSync(path.resolve(process.cwd(), 'plugins', 'yunzai-plugin-integration', 'app', 'cyxz')).filter(file => file.endsWith('.js'))

let ret = []

files.forEach((file) => {
  ret.push(import(`./cyxz/${file}`))
})

ret = await Promise.allSettled(ret)

let apps = {}
for (let i in files) {
  let name = files[i].replace('.js', '')
  
  if (ret[i].status != 'fulfilled') {
    logger.error(`载入cyxz子模块错误：${logger.red(name)}`)
    logger.error(ret[i].reason)
    continue
  }
  apps[name] = ret[i].value[Object.keys(ret[i].value)[0]]
}

export { apps }
