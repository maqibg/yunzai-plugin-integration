/**
 * Bilibili 互动操作模块
 * 负责点赞、投币、收藏、关注等操作
 */
import fetch from 'node-fetch'
import setting from '../../model/bilibili/bilibili-setting.js'
import api, { buildHeaders } from '../../model/bilibili/bilibili-api.js'
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

      if (!source) return null

      const msgId = source.message_id?.toString().replace(/\//g, '')
      const fs = await import('node:fs')
      const dataPath = setting.getTempFilePath(`${msgId}.json`)

      if (fs.existsSync(dataPath)) {
        return JSON.parse(fs.readFileSync(dataPath, 'utf-8'))
      }

      return null
    } catch {
      return null
    }
  }

  /**
   * 点赞视频
   */
  async likeVideo(e) {
    if (!this.checkEnabled()) return false

    const videoData = await this.getVideoFromReply(e)
    if (!videoData?.bvid) return false

    const headers = await buildHeaders()
    if (!headers) {
      e.reply('请先执行 #b站登录')
      return true
    }

    const csrf = await this.getCsrf()
    if (!csrf) {
      e.reply('获取认证信息失败')
      return true
    }

    try {
      const url = `${API_ENDPOINTS.VIDEO_LIKE}?csrf=${csrf}&bvid=${videoData.bvid}&like=1`
      headers.Accept = 'application/x-www-form-urlencoded'
      const res = await fetch(url, { method: 'POST', headers })
      const json = await res.json()

      if (json.code === 0) {
        e.reply('[Bilibili] 点赞成功！')
      } else if (json.code === 65006) {
        e.reply('[Bilibili] 已经点过赞了')
      } else {
        e.reply(`[Bilibili] 点赞失败: ${json.message}`)
      }
    } catch (error) {
      e.reply(`[Bilibili] 点赞异常: ${error.message}`)
    }

    return true
  }

  /**
   * 取消点赞
   */
  async unlikeVideo(e) {
    if (!this.checkEnabled()) return false

    const videoData = await this.getVideoFromReply(e)
    if (!videoData?.bvid) return false

    const headers = await buildHeaders()
    if (!headers) {
      e.reply('请先执行 #b站登录')
      return true
    }

    const csrf = await this.getCsrf()
    if (!csrf) return true

    try {
      const url = `${API_ENDPOINTS.VIDEO_LIKE}?csrf=${csrf}&bvid=${videoData.bvid}&like=2`
      headers.Accept = 'application/x-www-form-urlencoded'
      const res = await fetch(url, { method: 'POST', headers })
      const json = await res.json()

      if (json.code === 0) {
        e.reply('[Bilibili] 取消点赞成功')
      } else if (json.code === 65004) {
        e.reply('[Bilibili] 还没点过赞呢')
      } else {
        e.reply(`[Bilibili] 取消点赞失败: ${json.message}`)
      }
    } catch (error) {
      e.reply(`[Bilibili] 取消点赞异常: ${error.message}`)
    }

    return true
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

    const headers = await buildHeaders()
    if (!headers) {
      e.reply('请先执行 #b站登录')
      return true
    }

    const csrf = await this.getCsrf()
    if (!csrf) return true

    try {
      const url = `${API_ENDPOINTS.VIDEO_COIN}?bvid=${videoData.bvid}&multiply=${coinNum}&select_like=1&csrf=${csrf}`
      headers.Accept = 'application/x-www-form-urlencoded'
      const res = await fetch(url, { method: 'POST', headers })
      const json = await res.json()

      if (json.code === 0) {
        e.reply(`[Bilibili] 投币 ${coinNum} 个成功！`)
      } else if (json.code === -104) {
        e.reply('[Bilibili] 硬币不够了')
      } else if (json.code === 34005) {
        e.reply('[Bilibili] 已经投过币了')
      } else {
        e.reply(`[Bilibili] 投币失败: ${json.message}`)
      }
    } catch (error) {
      e.reply(`[Bilibili] 投币异常: ${error.message}`)
    }

    return true
  }

  /**
   * 收藏
   */
  async favVideo(e) {
    if (!this.checkEnabled() || !e.isMaster) return false

    const videoData = await this.getVideoFromReply(e)
    if (!videoData?.bvid) return false

    const headers = await buildHeaders()
    if (!headers) {
      e.reply('请先执行 #b站登录')
      return true
    }

    const csrf = await this.getCsrf()
    if (!csrf) return true

    try {
      // 获取aid
      const videoInfo = await api.getVideoInfo(videoData.bvid)
      if (!videoInfo) {
        e.reply('获取视频信息失败')
        return true
      }

      // 获取收藏夹
      const mediaId = await this.getDefaultFavFolder()
      if (!mediaId) {
        e.reply('获取收藏夹失败')
        return true
      }

      const url = `${API_ENDPOINTS.FAV_DEAL}?rid=${videoInfo.aid}&type=2&add_media_ids=${mediaId}&csrf=${csrf}`
      headers.Accept = 'application/x-www-form-urlencoded'
      const res = await fetch(url, { method: 'POST', headers })
      const json = await res.json()

      if (json.code === 0) {
        e.reply('[Bilibili] 收藏成功！')
      } else {
        e.reply(`[Bilibili] 收藏失败: ${json.message}`)
      }
    } catch (error) {
      e.reply(`[Bilibili] 收藏异常: ${error.message}`)
    }

    return true
  }

  /**
   * 取消收藏
   */
  async unfavVideo(e) {
    if (!this.checkEnabled() || !e.isMaster) return false

    const videoData = await this.getVideoFromReply(e)
    if (!videoData?.bvid) return false

    const headers = await buildHeaders()
    if (!headers) return true

    const csrf = await this.getCsrf()
    if (!csrf) return true

    try {
      const videoInfo = await api.getVideoInfo(videoData.bvid)
      if (!videoInfo) return true

      const mediaId = await this.getDefaultFavFolder()
      if (!mediaId) return true

      const url = `${API_ENDPOINTS.FAV_DEAL}?rid=${videoInfo.aid}&type=2&del_media_ids=${mediaId}&csrf=${csrf}`
      headers.Accept = 'application/x-www-form-urlencoded'
      const res = await fetch(url, { method: 'POST', headers })
      const json = await res.json()

      if (json.code === 0) {
        e.reply('[Bilibili] 取消收藏成功')
      } else {
        e.reply(`[Bilibili] 取消收藏失败: ${json.message}`)
      }
    } catch (error) {
      e.reply(`[Bilibili] 取消收藏异常: ${error.message}`)
    }

    return true
  }

  /**
   * 三连
   */
  async tripleVideo(e) {
    if (!this.checkEnabled() || !e.isMaster) return false

    const videoData = await this.getVideoFromReply(e)
    if (!videoData?.bvid) return false

    const headers = await buildHeaders()
    if (!headers) {
      e.reply('请先执行 #b站登录')
      return true
    }

    const csrf = await this.getCsrf()
    if (!csrf) return true

    try {
      const videoInfo = await api.getVideoInfo(videoData.bvid)
      if (!videoInfo) return true

      const url = `${API_ENDPOINTS.VIDEO_TRIPLE}?aid=${videoInfo.aid}&csrf=${csrf}`
      headers.Accept = 'application/x-www-form-urlencoded'
      const res = await fetch(url, { method: 'POST', headers })
      const json = await res.json()

      if (json.code === 0) {
        e.reply('[Bilibili] 三连成功！')
      } else {
        e.reply(`[Bilibili] 三连失败: ${json.message}`)
      }
    } catch (error) {
      e.reply(`[Bilibili] 三连异常: ${error.message}`)
    }

    return true
  }

  /**
   * 关注UP主
   */
  async followUp(e) {
    if (!this.checkEnabled() || !e.isMaster) return false

    const videoData = await this.getVideoFromReply(e)
    const mid = videoData?.upMid

    if (!mid) return false

    const headers = await buildHeaders()
    if (!headers) {
      e.reply('请先执行 #b站登录')
      return true
    }

    const csrf = await this.getCsrf()
    if (!csrf) return true

    try {
      const url = `${API_ENDPOINTS.USER_RELATION}?fid=${mid}&act=1&re_src=14&csrf=${csrf}`
      headers.Accept = 'application/x-www-form-urlencoded'
      const res = await fetch(url, { method: 'POST', headers })
      const json = await res.json()

      if (json.code === 0) {
        e.reply('[Bilibili] 关注成功！')
      } else if (json.code === 22014) {
        e.reply('[Bilibili] 已经关注过了')
      } else {
        e.reply(`[Bilibili] 关注失败: ${json.message}`)
      }
    } catch (error) {
      e.reply(`[Bilibili] 关注异常: ${error.message}`)
    }

    return true
  }

  /**
   * 取消关注
   */
  async unfollowUp(e) {
    if (!this.checkEnabled() || !e.isMaster) return false

    const videoData = await this.getVideoFromReply(e)
    const mid = videoData?.upMid

    if (!mid) return false

    const headers = await buildHeaders()
    if (!headers) return true

    const csrf = await this.getCsrf()
    if (!csrf) return true

    try {
      const url = `${API_ENDPOINTS.USER_RELATION}?fid=${mid}&act=2&re_src=14&csrf=${csrf}`
      headers.Accept = 'application/x-www-form-urlencoded'
      const res = await fetch(url, { method: 'POST', headers })
      const json = await res.json()

      if (json.code === 0) {
        e.reply('[Bilibili] 取消关注成功')
      } else {
        e.reply(`[Bilibili] 取消关注失败: ${json.message}`)
      }
    } catch (error) {
      e.reply(`[Bilibili] 取消关注异常: ${error.message}`)
    }

    return true
  }

  /**
   * 获取默认收藏夹ID
   */
  async getDefaultFavFolder() {
    const config = setting.getConfig()
    const folderIndex = config.interact?.defaultFavFolder || 1

    const headers = await buildHeaders()
    if (!headers) return null

    try {
      const myInfo = await api.getMyInfo()
      if (!myInfo) return null

      const url = `${API_ENDPOINTS.FAV_LIST}?up_mid=${myInfo.mid}`
      const res = await fetch(url, { headers })
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

    const videoData = await this.getVideoFromReply(e)
    const mid = videoData?.upMid

    if (!mid) return false

    const headers = await buildHeaders()
    if (!headers) {
      e.reply('请先执行 #b站登录')
      return true
    }

    const csrf = await this.getCsrf()
    if (!csrf) return true

    try {
      const url = `${API_ENDPOINTS.USER_RELATION}?fid=${mid}&act=5&re_src=14&csrf=${csrf}`
      headers.Accept = 'application/x-www-form-urlencoded'
      const res = await fetch(url, { method: 'POST', headers })
      const json = await res.json()

      if (json.code === 0) {
        e.reply('[Bilibili] 拉黑成功！')
      } else if (json.code === 22120) {
        e.reply('[Bilibili] 这家伙已经在黑名单里了')
      } else {
        e.reply(`[Bilibili] 拉黑失败: ${json.message}`)
      }
    } catch (error) {
      e.reply(`[Bilibili] 拉黑异常: ${error.message}`)
    }

    return true
  }

  /**
   * 取消拉黑
   */
  async unblockUp(e) {
    if (!this.checkEnabled() || !e.isMaster) return false

    const videoData = await this.getVideoFromReply(e)
    const mid = videoData?.upMid

    if (!mid) return false

    const headers = await buildHeaders()
    if (!headers) return true

    const csrf = await this.getCsrf()
    if (!csrf) return true

    try {
      const url = `${API_ENDPOINTS.USER_RELATION}?fid=${mid}&act=6&re_src=14&csrf=${csrf}`
      headers.Accept = 'application/x-www-form-urlencoded'
      const res = await fetch(url, { method: 'POST', headers })
      const json = await res.json()

      if (json.code === 0) {
        e.reply('[Bilibili] 取消拉黑成功')
      } else {
        e.reply(`[Bilibili] 取消拉黑失败: ${json.message}`)
      }
    } catch (error) {
      e.reply(`[Bilibili] 取消拉黑异常: ${error.message}`)
    }

    return true
  }

  /**
   * 发送评论
   */
  async sendComment(e) {
    if (!this.checkEnabled() || !e.isMaster) return false

    const videoData = await this.getVideoFromReply(e)
    if (!videoData) return false

    const headers = await buildHeaders()
    if (!headers) {
      e.reply('请先执行 #b站登录')
      return true
    }

    const csrf = await this.getCsrf()
    if (!csrf) return true

    // 提取评论内容
    const message = e.msg.replace(/^#?评论/, '').trim()
    if (!message) {
      e.reply('请输入评论内容')
      return true
    }

    // 获取评论区参数
    const oid = videoData.bvid || videoData.commentId
    const type = videoData.commentType || 1

    try {
      const url = `${API_ENDPOINTS.REPLY_ADD}?type=${type}&oid=${oid}&message=${encodeURIComponent(message)}&csrf=${csrf}`
      headers.Accept = 'application/x-www-form-urlencoded'
      const res = await fetch(url, { method: 'POST', headers })
      const json = await res.json()

      switch (json.code) {
        case 0:
          e.reply(`[Bilibili] 评论「${message}」发送成功！`)
          break
        case 12025:
          e.reply('[Bilibili] 评论字数太多了')
          break
        case 12002:
        case 12052:
        case 12003:
          e.reply('[Bilibili] 评论区已关闭')
          break
        case -101:
        case -111:
        case -403:
          e.reply('[Bilibili] Cookie可能已失效，请重新登录')
          break
        default:
          e.reply(`[Bilibili] 评论失败: ${json.message}`)
      }
    } catch (error) {
      e.reply(`[Bilibili] 评论异常: ${error.message}`)
    }

    return true
  }
}
