/**
 * 抖音解析
 * 走 iesdouyin 移动分享页的 _ROUTER_DATA 自解析，不依赖第三方接口
 * 直播间分享单独识别，只取房间信息不下载流
 */
import { MOBILE_UA, PC_UA } from './parser-const.js'
import { fetchWithTimeout } from './parser-fetch.js'
import { extractVideoStats } from './parser-stats.js'

const DOUYIN_HEADERS = {
  'User-Agent': MOBILE_UA,
  Referer: 'https://www.douyin.com/',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
}

const LIVE_PATTERN = /live(?:\.douyin\.com|\/)|webcast\.amemv\.com\/douyin\/webcast\/reflow/i

// 分享页 SSR 要带反爬 cookie 才返回作品数据：ttwid 走字节公开接口拿真值，
// msToken 用假值即可。ttwid 有效期约 6 小时，缓存复用避免每条消息都注册一次
let tokenCache = { ttwid: '', msToken: '', expire: 0 }

/**
 * 生成假 msToken（126 位随机字符 + ==，分享页只做格式校验）
 */
function fakeMsToken() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  let token = ''
  for (let i = 0; i < 126; i++) token += chars[Math.floor(Math.random() * chars.length)]
  return token + '=='
}

/**
 * 获取分享页 cookie
 * @param {boolean} force 强制换新（拿到空数据时说明 ttwid 失效）
 */
async function getCookie(force = false) {
  if (!force && tokenCache.ttwid && tokenCache.expire > Date.now()) {
    return `ttwid=${tokenCache.ttwid}; msToken=${tokenCache.msToken}`
  }

  try {
    const res = await fetchWithTimeout('https://ttwid.bytedance.com/ttwid/union/register/', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': PC_UA,
        Referer: 'https://www.douyin.com/'
      },
      body: JSON.stringify({
        region: 'cn',
        aid: 1768,
        needFid: false,
        service: 'www.ixigua.com',
        migrate_info: { ticket: '', source: 'node' },
        cbUrlProtocol: 'https',
        union: true
      })
    })
    const matched = (res.headers.get('set-cookie') || '').match(/ttwid=([^;]+)/)
    if (matched) {
      tokenCache = {
        ttwid: decodeURIComponent(matched[1]),
        msToken: fakeMsToken(),
        expire: Date.now() + 6 * 3600 * 1000
      }
    }
  } catch (error) {
    logger.warn(`[解析] 获取抖音 ttwid 失败: ${error.message}`)
  }

  return tokenCache.ttwid ? `ttwid=${tokenCache.ttwid}; msToken=${tokenCache.msToken}` : ''
}

/**
 * 从 marker 后的第一个 JSON 对象里按括号配平截取，避免正则遇到嵌套对象提前截断
 */
function pickJsonObject(html, marker) {
  const pos = html.indexOf(marker)
  if (pos < 0) return ''

  const start = html.indexOf('{', pos)
  if (start < 0) return ''

  let depth = 0
  let inString = false
  let quote = ''
  let escaped = false

  for (let i = start; i < html.length; i++) {
    const char = html[i]
    if (inString) {
      if (escaped) escaped = false
      else if (char === '\\') escaped = true
      else if (char === quote) inString = false
      continue
    }
    if (char === '"' || char === "'") {
      inString = true
      quote = char
      continue
    }
    if (char === '{') depth++
    else if (char === '}') {
      depth--
      if (!depth) return html.slice(start, i + 1)
    }
  }
  return ''
}

/**
 * 从分享页 HTML 里取出所有可能含作品数据的 JSON 段
 */
