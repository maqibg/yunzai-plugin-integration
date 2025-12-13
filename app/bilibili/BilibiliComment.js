/**
 * Bilibili 评论系统模块
 * 负责评论区获取和展示
 */
import fetch from 'node-fetch'
import setting from '../../model/bilibili/bilibili-setting.js'
import { buildHeaders } from '../../model/bilibili/bilibili-api.js'
import { API_ENDPOINTS, REPLY_TYPE } from '../../model/bilibili/bilibili-const.js'

export class BilibiliComment extends plugin {
  constructor() {
    super({
      name: '[Bilibili]评论系统',
      dsc: 'B站评论区功能',
      event: 'message',
      priority: -120,
      rule: [
        {
          reg: '^#?展开(\\d+)$',
          fnc: 'expandComment'
        },
        {
          reg: '^#?(获取图片|下载图片|图片)$',
          fnc: 'downloadCommentImages'
        }
      ]
    })
  }

  /**
   * 获取评论区
   * @param {string} oid 评论区ID
   * @param {number} type 评论区类型
   * @param {number} count 获取数量
   */
  async getComments(oid, type = REPLY_TYPE.VIDEO, count = 10) {
    const headers = await buildHeaders()
    if (!headers) return []

    try {
      const url = `${API_ENDPOINTS.REPLY_MAIN}?oid=${oid}&type=${type}&sort=1&nohot=0&ps=${count}&pn=1`
      const res = await fetch(url, { headers })
      const json = await res.json()

      if (json.code === 12002) {
        logger.warn('[Bilibili] 评论区已关闭')
        return []
      }

      if (json.code !== 0) {
        logger.error(`[Bilibili] 获取评论失败: ${json.message}`)
        return []
      }

      const replies = json.data?.replies || []
      const comments = this.parseComments(replies)

      // 处理置顶评论
      if (json.data?.upper?.top) {
        const topComment = this.parseComments([json.data.upper.top])[0]
        if (topComment) {
          topComment.isTop = true
          // 去重
          const index = comments.findIndex(c => c.rpid === topComment.rpid)
          if (index > -1) {
            comments.splice(index, 1)
          }
          comments.unshift(topComment)
        }
      }

      // 添加序号
      comments.forEach((c, i) => c.index = i + 1)

      return comments
    } catch (error) {
      logger.error(`[Bilibili] 获取评论异常: ${error.message}`)
      return []
    }
  }

  /**
   * 获取子评论
   */
  async getSubComments(oid, rpid, type = REPLY_TYPE.VIDEO, count = 20) {
    const headers = await buildHeaders()
    if (!headers) return []

    try {
      const url = `${API_ENDPOINTS.REPLY_REPLY}?oid=${oid}&root=${rpid}&type=${type}&ps=${count}&pn=1`
      const res = await fetch(url, { headers })
      const json = await res.json()

      if (json.code !== 0) {
        logger.error(`[Bilibili] 获取子评论失败: ${json.message}`)
        return []
      }

      const replies = json.data?.replies || []
      const comments = this.parseComments(replies, false)

      comments.forEach((c, i) => c.index = i + 1)
      return comments
    } catch (error) {
      logger.error(`[Bilibili] 获取子评论异常: ${error.message}`)
      return []
    }
  }

  /**
   * 解析评论数据
   */
  parseComments(replies, sortByLike = true) {
    if (!replies?.length) return []

    // 按点赞数排序
    if (sortByLike) {
      replies.sort((a, b) => b.like - a.like)
    }

    return replies.map(r => {
      const comment = {
        rpid: r.rpid,
        name: r.member?.uname || '',
        avatar: r.member?.avatar || '',
        sex: r.member?.sex || '',
        level: r.member?.level_info?.current_level || 0,
        isSenior: r.member?.is_senior_member || 0,
        content: this.parseContent(r.content),
        likeCount: r.like || 0,
        replyCount: r.rcount || 0,
        time: r.reply_control?.time_desc?.replace('发布', '') || '',
        location: r.reply_control?.location?.replace('IP属地：', '') || '',
        images: this.parseImages(r.content?.pictures)
      }

      // 子评论提示
      if (r.reply_control?.sub_reply_entry_text) {
        comment.subReplyText = r.reply_control.sub_reply_entry_text
      }

      return comment
    })
  }

