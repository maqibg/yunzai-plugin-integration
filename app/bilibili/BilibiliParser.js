/**
 * Bilibili 链接解析器
 * 负责链接识别、分P选择、消息路由
 */
import setting from '../../model/bilibili/bilibili-setting.js'
import api from '../../model/bilibili/bilibili-api.js'
import { URL_PATTERNS, REDIS_PREFIX } from '../../model/bilibili/bilibili-const.js'
import moment from 'moment'

export class BilibiliParser extends plugin {
  constructor() {
    super({
      name: '[Bilibili]链接解析',
      dsc: 'B站链接自动解析',
      event: 'message',
      priority: 0,
      rule: [
        {
          reg: '',
          fnc: 'parseMessage',
          log: false
        },
        {
          reg: '^#?p(\\d+)$',
          fnc: 'selectPage'
        }
      ]
    })
  }

  /**
   * 解析消息中的B站链接
   */
  async parseMessage(e) {
    const config = setting.getConfig()
    if (!config.basic?.enable) return false

    const msg = e.msg || ''
    const rawMsg = e.raw_message || ''

    // 尝试解析各种格式
    let result = null

    // 1. JSON卡片分享
    if (rawMsg === '[json消息]' || e.message?.[0]?.type === 'json') {
      result = await this.parseJsonCard(e)
    }

    // 2. 短链接 b23.tv
    if (!result && rawMsg.includes('b23.tv')) {
      const match = rawMsg.match(URL_PATTERNS.SHORT_LINK)
      if (match) {
        result = await api.resolveShortLink(match[0])
      }
    }

    // 3. 各种完整链接
    if (!result) {
      result = this.matchUrl(rawMsg)
    }

    // 4. 纯BV号
    if (!result) {
      const bvMatch = msg.match(URL_PATTERNS.BV)
      if (bvMatch) {
        result = { type: 'video', id: bvMatch[0] }
      }
    }

    if (!result) return false

    // 检查冷却
    if (config.basic?.cooldown > 0) {
      const cooldownKey = `${REDIS_PREFIX.COOLDOWN}${result.id}`
      const lastTime = await redis.get(cooldownKey)
      if (lastTime) {
        const seconds = moment().diff(moment(lastTime), 'seconds')
        const remaining = config.basic.cooldown - seconds
        if (remaining > 0) {
          logger.mark(`[Bilibili] 解析冷却中，剩余 ${remaining} 秒`)
          return false
        }
      }
      await redis.set(cooldownKey, moment().format('YYYY-MM-DD HH:mm:ss'), { EX: config.basic.cooldown })
    }

    // 根据类型分发
    if (result.type === 'video') {
      e.bilibiliData = { bvid: result.id }
      return this.handleVideo(e, result.id)
    } else if (result.type === 'dynamic') {
      e.bilibiliData = { dynamicId: result.id }
      return this.handleDynamic(e, result.id)
    }

    return false
  }

  /**
   * 解析JSON卡片
   */
  async parseJsonCard(e) {
    try {
      let jsonData = e.msg || ''
      if (e.message?.[0]?.data) {
        jsonData = e.message[0].data
      }

      const data = typeof jsonData === 'string' ? JSON.parse(jsonData.replace(/当前QQ版本不支持此应用，请升级/g, '')) : jsonData
      const url = data?.meta?.detail_1?.qqdocurl || data?.meta?.news?.jumpUrl

      if (!url || (!url.includes('b23.tv') && !url.includes('bilibili.com'))) {
        return null
      }

      return await api.resolveShortLink(url)
    } catch {
      return null
    }
  }

  /**
   * 匹配各种B站链接
   */
  matchUrl(text) {
    const patterns = [
      { pattern: URL_PATTERNS.VIDEO_WWW, type: 'video' },
      { pattern: URL_PATTERNS.VIDEO_M, type: 'video' },
      { pattern: URL_PATTERNS.DYNAMIC_WWW, type: 'dynamic' },
      { pattern: URL_PATTERNS.DYNAMIC_M, type: 'dynamic' },
      { pattern: URL_PATTERNS.DYNAMIC_M2, type: 'dynamic' },
      { pattern: URL_PATTERNS.DYNAMIC_T, type: 'dynamic' }
    ]

    for (const { pattern, type } of patterns) {
      const match = text.match(pattern)
      if (match) {
        return { type, id: match[1] }
      }
    }

    return null
  }

