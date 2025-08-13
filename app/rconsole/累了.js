import plugin from '../../../../lib/plugins/plugin.js'
import fetch from 'node-fetch'
import common from '../../../../lib/common/common.js'
import setting from '../../model/rconsole/rconsole-setting.js'

export default class RconsoleLeiLe extends plugin {
  constructor() {
    super({
      name: 'Rconsole-累了',
      dsc: '#累了 放松图集',
      event: 'message',
      priority: 500,
      rule: [
        {
          reg: '^#累了$',
          fnc: 'cospro'
        }
      ]
    })
  }

  async cospro(e) {
    const config = setting.getConfig('rconsole')
    if (!config?.features?.cospro) return e.reply('累了功能已关闭')

    try {
      const url = 'https://imgapi.cn/cos.php?return=jsonpro'
      const resp = await fetch(url)
      const data = await resp.json()
      let list = Array.isArray(data?.imgurls) ? data.imgurls : []

      if (list.length === 0) return e.reply('暂未获取到图片，请稍后再试~')

      await e.reply('哪天克火掉一定是在这个群里面...')
      const msgs = list.map(u => [segment.image(encodeURI(u))])
      const forward = await common.makeForwardMsg(e, msgs)
      await e.reply(forward)
    } catch (err) {
      logger.error('[Rconsole-累了] 获取失败', err)
      return e.reply('获取图片失败，请稍后再试~')
    }
    return true
  }
}

