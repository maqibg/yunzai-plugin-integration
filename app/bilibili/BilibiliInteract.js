/**
 * Bilibili 互动操作模块
 * 负责点赞、投币、收藏、关注等操作
 */
import setting from '../../model/bilibili/bilibili-setting.js'
import api, { buildHeaders, fetchBili, explainBiliCode } from '../../model/bilibili/bilibili-api.js'
import { API_ENDPOINTS } from '../../model/bilibili/bilibili-const.js'

export class BilibiliInteract extends plugin {
  constructor() {
    super({
      name: '[Bilibili]互动操作',
      dsc: 'B站点赞投币收藏等',
      event: 'message',
      priority: -120,
      rule: [
        {
          reg: '^#?(点赞|赞)$',
          fnc: 'likeVideo'
        },
        {
          reg: '^#?取消点赞$',
          fnc: 'unlikeVideo'
        },
        {
          reg: '^#?投币(\\d*)$',
          fnc: 'coinVideo'
        },
        {
          reg: '^#?收藏$',
          fnc: 'favVideo'
        },
        {
          reg: '^#?取消收藏$',
          fnc: 'unfavVideo'
        },
        {
          reg: '^#?三连$',
          fnc: 'tripleVideo'
        },
        {
          reg: '^#?关注$',
          fnc: 'followUp'
        },
        {
          reg: '^#?取消关注$',
          fnc: 'unfollowUp'
        },
        {
          reg: '^#?拉黑$',
          fnc: 'blockUp'
        },
        {
          reg: '^#?取消拉黑$',
          fnc: 'unblockUp'
        },
        {
          reg: '^#?评论.+',
          fnc: 'sendComment'
        }
      ]
    })
  }

  /**
   * 检查功能是否启用
   */
  checkEnabled() {
    const config = setting.getConfig()
    return config.interact?.enable !== false
  }

  /**
   * 获取CSRF Token
   */
  async getCsrf() {
    const cookie = setting.getCookie()
    if (!cookie) return null
    const match = cookie.match(/bili_jct=([\w]+)/)
    return match ? match[1] : null
  }

  /**
   * 从引用获取视频数据
   */
  async getVideoFromReply(e) {
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

      if (!source) {
        await e.reply('请先引用一条已解析的B站视频再使用这个指令')
        return null
      }

      const msgId = source.message_id?.toString().replace(/\//g, '')
      const fs = await import('node:fs')
      const dataPath = setting.getTempFilePath(`${msgId}.json`)

      if (fs.existsSync(dataPath)) {
        return JSON.parse(fs.readFileSync(dataPath, 'utf-8'))
      }

      await e.reply('这条消息没有B站视频数据，请先发送视频链接解析后再引用它')
      return null
    } catch (error) {
      logger.error(`[Bilibili] 读取引用视频数据失败: ${error.message}`)
      await e.reply('读取引用消息失败，请重新引用视频后再试')
      return null
    }
  }

  /**
   * 统一的互动请求：认证 → 发请求 → 按返回码回复
   * 11 个指令原本各抄一遍同样的三十来行，这里收拢到一处
   * @param {object} e 消息事件
   * @param {object} opts url(csrf) 目标地址、action 动作名、success 成功提示、known 已知返回码提示
   */
  async doAction(e, { url, action, success, known = [] }) {
    const headers = await buildHeaders(null, true)
    if (!headers) {
      await e.reply('请先执行 #b站登录')
      return true
    }

    const csrf = await this.getCsrf()
    if (!csrf) {
      await e.reply('获取认证信息失败，请重新执行 #b站登录')
      return true
    }

    try {
      headers.Accept = 'application/x-www-form-urlencoded'
      const res = await fetchBili(url(csrf), { method: 'POST', headers })
      const json = await res.json()

      if (json.code === 0) {
        await e.reply(`[Bilibili] ${success}`)
        return true
      }

      const knownText = known.find(([code]) => code === json.code)?.[1]
      await e.reply(knownText
        ? `[Bilibili] ${knownText}`
        : `[Bilibili] ${action}失败: ${explainBiliCode(json.code, json.message)}`)
    } catch (error) {
      await e.reply(`[Bilibili] ${action}异常: ${error.message}`)
    }

    return true
  }

