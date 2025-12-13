/**
 * Bilibili 动态解析模块
 * 负责动态内容解析和展示
 */
import fs from 'node:fs'
import path from 'node:path'
import fetch from 'node-fetch'
import moment from 'moment'
import setting from '../../model/bilibili/bilibili-setting.js'
import api, { buildHeaders } from '../../model/bilibili/bilibili-api.js'
import { API_ENDPOINTS, REPLY_TYPE } from '../../model/bilibili/bilibili-const.js'

export class BilibiliDynamic extends plugin {
  constructor() {
    super({
      name: '[Bilibili]动态处理',
      dsc: 'B站动态解析',
      event: 'message',
      priority: -120,
      rule: []
    })
  }

  /**
   * 处理动态
   */
  async processDynamic(e, dynamicId) {
    const config = setting.getConfig()
    if (!config.dynamic?.enable) return false

    const headers = await buildHeaders()
    if (!headers) {
      e.reply('获取认证信息失败')
      return false
    }

    // 获取动态详情
    const dynamicData = await this.getDynamicDetail(dynamicId, headers)
    if (!dynamicData) {
      e.reply('获取动态信息失败')
      return false
    }

    // 如果是视频动态，转交视频处理
    if (dynamicData.type === 'video') {
      const { BilibiliVideo } = await import('./BilibiliVideo.js')
      const videoHandler = new BilibiliVideo()
      return await videoHandler.processVideo(e, dynamicData.bvid, 0)
    }

    // 发送动态信息并保存数据
    const msgResult = await this.sendDynamicInfo(e, dynamicData, config)

    // 保存数据用于后续操作（引用回复）
    await this.saveDynamicData(e, dynamicData, msgResult)

    return true
  }