  /**
   * 处理视频
   */
  async handleVideo(e, bvid) {
    // 获取视频信息
    const videoInfo = await api.getVideoInfo(bvid)
    if (!videoInfo) {
      return false
    }

    // 检查是否多P
    const pages = videoInfo.pages || []
    if (pages.length > 1) {
      // 保存分P信息到Redis，等待用户选择
      const pageData = {
        bvid,
        pages: pages.map((p, i) => ({
          index: i,
          cid: p.cid,
          part: p.part,
          duration: p.duration
        })),
        userId: e.user_id,
        groupId: e.group_id,
        timestamp: Date.now()
      }

      const key = `${REDIS_PREFIX.PAGE_SELECT}${e.user_id}`
      await redis.set(key, JSON.stringify(pageData), { EX: setting.getConfig().multiPage?.timeout || 300 })

      // 发送分P选择提示
      let msg = `📺 该视频共 ${pages.length} P，请发送 #p数字 选择分P：\n`
      const showCount = Math.min(pages.length, 10)
      for (let i = 0; i < showCount; i++) {
        const p = pages[i]
        const duration = this.formatDuration(p.duration)
        msg += `\nP${i + 1}: ${p.part} (${duration})`
      }
      if (pages.length > 10) {
        msg += `\n... 共 ${pages.length} P`
      }

      // 如果配置了自动选择第一P
      if (setting.getConfig().multiPage?.autoFirstPage) {
        msg += '\n\n5秒后自动播放P1...'
        e.reply(msg)

        // 延迟后自动处理第一P
        setTimeout(() => {
          this.processVideo(e, bvid, 0, videoInfo)
        }, 5000)
        return true
      }

      e.reply(msg)
      return true
    }

    // 单P视频，直接处理
    return this.processVideo(e, bvid, 0, videoInfo)
  }

  /**
   * 处理分P选择
   */
  async selectPage(e) {
    const match = e.msg.match(/^#?p(\d+)$/i)
    if (!match) return false

    const pageNum = parseInt(match[1])
    const key = `${REDIS_PREFIX.PAGE_SELECT}${e.user_id}`
    const dataStr = await redis.get(key)

    if (!dataStr) {
      return false
    }

    const pageData = JSON.parse(dataStr)

    // 验证是否同一个群
    if (e.group_id && pageData.groupId !== e.group_id) {
      return false
    }

    // 验证分P范围
    if (pageNum < 1 || pageNum > pageData.pages.length) {
      e.reply(`分P选择无效，请选择 1-${pageData.pages.length}`)
      return true
    }

    // 清除Redis记录
    await redis.del(key)

    // 处理选中的分P
    return this.processVideo(e, pageData.bvid, pageNum - 1)
  }

  /**
   * 处理视频（调用BilibiliVideo）
   */
  async processVideo(e, bvid, pageIndex, videoInfo = null) {
    try {
      // 动态导入视频处理模块
      const { BilibiliVideo } = await import('./BilibiliVideo.js')
      const videoHandler = new BilibiliVideo()
      return await videoHandler.processVideo(e, bvid, pageIndex, videoInfo)
    } catch (error) {
      logger.error(`[Bilibili] 处理视频失败: ${error.message}`)
      return false
    }
  }

  /**
   * 处理动态
   */
  async handleDynamic(e, dynamicId) {
    try {
      const { BilibiliDynamic } = await import('./BilibiliDynamic.js')
      const dynamicHandler = new BilibiliDynamic()
      return await dynamicHandler.processDynamic(e, dynamicId)
    } catch (error) {
      logger.error(`[Bilibili] 处理动态失败: ${error.message}`)
      return false
    }
  }

  /**
   * 格式化时长
   */
  formatDuration(seconds) {
    const h = Math.floor(seconds / 3600)
    const m = Math.floor((seconds % 3600) / 60)
    const s = seconds % 60

    if (h > 0) {
      return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
    }
    return `${m}:${s.toString().padStart(2, '0')}`
  }
}
