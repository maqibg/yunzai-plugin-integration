import plugin from '../../../../lib/plugins/plugin.js'
import fetch from 'node-fetch'
import setting from '../../model/rconsole/rconsole-setting.js'

export default class RconsoleBuyerShow extends plugin {
  constructor() {
    super({
      name: 'Rconsole-买家秀',
      dsc: '#买家秀 随机图',
      event: 'message',
      priority: 500,
      rule: [
        {
          reg: '^#买家秀$',
          fnc: 'buyerShow'
        }
      ]
    })
  }

  async buyerShow(e) {
    const config = setting.getConfig('rconsole')
    if (!config?.features?.buyerShow) return e.reply('买家秀功能已关闭')

    try {
      const url = 'https://api.uomg.com/api/rand.img3?format=json'
      const resp = await fetch(url)
      const data = await resp.json()
      const img = data?.imgurl
      if (!img) return e.reply('暂未获取到图片，请稍后再试~')
      return e.reply(segment.image(img))
    } catch (err) {
      logger.error('[Rconsole-买家秀] 获取失败', err)
      return e.reply('获取买家秀失败，请稍后再试~')
    }
  }
}