  /**
   * 保存动态数据到临时文件
   */
  async saveDynamicData(e, data, msgResult) {
    const tempDir = path.join(process.cwd(), 'plugins', 'yunzai-plugin-integration', 'temp', 'bilibili')
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true })
    }

    const msgId = msgResult?.message_id || msgResult?.data?.message_id
    if (!msgId) return

    const safeId = msgId.toString().replace(/\//g, '')
    const dataPath = path.join(tempDir, `${safeId}.json`)

    try {
      fs.writeFileSync(dataPath, JSON.stringify(data, null, 2), 'utf-8')
    } catch (error) {
      logger.error(`[Bilibili] 保存动态数据失败: ${error.message}`)
    }
  }

  /**
   * 获取动态详情
   */
  async getDynamicDetail(dynamicId, headers) {
    try {
      // 尝试新接口
      let url = `${API_ENDPOINTS.DYNAMIC_DETAIL}?id=${dynamicId}&timezone_offset=-480`
      let res = await fetch(url, { headers })
      let json = await res.json()

      if (json.data?.item) {
        return this.parseNewDynamic(json.data.item)
      }

      // 尝试旧接口
      url = `${API_ENDPOINTS.DYNAMIC_DETAIL_OLD}?dynamic_id=${dynamicId}`
      res = await fetch(url, { headers })
      json = await res.json()

      if (json.data?.card) {
        return this.parseOldDynamic(json.data.card)
      }

      return null
    } catch (error) {
      logger.error(`[Bilibili] 获取动态详情失败: ${error.message}`)
      return null
    }
  }

  /**
   * 解析新版动态
   */
  parseNewDynamic(item) {
    const type = item.type
    const modules = item.modules || {}
    const author = modules.module_author || {}
    const dynamic = modules.module_dynamic || {}
    const stat = modules.module_stat || {}
    const basic = item.basic || {}

    // 视频动态转交视频处理
    if (type === 'DYNAMIC_TYPE_AV') {
      const bvid = dynamic.major?.archive?.bvid
      if (bvid) {
        return { type: 'video', bvid }
      }
    }

    const result = {
      type: 'dynamic',
      dynamicId: item.id_str,
      commentId: basic.comment_id_str,
      commentType: basic.comment_type,
      // 作者信息
      authorName: author.name,
      authorFace: author.face,
      authorMid: author.mid,
      pubTime: author.pub_time,
      // 统计
      likeCount: stat.like?.count || 0,
      commentCount: stat.comment?.count || 0,
      forwardCount: stat.forward?.count || 0,
      // 内容
      text: '',
      images: [],
      title: ''
    }

    // 解析内容
    if (dynamic.desc) {
      result.text = this.parseRichText(dynamic.desc)
    }

    // 图文动态
    if (dynamic.major?.type === 'MAJOR_TYPE_DRAW') {
      const items = dynamic.major.draw?.items || []
      result.images = items.map(i => i.src)
    }

    // OPUS动态
    if (dynamic.major?.type === 'MAJOR_TYPE_OPUS') {
      const opus = dynamic.major.opus || {}
      result.title = opus.title || ''
      if (opus.pics) {
        result.images = opus.pics.map(p => p.url)
      }
      if (opus.summary) {
        result.text = this.parseRichText(opus.summary)
      }
    }

    // 转发动态
    if (type === 'DYNAMIC_TYPE_FORWARD' && item.orig) {
      result.forward = this.parseNewDynamic(item.orig)
    }

    return result
  }

  /**
   * 解析旧版动态
   */
  parseOldDynamic(card) {
    const desc = card.desc || {}
    const cardData = JSON.parse(card.card || '{}')

    return {
      type: 'dynamic',
      dynamicId: desc.dynamic_id_str,
      commentId: desc.rid_str,
      commentType: REPLY_TYPE.PHOTO_ALBUM,
      authorName: desc.user_profile?.info?.uname,
      authorFace: desc.user_profile?.info?.face,
      authorMid: desc.uid,
      pubTime: moment(desc.timestamp * 1000).format('YYYY-MM-DD HH:mm'),
      likeCount: desc.like || 0,
      commentCount: desc.comment || 0,
      forwardCount: desc.repost || 0,
      text: cardData.item?.description || '',
      images: (cardData.item?.pictures || []).map(p => p.img_src),
      title: ''
    }
  }

  /**
   * 解析富文本
   */
  parseRichText(data) {
    if (!data) return ''

    let text = data.text || ''
    const nodes = data.rich_text_nodes || []

    // 处理emoji等特殊节点
    for (const node of nodes) {
      if (node.emoji) {
        text = text.replace(node.emoji.text, `[${node.emoji.text}]`)
      }
    }

    return text
  }

  /**
   * 发送动态信息
   * @returns {Promise<object>} 消息发送结果
   */
  async sendDynamicInfo(e, data, config) {
    const messages = []

    // 作者信息
    let text = `👤 ${data.authorName}\n📅 ${data.pubTime}`

    // 标题
    if (data.title) {
      text += `\n\n📌 ${data.title}`
    }

    // 内容
    if (data.text) {
      text += `\n\n${data.text}`
    }

    // 统计
    text += `\n\n👍 ${data.likeCount}  💬 ${data.commentCount}  🔄 ${data.forwardCount}`

    messages.push(text)
    const msgResult = await e.reply(messages)

    // 发送图片
    if (config.dynamic?.sendImages && data.images?.length) {
      const limit = config.dynamic?.imageLimit || 5
      const images = data.images.slice(0, limit)

      for (const img of images) {
        try {
          await e.reply(segment.image(img))
        } catch (err) {
          logger.warn(`[Bilibili] 发送图片失败: ${err.message}`)
        }
      }

      if (data.images.length > limit) {
        await e.reply(`还有 ${data.images.length - limit} 张图片未显示`)
      }
    }

    // 转发内容
    if (data.forward) {
      await e.reply('--- 转发内容 ---')
      await this.sendDynamicInfo(e, data.forward, { dynamic: { sendImages: false } })
    }

    return msgResult
  }
}
