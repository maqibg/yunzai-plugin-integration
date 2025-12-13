/**
 * Bilibili 核心API模块
 * 包含WBI签名、BiliTicket、请求封装等
 */
import fetch from 'node-fetch'
import crypto from 'node:crypto'
import md5 from 'md5'
import {
  MIXIN_KEY_ENC_TAB,
  BILI_TICKET_HMAC_KEY,
  API_ENDPOINTS,
  DEFAULT_HEADERS,
  REDIS_PREFIX
} from './bilibili-const.js'
import setting from './bilibili-setting.js'

/**
 * 获取混淆密钥
 */
function getMixinKey(orig) {
  return MIXIN_KEY_ENC_TAB.map(n => orig[n]).join('').slice(0, 32)
}

/**
 * WBI参数签名
 * @param {object} params 请求参数
 * @param {string} imgKey img_key
 * @param {string} subKey sub_key
 */
function encWbi(params, imgKey, subKey) {
  const mixinKey = getMixinKey(imgKey + subKey)
  const currTime = Math.round(Date.now() / 1000)
  const chrFilter = /[!'()*]/g

  Object.assign(params, { wts: currTime })

  const query = Object.keys(params)
    .sort()
    .map(key => {
      const value = params[key].toString().replace(chrFilter, '')
      return `${encodeURIComponent(key)}=${encodeURIComponent(value)}`
    })
    .join('&')

  const wbiSign = md5(query + mixinKey)
  return query + '&w_rid=' + wbiSign
}

/**
 * 获取WBI密钥
 */
async function getWbiKeys(headers) {
  try {
    const res = await fetch(API_ENDPOINTS.USER_NAV, { headers })
    const json = await res.json()

    if (json.code !== 0) {
      logger.error(`[Bilibili] 获取WBI密钥失败: ${json.message}`)
      return null
    }

    const { img_url, sub_url } = json.data.wbi_img
    return {
      imgKey: img_url.slice(img_url.lastIndexOf('/') + 1, img_url.lastIndexOf('.')),
      subKey: sub_url.slice(sub_url.lastIndexOf('/') + 1, sub_url.lastIndexOf('.'))
    }
  } catch (error) {
    logger.error(`[Bilibili] 获取WBI密钥异常: ${error.message}`)
    return null
  }
}

/**
 * WBI签名请求
 * @param {object} params 请求参数
 * @param {object} headers 请求头
 */
async function wbiSign(params, headers) {
  const keys = await getWbiKeys(headers)
  if (!keys) return null
  return encWbi(params, keys.imgKey, keys.subKey)
}

/**
 * HMAC-SHA256签名
 */
function hmacSha256(key, message) {
  const hmac = crypto.createHmac('sha256', key)
  hmac.update(message)
  return hmac.digest('hex')
}

/**
 * 生成BiliTicket
 */
async function getBiliTicket(csrf) {
  const ts = Math.floor(Date.now() / 1000)
  const hexSign = hmacSha256(BILI_TICKET_HMAC_KEY, `ts${ts}`)

  const params = new URLSearchParams({
    key_id: 'ec02',
    hexsign: hexSign,
    'context[ts]': ts,
    csrf: csrf || ''
  })

  try {
    const response = await fetch(`${API_ENDPOINTS.GEN_WEB_TICKET}?${params.toString()}`, {
      method: 'POST',
      headers: DEFAULT_HEADERS
    })

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`)
    }

    const data = await response.json()
    if (data.code === 0 && data.data?.ticket) {
      await redis.set(REDIS_PREFIX.BILI_TICKET, data.data.ticket, { EX: 259200 })
      logger.mark('[Bilibili] 生成BiliTicket成功')
      return data.data.ticket
    }
    return null
  } catch (error) {
    logger.error(`[Bilibili] 生成BiliTicket失败: ${error.message}`)
    return null
  }
}

/**
 * 获取buvid
 */
async function getBuvid(cookie) {
  const headers = { ...DEFAULT_HEADERS, Cookie: cookie }
  try {
    const res = await fetch(API_ENDPOINTS.FINGER_SPI, { headers })
    const json = await res.json()

    if (json.code === 0) {
      return {
        buvid3: json.data.b_3,
        buvid4: json.data.b_4
      }
    }
    return null
  } catch (error) {
    logger.error(`[Bilibili] 获取buvid失败: ${error.message}`)
    return null
  }
}

/**
 * 构建完整Cookie
 */
async function buildCookie() {
  let cookie = setting.getCookie()
  if (!cookie) {
    logger.warn('[Bilibili] 未配置Cookie，请先执行 #b站登录')
    return null
  }

  // 添加BiliTicket
  let ticket = await redis.get(REDIS_PREFIX.BILI_TICKET)
  if (!ticket) {
    const csrfMatch = cookie.match(/bili_jct=([\w]+)/)
    const csrf = csrfMatch ? csrfMatch[1] : ''
    ticket = await getBiliTicket(csrf)
  }
  if (ticket) {
    cookie = `bili_ticket=${ticket};${cookie}`
  }

  return cookie
}

/**
 * 构建请求头
 */
async function buildHeaders(customCookie = null) {
  const cookie = customCookie || await buildCookie()
  if (!cookie) return null

  return {
    ...DEFAULT_HEADERS,
    Cookie: cookie
  }
}

/**
 * Bilibili API 类
 */
class BilibiliApi {
  /**
   * 获取视频基础信息
   */
  async getVideoInfo(bvid) {
    const headers = await buildHeaders()
    if (!headers) return null

    try {
      const url = `${API_ENDPOINTS.VIDEO_INFO}?bvid=${bvid}`
      const res = await fetch(url, { headers })
      const json = await res.json()

      if (json.code === 62012) {
        logger.warn('[Bilibili] 稿件仅UP主自己可见')
        return null
      }

      if (json.code !== 0) {
        logger.error(`[Bilibili] 获取视频信息失败: ${json.message}`)
        return null
      }

      return json.data
    } catch (error) {
      logger.error(`[Bilibili] 获取视频信息异常: ${error.message}`)
      return null
    }
  }

  /**
   * 获取视频分P列表
   */
  async getPageList(bvid) {
    try {
      const url = `${API_ENDPOINTS.VIDEO_PAGELIST}?bvid=${bvid}`
      const res = await fetch(url, { headers: DEFAULT_HEADERS })
      const json = await res.json()

      if (json.code !== 0) {
        logger.error(`[Bilibili] 获取分P列表失败: ${json.message}`)
        return null
      }

      return json.data
    } catch (error) {
      logger.error(`[Bilibili] 获取分P列表异常: ${error.message}`)
      return null
    }
  }

  /**
   * 获取视频播放地址
   * @param {string} bvid BV号
   * @param {number} cid 视频cid
   * @param {number} qn 画质
   */
  async getPlayUrl(bvid, cid, qn = 64) {
    const headers = await buildHeaders()
    if (!headers) return null

    const params = {
      bvid,
      cid,
      fnval: 4048,
      fourk: 1,
      fnver: 0,
      qn
    }

    try {
      const query = await wbiSign(params, headers)
      if (!query) return null

      const url = `${API_ENDPOINTS.VIDEO_PLAYURL}?${query}`
      const res = await fetch(url, { headers })
      const json = await res.json()

      if (json.code !== 0) {
        logger.error(`[Bilibili] 获取播放地址失败: ${json.message}`)
        return null
      }

      return json.data
    } catch (error) {
      logger.error(`[Bilibili] 获取播放地址异常: ${error.message}`)
      return null
    }
  }

  /**
   * 获取在线观看人数
   */
  async getOnlineCount(bvid, cid) {
    const headers = await buildHeaders()
    if (!headers) return null

    try {
      const url = `${API_ENDPOINTS.VIDEO_ONLINE}?bvid=${bvid}&cid=${cid}`
      const res = await fetch(url, { headers })
      const json = await res.json()

      if (json.code !== 0) return 0
      return json.data?.total || 0
    } catch (error) {
      return 0
    }
  }

  /**
   * 获取用户卡片信息
   */
  async getUserCard(mid) {
    const headers = await buildHeaders()
    if (!headers) return null

    try {
      const url = `${API_ENDPOINTS.USER_CARD}?mid=${mid}`
      const res = await fetch(url, { headers })
      const json = await res.json()

      if (json.code !== 0) {
        logger.error(`[Bilibili] 获取用户信息失败: ${json.message}`)
        return null
      }

      const card = json.data.card
      card.is_followed = json.data.following
      return card
    } catch (error) {
      logger.error(`[Bilibili] 获取用户信息异常: ${error.message}`)
      return null
    }
  }

  /**
   * 获取当前登录用户信息
   */
  async getMyInfo(cookie = null) {
    const headers = await buildHeaders(cookie)
    if (!headers) return null

    try {
      const res = await fetch(API_ENDPOINTS.USER_NAV, { headers })
      const json = await res.json()

      if (json.code !== 0) return null
      return json.data
    } catch (error) {
      return null
    }
  }

  /**
   * 获取用户最新投稿
   */
  async getUserLatestVideo(mid) {
    const headers = await buildHeaders()
    if (!headers) return null

    const params = { mid }

    try {
      const query = await wbiSign(params, headers)
      if (!query) return null

      const url = `${API_ENDPOINTS.USER_SPACE_ARC}?${query}`
      const res = await fetch(url, { headers })
      const json = await res.json()

      if (json.code !== 0) {
        logger.error(`[Bilibili] 获取用户投稿失败: ${json.message}`)
        return null
      }

      const video = json.data?.list?.vlist?.[0]
      if (!video) return null

      return {
        bvid: video.bvid,
        title: video.title,
        pic: video.pic,
        created: video.created
      }
    } catch (error) {
      logger.error(`[Bilibili] 获取用户投稿异常: ${error.message}`)
      return null
    }
  }

  /**
   * 检查视频是否点赞/投币/收藏
   */
  async checkVideoStatus(bvid) {
    const headers = await buildHeaders()
    if (!headers) return { like: false, coin: false, favoured: false }

    try {
      // 检查点赞
      const likeRes = await fetch(`${API_ENDPOINTS.VIDEO_HAS_LIKE}?bvid=${bvid}`, { headers })
      const likeJson = await likeRes.json()
      const like = likeJson.code === 0 && likeJson.data === 1

      // 检查投币
      const coinRes = await fetch(`${API_ENDPOINTS.VIDEO_COINS}?bvid=${bvid}`, { headers })
      const coinJson = await coinRes.json()
      const coin = coinJson.code === 0 && coinJson.data?.multiply > 0

      // 检查收藏
      const favRes = await fetch(`${API_ENDPOINTS.VIDEO_FAVOURED}?aid=${bvid}`, { headers })
      const favJson = await favRes.json()
      const favoured = favJson.code === 0 && favJson.data?.favoured

      return { like, coin, favoured }
    } catch (error) {
      return { like: false, coin: false, favoured: false }
    }
  }

  /**
   * 解析短链接
   */
  async resolveShortLink(shortUrl) {
    try {
      const res = await fetch(shortUrl, { redirect: 'manual' })
      const location = res.headers.get('location') || res.url

      // 匹配视频
      let match = location.match(/bilibili\.com\/video\/([\w]+)/)
      if (match) return { type: 'video', id: match[1] }

      // 匹配动态
      match = location.match(/bilibili\.com\/opus\/([\w]+)/) ||
        location.match(/t\.bilibili\.com\/([\w]+)/)
      if (match) return { type: 'dynamic', id: match[1] }

      return null
    } catch (error) {
      logger.error(`[Bilibili] 解析短链接失败: ${error.message}`)
      return null
    }
  }
}

// 导出单例和工具函数
export default new BilibiliApi()
export {
  buildHeaders,
  buildCookie,
  wbiSign,
  getBiliTicket,
  getBuvid,
  hmacSha256,
  encWbi,
  getWbiKeys
}