  /**
   * 解析评论内容
   */
  parseContent(content) {
    if (!content) return ''

    let text = content.message || ''

    // 处理表情
    if (content.emote) {
      for (const [name, emote] of Object.entries(content.emote)) {
        text = text.replace(name, `[表情:${name}]`)
      }
    }

    // 处理@回复
    if (text.includes('回复 @')) {
      const match = text.match(/回复 @(.+?) :/)
      if (match) {
        text = text.replace(`回复 @${match[1]} :`, `[回复@${match[1]}] `)
      }
    }

    return text
  }

  /**
   * 解析评论图片
   */
  parseImages(pictures) {
    if (!pictures?.length) return []
    return pictures.map(p => p.img_src)
  }

  /**
   * 展开评论区
   */
  async expandComment(e) {
    const match = e.msg.match(/^#?展开(\d+)$/)
    if (!match) return false

    const index = parseInt(match[1])

    // 获取引用消息的数据
    const videoData = await this.getDataFromReply(e)
    if (!videoData) {
      return false
    }

    // 获取评论数据
    const oid = videoData.bvid || videoData.commentId
    const type = videoData.commentType || REPLY_TYPE.VIDEO

    const comments = await this.getComments(oid, type, 20)
    if (!comments.length) {
      e.reply('暂无评论')
      return true
    }

    if (index < 1 || index > comments.length) {
      e.reply(`请选择 1-${comments.length} 的评论序号`)
      return true
    }

    const comment = comments[index - 1]

    // 获取子评论
    const subComments = await this.getSubComments(oid, comment.rpid, type)

    // 发送评论详情
    await this.sendCommentDetail(e, comment, subComments)
    return true
  }

  /**
   * 发送评论详情
   */
  async sendCommentDetail(e, comment, subComments) {
    let text = `用户: ${comment.name} (Lv.${comment.level})`
    if (comment.location) text += ` IP属地: ${comment.location}`
    text += `\n时间: ${comment.time}`
    text += `\n\n${comment.content}`
    text += `\n\n点赞: ${comment.likeCount}`

    await e.reply(text)

    // 发送图片
    if (comment.images?.length) {
      for (const img of comment.images) {
        await e.reply(segment.image(img))
      }
    }

    // 发送子评论
    if (subComments?.length) {
      let subText = `--- ${comment.subReplyText || `${subComments.length}条回复`} ---\n`

      for (const sub of subComments.slice(0, 5)) {
        subText += `\n${sub.index}. ${sub.name}: ${sub.content.substring(0, 50)}${sub.content.length > 50 ? '...' : ''}`
      }

      if (subComments.length > 5) {
        subText += `\n... 还有 ${subComments.length - 5} 条回复`
      }

      await e.reply(subText)
    }
  }

  /**
   * 从引用回复获取数据
   */
  async getDataFromReply(e) {
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
      const dataPath = setting.getTempFilePath(`${msgId}.json`)

      const fs = await import('node:fs')
      if (fs.existsSync(dataPath)) {
        return JSON.parse(fs.readFileSync(dataPath, 'utf-8'))
      }

      return null
    } catch {
      return null
    }
  }

  /**
   * 格式化数字
   */
  formatNumber(num) {
    if (num >= 10000) {
      return (num / 10000).toFixed(1) + '万'
    }
    return num.toString()
  }

  /**
   * 下载评论区图片
   */
  async downloadCommentImages(e) {
    const commentData = await this.getDataFromReply(e)
    if (!commentData) return false

    // 检查是否有图片
    const images = commentData.images || commentData.pic || []
    if (!images.length) {
      // 可能是展开评论后的数据，检查是否有嵌套的图片
      if (commentData.n && commentData.msg_id) {
        // 从原消息数据获取图片
        const originalData = await this.getOriginalCommentData(commentData.msg_id, commentData.n)
        if (originalData?.pic?.length) {
          for (const img of originalData.pic) {
            await e.reply(segment.image(img))
          }
          return true
        }
      }
      e.reply('该评论没有图片')
      return true
    }

    // 发送图片
    for (const img of images) {
      await e.reply(segment.image(img))
    }
    return true
  }

  /**
   * 获取原始评论数据中的图片
   */
  async getOriginalCommentData(msgId, index) {
    try {
      const dataPath = setting.getTempFilePath(`${msgId}.json`)
      const fs = await import('node:fs')
      if (fs.existsSync(dataPath)) {
        const data = JSON.parse(fs.readFileSync(dataPath, 'utf-8'))
        if (data.pls && data.pls[index - 1]) {
          return data.pls[index - 1]
        }
      }
      return null
    } catch {
      return null
    }
  }
}
