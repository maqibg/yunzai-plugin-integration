/**
 * Bilibili 直播间解析模块
 * 由 BilibiliParser 在识别到直播间链接后调用
 */
import api, { fetchBili, explainBiliCode } from '../../model/bilibili/bilibili-api.js'
import { API_ENDPOINTS, DEFAULT_HEADERS } from '../../model/bilibili/bilibili-const.js'

export class BilibiliLive extends plugin {
  constructor() {
    super({
      name: '[Bilibili]直播解析',
      dsc: 'B站直播间信息解析',
      event: 'message',
      priority: -120,
      // 直播间链接统一交给 BilibiliParser 分发，这里不单独注册指令
      rule: []
    })
  }

  /**
   * 处理直播间链接
   * @param {object} e 消息事件
   * @param {string|number} roomId 直播间号
   * @param {object} options notifyError 是否在最终失败时提示
   */
  async processLive(e, roomId, options = {}) {
    const { notifyError = true } = options

    try {
      const room = await this.getRoomInfo(roomId)
      if (!room) {
        if (notifyError) await e.reply('获取直播间信息失败')
        return false
      }

      const anchor = await this.getAnchor(roomId)
      const living = Number(room.live_status) === 1
      const cover = room.keyframe || room.user_cover

      const lines = [`直播间: ${room.title}`]
      if (anchor?.uname) lines.push(`UP主: ${anchor.uname}`)
      lines.push(`状态: ${living ? '直播中' : '未开播'}`)
      lines.push(living
        ? `人气: ${this.formatCount(room.online)}`
        : `关注: ${this.formatCount(room.attention)}`)
      if (room.area_name) lines.push(`分区: ${room.area_name}`)
      lines.push('')
      lines.push(`https://live.bilibili.com/${room.room_id}`)

      const messages = []
      if (cover) messages.push(segment.image(cover))
      messages.push(lines.join('\n'))

      await e.reply(messages)
      return true
    } catch (error) {
      logger.error(`[Bilibili] 直播解析异常: ${error.message}`)
      if (notifyError) await e.reply('直播间解析失败，请稍后重试')
      return false
    }
  }

  /**
   * 获取直播间基础信息
   */
  async getRoomInfo(roomId) {
    try {
      const url = `${API_ENDPOINTS.LIVE_ROOM_INFO}?room_id=${roomId}`
      const res = await fetchBili(url, { headers: DEFAULT_HEADERS })
      const json = await res.json()

      if (json.code !== 0) {
        logger.error(`[Bilibili] 获取直播间信息失败: ${explainBiliCode(json.code, json.message)}`)
        return null
      }
      return json.data || null
    } catch (error) {
      logger.error(`[Bilibili] 获取直播间信息异常: ${error.message}`)
      return null
    }
  }

  /**
   * 获取主播信息
   */
  async getAnchor(roomId) {
    try {
      const url = `${API_ENDPOINTS.LIVE_ANCHOR_INFO}?roomid=${roomId}`
      const res = await fetchBili(url, { headers: DEFAULT_HEADERS })
      const json = await res.json()

      if (json.code !== 0) return null
      return json.data?.info || null
    } catch (error) {
      logger.debug(`[Bilibili] 获取主播信息失败: ${error.message}`)
      return null
    }
  }

  /**
   * 人气/关注数格式化
   */
  formatCount(num) {
    const n = Number(num) || 0
    if (n >= 100000000) return `${(n / 100000000).toFixed(1)}亿`
    if (n >= 10000) return `${(n / 10000).toFixed(1)}万`
    return String(n)
  }
}
