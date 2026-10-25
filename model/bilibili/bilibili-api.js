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

// 统一请求超时：B站接口偶发无响应，没有超时会一直占着消息处理流程
const FETCH_TIMEOUT = 15000
const WBI_CACHE_TTL = 2 * 60 * 60 * 1000

// 风控码对照：这些不是普通失败，需要降速或换 Cookie 才有用
const RISK_CODES = {
  '-352': '触发B站风控，请稍后再试，或重新执行 #b站登录 换一份 Cookie',
  '-412': '请求被B站限流，请稍后再试',
  '-799': '请求过于频繁，请稍后再试'
}

/**
 * 把接口返回码翻译成给用户看的话
 */
function explainBiliCode(code, message = '') {
  const risk = RISK_CODES[String(code)]
  if (risk) return risk
  return message || `请求失败（code=${code}）`
}

// 命中风控后的一段时间内自动降低请求频率（只做温和延迟，不把用户消息拖死）
const VIDEO_INFO_TTL = 30 * 1000
const videoInfoCache = new Map()
const videoInfoInflight = new Map()

const RISK_BACKOFF_MS = { '-352': 60 * 1000, '-412': 5 * 60 * 1000, '-799': 30 * 1000 }
const RISK_MAX_DELAY = 1500
let riskUntil = 0

function noteRisk(code) {
  const ms = RISK_BACKOFF_MS[String(code)]
  if (!ms) return
  riskUntil = Math.max(riskUntil, Date.now() + ms)
  logger.warn(`[Bilibili] 命中风控 ${code}，${Math.round(ms / 1000)} 秒内自动降速请求`)
}

async function waitRisk() {
  const remain = riskUntil - Date.now()
  if (remain <= 0) return
  await new Promise(resolve => setTimeout(resolve, Math.min(remain, RISK_MAX_DELAY)))
}

/**
 * 解析接口返回并顺带记录风控码
 */
async function readBiliJson(res) {
  const json = await res.json()
  noteRisk(json?.code)
  return json
}

/**
 * 带超时的请求封装
 */
async function fetchBili(url, options = {}, timeoutMs = FETCH_TIMEOUT) {
  await waitRisk()

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, { ...options, signal: controller.signal })
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new Error(`请求超时（${timeoutMs}ms）: ${String(url).slice(0, 80)}`)
    }
    throw error
  } finally {
    clearTimeout(timer)
  }
}

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
let wbiKeyCache = { keys: null, expire: 0 }