  /**
   * 取引用视频的作者 mid，缺失时给出可操作的提示
   */
  async getUpMid(e) {
    const videoData = await this.getVideoFromReply(e)
    if (!videoData) return null
    if (!videoData.upMid) {
      await e.reply('这条视频数据里没有UP主信息，可能解析已过期，请重新发送视频链接')
      return null
    }
    return videoData.upMid
  }

  /**
   * 点赞视频
   */
  async likeVideo(e) {
    if (!this.checkEnabled()) return false

    const videoData = await this.getVideoFromReply(e)
    if (!videoData?.bvid) return false

    return this.doAction(e, {
      action: '点赞',
      success: '点赞成功！',
      known: [[65006, '已经点过赞了']],
      url: csrf => `${API_ENDPOINTS.VIDEO_LIKE}?csrf=${csrf}&bvid=${videoData.bvid}&like=1`
    })
  }

  /**
   * 取消点赞
   */
  async unlikeVideo(e) {
    if (!this.checkEnabled()) return false

    const videoData = await this.getVideoFromReply(e)
    if (!videoData?.bvid) return false

    return this.doAction(e, {
      action: '取消点赞',
      success: '取消点赞成功',
      known: [[65004, '还没点过赞呢']],
      url: csrf => `${API_ENDPOINTS.VIDEO_LIKE}?csrf=${csrf}&bvid=${videoData.bvid}&like=2`
    })
  }

