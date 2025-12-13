/**
 * Bilibili 视频处理模块
 * 负责视频信息展示、下载等
 */
import fs from 'node:fs'
import path from 'node:path'
import moment from 'moment'
import setting from '../../model/bilibili/bilibili-setting.js'
import api from '../../model/bilibili/bilibili-api.js'
import downloader, { formatSize, getQualityName } from '../../model/bilibili/bilibili-download.js'

const pluginRoot = path.join(process.cwd(), 'plugins', 'yunzai-plugin-integration')

export class BilibiliVideo extends plugin {
  constructor() {
    super({
      name: '[Bilibili]视频处理',
      dsc: 'B站视频解析和下载',
      event: 'message',
      priority: 101,
      rule: [
        {
          reg: '^#?(下载视频|视频下载|获取视频)$',
          fnc: 'downloadVideo'
        },
        {
          reg: '^#?(下载封面|封面下载|获取封面|封面)$',
          fnc: 'downloadCover'
        },
        {
          reg: '^#?简介$',
          fnc: 'showIntro'
        }
      ]
    })
  }

  /**
   * 处理视频（核心方法）
   */
  async processVideo(e, bvid, pageIndex = 0, videoInfo = null) {
    const config = setting.getConfig()

    // 获取视频信息
    if (!videoInfo) {
      videoInfo = await api.getVideoInfo(bvid)
      if (!videoInfo) {
        e.reply('获取视频信息失败')
        return false
      }
    }

    // 获取UP主信息
    const upInfo = await api.getUserCard(videoInfo.owner.mid)

    // 获取在线人数
    const cid = videoInfo.pages[pageIndex]?.cid || videoInfo.cid
    const online = await api.getOnlineCount(bvid, cid)

    // 检查点赞/投币/收藏状态
    const status = await api.checkVideoStatus(bvid)

    // 构建展示数据
    const displayData = this.buildDisplayData(videoInfo, upInfo, online, status, pageIndex, config)

    // 发送视频信息并获取消息结果
    const msgResult = await this.sendVideoInfo(e, displayData, config)

    // 保存数据用于后续操作（引用回复）
    await this.saveVideoData(e, displayData, msgResult)

    // 检查是否需要自动下载
    const shouldDownload = await this.shouldAutoDownload(bvid, pageIndex, config)
    if (shouldDownload) {
      const video = await downloader.download(e, bvid, pageIndex, true)
      if (video) {
        await e.reply(video)
      }
    }

    // 发送原链接
    if (config.link?.showOriginal) {
      await e.reply(`B站链接: https://b23.tv/${bvid}`)
    }

    return true
  }

  /**
   * 构建展示数据
   */
  buildDisplayData(videoInfo, upInfo, online, status, pageIndex, config) {
    const page = videoInfo.pages[pageIndex] || videoInfo.pages[0]

    return {
      bvid: videoInfo.bvid,
      aid: videoInfo.aid,
      title: videoInfo.title,
      desc: this.truncateDesc(videoInfo.desc, config.display?.descMaxLength || 120),
      fullDesc: videoInfo.desc,
      pic: videoInfo.pic,
      duration: this.formatDuration(page?.duration || videoInfo.duration),
      durationSec: page?.duration || videoInfo.duration,
      pubdate: moment(videoInfo.pubdate * 1000).format('YYYY-MM-DD HH:mm'),
      // 分P信息
      pageIndex,
      pageCount: videoInfo.pages.length,
      pagePart: page?.part || '',
      // UP主信息
      upMid: videoInfo.owner.mid,
      upName: videoInfo.owner.name,
      upFace: videoInfo.owner.face,
      upFans: this.formatNumber(upInfo?.fans || 0),
      upLevel: upInfo?.level_info?.current_level || 0,
      upSenior: upInfo?.is_senior_member || 0,
      isFollowed: upInfo?.is_followed || false,
      // 统计数据
      view: this.formatNumber(videoInfo.stat.view),
      danmaku: this.formatNumber(videoInfo.stat.danmaku),
      reply: this.formatNumber(videoInfo.stat.reply),
      favorite: this.formatNumber(videoInfo.stat.favorite),
      coin: this.formatNumber(videoInfo.stat.coin),
      share: this.formatNumber(videoInfo.stat.share),
      like: this.formatNumber(videoInfo.stat.like),
      online: online || 0,
      // 状态
      isLiked: status.like,
      isCoined: status.coin,
      isFavoured: status.favoured,
      // 原始数据
      _raw: videoInfo
    }
  }

  /**
   * 发送视频信息
   * @returns {Promise<object>} 消息发送结果
   */
  async sendVideoInfo(e, data, config) {
    const messages = []

    // 封面
    if (config.display?.showCover && data.pic) {
      messages.push(segment.image(data.pic))
    }

    // 标题
    let text = `📺 ${data.title}`
    if (data.pageCount > 1) {
      text += `\n📑 P${data.pageIndex + 1}/${data.pageCount}: ${data.pagePart}`
    }

    // 统计数据
    if (config.display?.showStats) {
      text += `\n\n▶️ ${data.view}  💬 ${data.danmaku}  👍 ${data.like}`
      text += `\n⭐ ${data.favorite}  💰 ${data.coin}  🔄 ${data.share}`
    }

    // UP主
    text += `\n\n👤 ${data.upName} (粉丝: ${data.upFans})`
    text += `\n📅 ${data.pubdate}  ⏱️ ${data.duration}`

    // 简介
    if (config.display?.showDesc && data.desc) {
      text += `\n\n📝 ${data.desc}`
    }

    messages.push(text)

    return await e.reply(messages)
  }

