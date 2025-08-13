import plugin from '../../../../lib/plugins/plugin.js'
import fetch from 'node-fetch'
import common from '../../../../lib/common/common.js'
import setting from '../../model/rconsole/rconsole-setting.js'

const CAT_LIMIT = 10

export default class RconsoleCat extends plugin {
  constructor() {
    super({
      name: 'Rconsole-猫图',
      dsc: '#cat 吸猫功能',
      event: 'message',
      priority: 500,
      rule: [
        {
          reg: '^#cat$',
          fnc: 'cat'
        }
      ]
    })
  }

  async cat(e) {
    const config = setting.getConfig('rconsole')
    if (!config?.features?.cat) return e.reply('猫猫功能已关闭')

    try {
      const url = `https://api.thecatapi.com/v1/images/search?limit=${CAT_LIMIT}`
      const resp = await fetch(url)
      const data = await resp.json()

      if (!Array.isArray(data) || data.length === 0) {
        return e.reply('没有抓到猫猫图片，请稍后再试~')
      }

      const list = data.map(item => [segment.image(item.url)])
      await e.reply('涩图也不看了,就看猫是吧')
      const forward = await common.makeForwardMsg(e, list)
      await e.reply(forward)
    } catch (err) {
      logger.error('[Rconsole-猫图] 获取失败', err)
      return e.reply('获取猫猫失败，请稍后再试~')
    }
    return true
  }
}