  /**
   * 投币
   */
  async coinVideo(e) {
    if (!this.checkEnabled() || !e.isMaster) return false

    const videoData = await this.getVideoFromReply(e)
    if (!videoData?.bvid) return false

    const match = e.msg.match(/^#?投币(\d*)$/)
    const coinNum = Math.min(parseInt(match?.[1]) || 2, 2)

    return this.doAction(e, {
      action: '投币',
      success: `投币 ${coinNum} 个成功！`,
      known: [[-104, '硬币不够了'], [34005, '已经投过币了']],
      url: csrf => `${API_ENDPOINTS.VIDEO_COIN}?bvid=${videoData.bvid}&multiply=${coinNum}&select_like=1&csrf=${csrf}`
    })
  }

  /**
   * 收藏
   */
  async favVideo(e) {
    if (!this.checkEnabled() || !e.isMaster) return false

    const videoData = await this.getVideoFromReply(e)
    if (!videoData?.bvid) return false

    const videoInfo = await api.getVideoInfo(videoData.bvid)
    if (!videoInfo) {
      await e.reply('获取视频信息失败')
      return true
    }

    const mediaId = await this.getDefaultFavFolder()
    if (!mediaId) {
      await e.reply('获取收藏夹失败')
      return true
    }

    return this.doAction(e, {
      action: '收藏',
      success: '收藏成功！',
      url: csrf => `${API_ENDPOINTS.FAV_DEAL}?rid=${videoInfo.aid}&type=2&add_media_ids=${mediaId}&csrf=${csrf}`
    })
  }

  /**
   * 取消收藏
   */
  async unfavVideo(e) {
    if (!this.checkEnabled() || !e.isMaster) return false

    const videoData = await this.getVideoFromReply(e)
    if (!videoData?.bvid) return false

    const videoInfo = await api.getVideoInfo(videoData.bvid)
    if (!videoInfo) return true

    const mediaId = await this.getDefaultFavFolder()
    if (!mediaId) return true

    return this.doAction(e, {
      action: '取消收藏',
      success: '取消收藏成功',
      url: csrf => `${API_ENDPOINTS.FAV_DEAL}?rid=${videoInfo.aid}&type=2&del_media_ids=${mediaId}&csrf=${csrf}`
    })
  }

  /**
   * 三连
   */
  async tripleVideo(e) {
    if (!this.checkEnabled() || !e.isMaster) return false

    const videoData = await this.getVideoFromReply(e)
    if (!videoData?.bvid) return false

    const videoInfo = await api.getVideoInfo(videoData.bvid)
    if (!videoInfo) return true

    return this.doAction(e, {
      action: '三连',
      success: '三连成功！',
      url: csrf => `${API_ENDPOINTS.VIDEO_TRIPLE}?aid=${videoInfo.aid}&csrf=${csrf}`
    })
  }

  /**
   * 关注UP主
   */
  async followUp(e) {
    if (!this.checkEnabled() || !e.isMaster) return false

    const mid = await this.getUpMid(e)
    if (!mid) return false

    return this.doAction(e, {
      action: '关注',
      success: '关注成功！',
      known: [[22014, '已经关注过了']],
      url: csrf => `${API_ENDPOINTS.USER_RELATION}?fid=${mid}&act=1&re_src=14&csrf=${csrf}`
    })
  }

  /**
   * 取消关注
   */
  async unfollowUp(e) {
    if (!this.checkEnabled() || !e.isMaster) return false

    const mid = await this.getUpMid(e)
    if (!mid) return false

    return this.doAction(e, {
      action: '取消关注',
      success: '取消关注成功',
      url: csrf => `${API_ENDPOINTS.USER_RELATION}?fid=${mid}&act=2&re_src=14&csrf=${csrf}`
    })
  }

  /**
   * 获取默认收藏夹ID
   */
  async getDefaultFavFolder() {
    const config = setting.getConfig()
    const folderIndex = config.interact?.defaultFavFolder || 1

    const headers = await buildHeaders(null, true)
    if (!headers) return null

    try {
      const myInfo = await api.getMyInfo()
      if (!myInfo) return null

      const url = `${API_ENDPOINTS.FAV_LIST}?up_mid=${myInfo.mid}`
      const res = await fetchBili(url, { headers })
      const json = await res.json()

      if (json.code !== 0 || !json.data?.list?.length) return null
      return json.data.list[Math.min(folderIndex - 1, json.data.list.length - 1)]?.id
    } catch {
      return null
    }
  }

  /**
   * 拉黑UP主
   */
  async blockUp(e) {
    if (!this.checkEnabled() || !e.isMaster) return false

    const mid = await this.getUpMid(e)
    if (!mid) return false

    return this.doAction(e, {
      action: '拉黑',
      success: '拉黑成功！',
      known: [[22120, '这家伙已经在黑名单里了']],
      url: csrf => `${API_ENDPOINTS.USER_RELATION}?fid=${mid}&act=5&re_src=14&csrf=${csrf}`
    })
  }

  /**
   * 取消拉黑
   */
  async unblockUp(e) {
    if (!this.checkEnabled() || !e.isMaster) return false

    const mid = await this.getUpMid(e)
    if (!mid) return false

    return this.doAction(e, {
      action: '取消拉黑',
      success: '取消拉黑成功',
      url: csrf => `${API_ENDPOINTS.USER_RELATION}?fid=${mid}&act=6&re_src=14&csrf=${csrf}`
    })
  }

  /**
   * 发送评论
   */
  async sendComment(e) {
    if (!this.checkEnabled() || !e.isMaster) return false

    const videoData = await this.getVideoFromReply(e)
    if (!videoData) return false

    const message = e.msg.replace(/^#?评论/, '').trim()
    if (!message) {
      await e.reply('请输入评论内容')
      return true
    }

    const oid = videoData.bvid || videoData.commentId
    const type = videoData.commentType || 1

    return this.doAction(e, {
      action: '评论',
      success: `评论「${message}」发送成功！`,
      known: [
        [12025, '评论字数太多了'],
        [12002, '评论区已关闭'],
        [12052, '评论区已关闭'],
        [12003, '评论区已关闭'],
        [-101, 'Cookie可能已失效，请重新登录'],
        [-111, 'Cookie可能已失效，请重新登录'],
        [-403, 'Cookie可能已失效，请重新登录']
      ],
      url: csrf => `${API_ENDPOINTS.REPLY_ADD}?type=${type}&oid=${oid}&message=${encodeURIComponent(message)}&csrf=${csrf}`
    })
  }
}