  /**
   * 保存视频数据到临时文件
   */
  async saveVideoData(e, data, msgResult) {
    const tempDir = setting.tempPath
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true })
    }

    // 获取消息ID
    const msgId = msgResult?.message_id || msgResult?.data?.message_id
    if (!msgId) {
      logger.warn('[Bilibili] 无法获取消息ID，跳过数据保存')
      return
    }

    const safeId = msgId.toString().replace(/\//g, '')
    const dataPath = path.join(tempDir, `${safeId}.json`)

    try {
      fs.writeFileSync(dataPath, JSON.stringify(data, null, 2), 'utf-8')
      logger.debug(`[Bilibili] 视频数据已保存: ${safeId}`)
    } catch (error) {
      logger.error(`[Bilibili] 保存视频数据失败: ${error.message}`)
    }
  }

  /**
   * 检查是否需要自动下载
   */
  async shouldAutoDownload(bvid, pageIndex, config) {
    const videoConfig = config.video || {}

    // 检查文件大小限制
    const checkResult = await downloader.canDownload(bvid, pageIndex)
    if (!checkResult.can) return false

    // 预估大小检查
    const cid = checkResult.page?.cid
    if (!cid) return false

    const estimatedSize = await downloader.getEstimatedSize(bvid, cid, videoConfig.quality || 64)
    const threshold = (videoConfig.sendThreshold || 100) * 1048576

    return estimatedSize > 0 && estimatedSize <= threshold
  }

  /**
   * 下载视频（引用回复）
   */
  async downloadVideo(e) {
    const videoData = await this.getVideoDataFromReply(e)
    if (!videoData) return false

    const video = await downloader.download(e, videoData.bvid, videoData.pageIndex || 0, true)
    if (video) {
      await e.reply(video)
    }
    return true
  }

  /**
   * 下载封面（引用回复）
   */
  async downloadCover(e) {
    const videoData = await this.getVideoDataFromReply(e)
    if (!videoData) return false

    if (videoData.pic) {
      await e.reply(segment.image(videoData.pic))
      return true
    }

    // 如果没有缓存数据，尝试重新获取
    const videoInfo = await api.getVideoInfo(videoData.bvid)
    if (videoInfo?.pic) {
      await e.reply(segment.image(videoInfo.pic))
      return true
    }

    e.reply('获取封面失败')
    return false
  }

  /**
   * 显示完整简介
   */
  async showIntro(e) {
    const videoData = await this.getVideoDataFromReply(e)
    if (!videoData) return false

    const desc = videoData.fullDesc || videoData.desc
    if (!desc) {
      e.reply('该视频没有简介')
      return true
    }

    await e.reply(`📝 视频简介：\n\n${desc}`)
    return true
  }

  /**
   * 从引用回复获取视频数据
   */
  async getVideoDataFromReply(e) {
    if (!e.source && !e.getReply) return null

    try {
      let source = {}

      if (e.source) {
        if (e.source.message_id) {
          try {
            source = await Bot.getMsg(e.source.message_id)
          } catch {
            source = await e.bot.getMsg(e.source.message_id)
          }
        } else {
          source = e.isGroup
            ? (await e.group.getChatHistory(e.source?.seq, 1)).pop()
            : (await e.friend.getChatHistory((e.source?.time + 1), 1)).pop()
        }
      } else {
        source = await e.getReply()
      }

      if (!source) return null

      const msgId = source.message_id?.toString().replace(/\//g, '')
      const dataPath = path.join(setting.tempPath, `${msgId}.json`)

      if (fs.existsSync(dataPath)) {
        return JSON.parse(fs.readFileSync(dataPath, 'utf-8'))
      }

      return null
    } catch (error) {
      logger.error(`[Bilibili] 获取引用数据失败: ${error.message}`)
      return null
    }
  }

  /**
   * 格式化数字（添加千分位）
   */
  formatNumber(num) {
    if (typeof num !== 'number') num = parseInt(num) || 0
    if (num >= 100000000) {
      return (num / 100000000).toFixed(1) + '亿'
    }
    if (num >= 10000) {
      return (num / 10000).toFixed(1) + '万'
    }
    return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  }

  /**
   * 格式化时长
   */
  formatDuration(seconds) {
    const h = Math.floor(seconds / 3600)
    const m = Math.floor((seconds % 3600) / 60)
    const s = seconds % 60

    if (h > 0) {
      return `${h}小时${m}分${s}秒`
    }
    if (m > 0) {
      return `${m}分${s}秒`
    }
    return `${s}秒`
  }

  /**
   * 截断描述
   */
  truncateDesc(desc, maxLength) {
    if (!desc) return ''
    if (desc.length <= maxLength) return desc
    return desc.substring(0, maxLength) + '...'
  }
}