function parsePageData(html) {
  const list = []

  const routerJson = pickJsonObject(html, '_ROUTER_DATA')
  if (routerJson) {
    try {
      list.push(JSON.parse(routerJson))
    } catch (error) {
      logger.debug(`[解析] 抖音 _ROUTER_DATA 解析失败: ${error.message}`)
    }
  }

  const render = html.match(/<script[^>]+id=["']RENDER_DATA["'][^>]*>([\s\S]*?)<\/script>/i)
  if (render?.[1]) {
    try {
      list.push(JSON.parse(decodeURIComponent(render[1])))
    } catch (error) {
      logger.debug(`[解析] 抖音 RENDER_DATA 解析失败: ${error.message}`)
    }
  }

  return list
}

/**
 * 递归找作品对象（不同页面结构埋在不同层级）
 */
function findItem(data, seen = new Set()) {
  if (!data || typeof data !== 'object' || seen.has(data)) return null
  seen.add(data)

  if (Array.isArray(data)) {
    for (const item of data) {
      const found = findItem(item, seen)
      if (found) return found
    }
    return null
  }

  if (data.aweme_detail?.video || data.aweme_detail?.images) return data.aweme_detail
  if (data.item_list?.[0]?.video || data.item_list?.[0]?.images) return data.item_list[0]
  if (data.videoInfoRes?.item_list?.[0]) return data.videoInfoRes.item_list[0]
  if ((data.aweme_id || data.group_id || data.desc) && (data.video || data.images)) return data

  for (const key of Object.keys(data)) {
    const found = findItem(data[key], seen)
    if (found) return found
  }
  return null
}

/**
 * 还原短链并从链接里取作品 ID
 */
async function resolveAwemeId(rawUrl) {
  let url = String(rawUrl || '').replace(/[，。！？、)）\]}]+$/g, '')

  if (/douyin\.com/i.test(url)) {
    try {
      const res = await fetchWithTimeout(url, { headers: { ...DOUYIN_HEADERS, Cookie: await getCookie() } })
      url = res.url || url
    } catch (error) {
      logger.debug(`[解析] 抖音短链跳转失败，按原链接取 ID: ${error.message}`)
    }
  }

  const matched = url.match(/(?:video|note)\/(\d{17,21})/)
    || url.match(/(\d{17,21})/)
    || String(rawUrl).match(/(\d{17,21})/)
  return matched ? matched[1] : null
}

/**
 * 取第一个可用地址（字段结构在不同接口里不一致）
 */
function firstUrl(target) {
  if (!target) return ''
  if (typeof target === 'string') return target
  if (Array.isArray(target)) return target.find(Boolean) || ''
  return target.url || target.url_list?.find(Boolean) || target.download_url_list?.find(Boolean) || target.uri || ''
}

/**
 * 请求作品数据：先分享页，取不到再试网页详情接口
 */
async function fetchAwemeItem(id) {
  const pages = [
    `https://www.iesdouyin.com/share/video/${id}/`,
    `https://www.douyin.com/video/${id}`
  ]

  for (let round = 0; round < 2; round++) {
    const cookie = await getCookie(round > 0)
    for (const page of pages) {
      try {
        const res = await fetchWithTimeout(page, { headers: { ...DOUYIN_HEADERS, Cookie: cookie } })
        const html = await res.text()
        for (const data of parsePageData(html)) {
          const item = findItem(data)
          if (item) return item
        }
      } catch (error) {
        logger.warn(`[解析] 抖音页面解析失败: ${error.message}`)
      }
    }
  }

  try {
    const api = `https://www.douyin.com/aweme/v1/web/aweme/detail/?aweme_id=${id}&aid=1128&version_name=23.5.0&device_platform=webapp&os_name=Windows&os_version=10`
    const res = await fetchWithTimeout(api, {
      headers: { ...DOUYIN_HEADERS, Accept: 'application/json,text/plain,*/*' }
    })
    return findItem(await res.json())
  } catch (error) {
    logger.warn(`[解析] 抖音详情接口失败: ${error.message}`)
  }

  return null
}

/**
 * 页面与详情接口都拿不到时的第三方兜底
 * 这条链路依赖外部服务，失败只记 debug，不影响主流程报错
 */
async function fetchExternal(rawUrl, awemeId) {
  const api = `https://api.xingzhige.com/API/douyin/?url=${encodeURIComponent(rawUrl)}`

  try {
    const res = await fetchWithTimeout(api, {
      headers: { Accept: 'application/json,text/plain,*/*' }
    }, 20000)
    const data = await res.json()
    const detail = data?.data
    const item = detail?.item
    if (data?.code !== 0 || !item) return null

    const videoUrl = item.url || item.video || item.play || ''
    const images = Array.isArray(item.images) ? item.images.filter(Boolean) : []

    return {
      platform: '抖音',
      type: images.length ? 'images' : 'video',
      title: item.title || '',
      author: detail.author?.name || '',
      desc: item.title || '',
      cover: item.cover || item.cover_gif || detail.author?.avatar || '',
      duration: Math.round(Number(item.duration || 0)),
      stats: extractVideoStats('douyin', item.statistics, item.stats, item, detail.statistics, detail.stats),
      pageUrl: awemeId ? `https://www.douyin.com/video/${awemeId}` : rawUrl,
      video: videoUrl
        ? { url: videoUrl, headers: { 'User-Agent': MOBILE_UA, Referer: 'https://www.douyin.com' }, alternatives: [] }
        : null,
      images
    }
  } catch (error) {
    logger.debug(`[解析] 抖音第三方兜底失败: ${error.message}`)
    return null
  }
}