async function getWbiKeys(headers) {
  // 密钥约两小时才轮换，缓存住可以省掉每个接口请求前的一次网络往返
  if (wbiKeyCache.keys && Date.now() < wbiKeyCache.expire) return wbiKeyCache.keys

  try {
    const res = await fetchBili(API_ENDPOINTS.USER_NAV, { headers })
    const json = await readBiliJson(res)

    if (json.code !== 0) {
      logger.error(`[Bilibili] 获取WBI密钥失败: ${explainBiliCode(json.code, json.message)}`)
      return null
    }

    const { img_url, sub_url } = json.data.wbi_img
    const keys = {
      imgKey: img_url.slice(img_url.lastIndexOf('/') + 1, img_url.lastIndexOf('.')),
      subKey: sub_url.slice(sub_url.lastIndexOf('/') + 1, sub_url.lastIndexOf('.'))
    }
    wbiKeyCache = { keys, expire: Date.now() + WBI_CACHE_TTL }
    return keys
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
    const response = await fetchBili(`${API_ENDPOINTS.GEN_WEB_TICKET}?${params.toString()}`, {
      method: 'POST',
      headers: DEFAULT_HEADERS
    })

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`)
    }

    const data = await response.json()
    if (data.code === 0 && data.data?.ticket) {
      await redis.set(REDIS_PREFIX.BILI_TICKET, data.data.ticket, { EX: 3600 })
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
    const res = await fetchBili(API_ENDPOINTS.FINGER_SPI, { headers })
    const json = await readBiliJson(res)

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
 * @param {boolean} silent 是否静默模式（不输出警告）
 */
async function buildCookie(silent = false) {
  let cookie = setting.getCookie()
  if (!cookie) {
    if (!silent) {
      logger.debug('[Bilibili] 未配置Cookie，使用匿名模式')
    }
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
 * @param {string|null} customCookie 自定义cookie
 * @param {boolean} requireLogin 是否必须登录，默认false
 */
async function buildHeaders(customCookie = null, requireLogin = false) {
  const cookie = customCookie || await buildCookie()

  // 如果需要登录但没有cookie，返回null
  if (requireLogin && !cookie) return null

  // 无cookie时返回默认headers（匿名模式）
  if (!cookie) {
    return { ...DEFAULT_HEADERS }
  }

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
   * 获取视频基础信息（无需登录）
   * 解析一条视频会连续问好几次，加 30 秒缓存并合并并发请求
   */
  async getVideoInfo(bvid) {
    const key = String(bvid)
    const hit = videoInfoCache.get(key)
    if (hit && Date.now() - hit.time < VIDEO_INFO_TTL) return hit.value

    if (videoInfoInflight.has(key)) return videoInfoInflight.get(key)

    const task = (async () => {
      const data = await this.fetchVideoInfo(bvid)
      if (data) {
        videoInfoCache.set(key, { value: data, time: Date.now() })
        // 简单上限，避免长期运行涨到无限大
        if (videoInfoCache.size > 200) videoInfoCache.delete(videoInfoCache.keys().next().value)
      }
      return data
    })()

    videoInfoInflight.set(key, task)
    try {
      return await task
    } finally {
      videoInfoInflight.delete(key)
    }
  }

  /**
   * 真正请求视频信息
   */
  async fetchVideoInfo(bvid) {
    try {
      // 兼容 av 号：av 链接解析出来的是 av 号，接口需要用 aid 查询
      const av = String(bvid).match(/^av(\d+)$/i)
      const url = av
        ? `${API_ENDPOINTS.VIDEO_INFO}?aid=${av[1]}`
        : `${API_ENDPOINTS.VIDEO_INFO}?bvid=${bvid}`
      const res = await fetchBili(url, { headers: DEFAULT_HEADERS })
      const json = await readBiliJson(res)

      if (json.code === 62012) {
        logger.warn('[Bilibili] 稿件仅UP主自己可见')
        return null
      }

      if (json.code !== 0) {
        logger.error(`[Bilibili] 获取视频信息失败: ${explainBiliCode(json.code, json.message)}`)
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
      const res = await fetchBili(url, { headers: DEFAULT_HEADERS })
      const json = await readBiliJson(res)

      if (json.code !== 0) {
        logger.error(`[Bilibili] 获取分P列表失败: ${explainBiliCode(json.code, json.message)}`)
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
    // DASH 地址必须登录才会给到 1080P 以上；匿名时直接返回 null，由调用方走 html5 路线
    const headers = await buildHeaders(null, true)
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
      const res = await fetchBili(url, { headers })
      const json = await readBiliJson(res)

      if (json.code !== 0) {
        logger.error(`[Bilibili] 获取播放地址失败: ${explainBiliCode(json.code, json.message)}`)
        return null
      }

      return json.data
    } catch (error) {
      logger.error(`[Bilibili] 获取播放地址异常: ${error.message}`)
      return null
    }
  }

  /**
   * 获取HTML5播放地址（无需登录，低画质）
   * @param {number} aid 视频aid
   * @param {number} cid 视频cid
   * @param {number} qn 画质（默认16=360P）
   */
  async getPlayUrlHtml5(aid, cid, qn = 16) {
    try {
      const url = `${API_ENDPOINTS.VIDEO_PLAYURL_HTML5}?avid=${aid}&cid=${cid}&qn=${qn}&type=mp4&platform=html5`
      const res = await fetchBili(url, { headers: DEFAULT_HEADERS })
      const json = await readBiliJson(res)

      if (json.code !== 0) {
        logger.error(`[Bilibili] 获取HTML5播放地址失败: ${explainBiliCode(json.code, json.message)}`)
        return null
      }

      return json.data
    } catch (error) {
      logger.error(`[Bilibili] 获取HTML5播放地址异常: ${error.message}`)
      return null
    }
  }

  /**
   * 获取在线观看人数（无需登录）
   */
  async getOnlineCount(bvid, cid) {
    try {
      const url = `${API_ENDPOINTS.VIDEO_ONLINE}?bvid=${bvid}&cid=${cid}`
      const res = await fetchBili(url, { headers: DEFAULT_HEADERS })
      const json = await readBiliJson(res)

      if (json.code !== 0) return 0
      return json.data?.total || 0
    } catch (error) {
      return 0
    }
  }

  /**
   * 获取用户卡片信息（无需登录）
   */
  async getUserCard(mid) {
    try {
      const url = `${API_ENDPOINTS.USER_CARD}?mid=${mid}`
      const res = await fetchBili(url, { headers: DEFAULT_HEADERS })
      const json = await readBiliJson(res)

      if (json.code !== 0) {
        logger.error(`[Bilibili] 获取用户信息失败: ${explainBiliCode(json.code, json.message)}`)
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
      const res = await fetchBili(API_ENDPOINTS.USER_NAV, { headers })
      const json = await readBiliJson(res)

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
      const res = await fetchBili(url, { headers })
      const json = await readBiliJson(res)

      if (json.code !== 0) {
        logger.error(`[Bilibili] 获取用户投稿失败: ${explainBiliCode(json.code, json.message)}`)
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
  async checkVideoStatus(bvid, aid) {
    const headers = await buildHeaders()
    if (!headers) return { like: false, coin: false, favoured: false }

    // 三个状态互不依赖，并发请求，少等两轮往返
    const probe = async (url, pick) => {
      try {
        const res = await fetchBili(url, { headers })
        const json = await readBiliJson(res)
        return json.code === 0 && pick(json)
      } catch (error) {
        logger.debug(`[Bilibili] 查询互动状态失败: ${error.message}`)
        return false
      }
    }

    const [like, coin, favoured] = await Promise.all([
      probe(`${API_ENDPOINTS.VIDEO_HAS_LIKE}?bvid=${bvid}`, json => json.data === 1),
      probe(`${API_ENDPOINTS.VIDEO_COINS}?bvid=${bvid}`, json => json.data?.multiply > 0),
      // 收藏接口只认 aid，传 BV 号会永远返回未收藏
      aid ? probe(`${API_ENDPOINTS.VIDEO_FAVOURED}?aid=${aid}`, json => Boolean(json.data?.favoured)) : false
    ])

    return { like, coin, favoured }
  }

  /**
   * 解析短链接
   */
  async resolveShortLink(shortUrl) {
    try {
      const res = await fetchBili(shortUrl, { redirect: 'manual' })
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
  getWbiKeys,
  fetchBili,
  explainBiliCode
}