/**
 * 解析直播间分享，只取房间信息
 */
async function parseLive(rawUrl) {
  let finalUrl = rawUrl
  let html = ''

  try {
    const res = await fetchWithTimeout(rawUrl, { headers: { ...DOUYIN_HEADERS, Cookie: await getCookie() } })
    finalUrl = res.url || rawUrl
    html = await res.text()
  } catch (error) {
    logger.warn(`[解析] 抖音直播间页面请求失败: ${error.message}`)
  }

  const roomId = (finalUrl.match(/(?:live\.douyin\.com\/|live\/|reflow\/)(\d+)/i)
    || rawUrl.match(/(?:live\.douyin\.com\/|live\/|reflow\/)(\d+)/i))?.[1] || ''

  const title = html.match(/<title[^>]*>([^<]+)/i)?.[1]?.trim() || '抖音直播'
  const cover = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)/i)?.[1] || ''

  return {
    platform: '抖音',
    type: 'live',
    title,
    author: '',
    desc: '',
    cover,
    duration: 0,
    pageUrl: roomId ? `https://live.douyin.com/${roomId}` : finalUrl,
    video: null,
    images: []
  }
}

/**
 * 解析抖音作品
 * @param {string} rawUrl 分享链接
 * @returns {object} 统一解析结果
 */
export async function parseDouyin(rawUrl) {
  if (LIVE_PATTERN.test(rawUrl)) return parseLive(rawUrl)

  // 短链可能跳到直播间，先探一次跳转目标再决定走哪条分支
  if (/v\.douyin\.com/i.test(rawUrl)) {
    try {
      const probe = await fetchWithTimeout(rawUrl, { headers: DOUYIN_HEADERS })
      if (LIVE_PATTERN.test(probe.url || '')) return parseLive(rawUrl)
    } catch (error) {
      logger.warn(`[解析] 抖音短链类型探测失败: ${error.message}`)
    }
  }

  const awemeId = await resolveAwemeId(rawUrl)
  // silent：链接不是作品页（主页/合集页之类），不该在群里报错
  if (!awemeId) throw Object.assign(new Error('未取到抖音作品 ID'), { silent: true })

  const item = await fetchAwemeItem(awemeId)
  if (!item) {
    logger.warn(`[解析] 抖音页面与详情接口都没拿到作品，尝试第三方兜底: ${awemeId}`)
    const external = await fetchExternal(rawUrl, awemeId)
    if (external?.video || external?.images?.length) return external
    throw new Error('抖音作品获取失败（可能已删除、私密，或页面已改版）')
  }

  const title = item.desc || item.caption || ''
  const author = item.author?.nickname || item.author_user_info?.nickname || ''
  const cover = firstUrl(item.video?.cover) || firstUrl(item.video?.origin_cover) || firstUrl(item.cover)
  const pageUrl = `https://www.douyin.com/video/${awemeId}`

  // 图集：挑无水印的静态图
  if (Array.isArray(item.images) && item.images.length) {
    const images = []
    for (const image of item.images) {
      const url = [image?.url_list, image?.display_image, image, image?.video?.cover, image?.video?.origin_cover]
        .map(firstUrl)
        .find(item => /^https?:\/\//i.test(item) && !/watermark|-water:/i.test(item.split('?')[0]))
      if (url) images.push(url)
    }
    if (!images.length) throw new Error('未取到抖音图集的静态图片')
    return {
      platform: '抖音',
      type: 'images',
      title,
      author,
      desc: title,
      cover: cover || images[0],
      duration: 0,
      stats: extractVideoStats('douyin', item.statistics, item.stats, item),
      pageUrl,
      video: null,
      images
    }
  }

  const duration = Math.round((item.video?.duration || item.duration || 0) / 1000)
  // play_addr 是去水印直链的来源；playwm 换成 play 才是无水印版本
  let videoUrl = firstUrl(item.video?.play_addr)
    || firstUrl(item.video?.download_addr)
    || firstUrl(item.video?.bit_rate?.[0]?.play_addr)
  if (!videoUrl) throw new Error('未取到抖音视频直链')
  videoUrl = videoUrl.replace('playwm', 'play')

  return {
    platform: '抖音',
    type: 'video',
    title,
    author,
    desc: title,
    cover,
    duration,
    stats: extractVideoStats('douyin', item.statistics, item.stats, item),
    pageUrl,
    video: {
      url: videoUrl,
      headers: { 'User-Agent': MOBILE_UA, Referer: 'https://www.douyin.com' },
      alternatives: []
    },
    images: []
  }
}
