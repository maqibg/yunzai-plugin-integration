/**
 * 快手解析
 * 网页作品页没有 INIT_STATE，统一走移动分享页；短链先跟随跳转再换成分享页地址
 */
import { MOBILE_UA } from './parser-const.js'
import { fetchWithTimeout } from './parser-fetch.js'
import { extractVideoStats } from './parser-stats.js'

const HEADERS = { 'User-Agent': MOBILE_UA, Referer: 'https://v.kuaishou.com/' }

/**
 * 把站内作品链接换成移动分享页地址（分享页才带 INIT_STATE）
 */
function toShareUrl(rawUrl) {
  try {
    const url = new URL(rawUrl)
    if (/(^|\.)kuaishou\.com$/i.test(url.hostname)) {
      const id = url.pathname.match(/^\/short-video\/([\w-]+)/)?.[1]
        || url.pathname.match(/^\/photo\/[^/]+\/([\w-]+)/)?.[1]
      if (id) return `https://v.m.chenzhongtech.com/fw/photo/${id}`
    }
    return url.href.replace('/fw/long-video/', '/fw/photo/')
  } catch {
    return rawUrl
  }
}

/**
 * 请求分享页，非 2xx 直接抛错，避免把错误页当数据解析
 */
async function fetchPage(url) {
  const res = await fetchWithTimeout(url, { headers: HEADERS })
  if (!res.ok) {
    try { await res.body?.cancel() } catch { }
    throw new Error(`快手分享页请求失败 HTTP ${res.status}`)
  }
  return res
}

/**
 * 解析快手作品
 * @param {string} rawUrl 分享链接
 */
export async function parseKuaishou(rawUrl) {
  let res = await fetchPage(toShareUrl(rawUrl))
  const pageUrl = res.url || rawUrl
  const shareUrl = toShareUrl(pageUrl)

  if (shareUrl !== pageUrl) {
    try { await res.body?.cancel() } catch { }
    res = await fetchPage(shareUrl)
  }

  const html = await res.text()

  // 直播分享使用独立播放器，只回房间信息
  if (/\/fw\/live\//i.test(pageUrl)) {
    const title = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)/i)?.[1]
      || html.match(/<title[^>]*>([^<]+)/i)?.[1] || '快手直播'
    const cover = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)/i)?.[1] || ''
    return {
      platform: '快手',
      type: 'live',
      title: title.trim(),
      author: '',
      desc: '',
      cover,
      duration: 0,
      pageUrl,
      video: null,
      images: []
    }
  }

  const matched = html.match(/window\.INIT_STATE\s*=\s*(.*?)<\/script>/s)
  if (!matched) throw new Error('快手页面结构变化，解析失败')

  let data
  try {
    data = JSON.parse(matched[1].trim().replace(/;\s*$/, ''))
  } catch {
    throw new Error('快手页面数据解析失败')
  }

  // INIT_STATE 的缓存键会变化，只认含 photo 的那一项；
  // counts 里是作者的获赞总数，不能当作品点赞用
  const entries = Object.values(data).filter(value => value && typeof value === 'object')
  const photo = entries.find(value => value.photo)?.photo
  if (!photo) throw new Error('快手作品获取失败（可能已删除、需要登录，或页面已改版）')

  const base = {
    platform: '快手',
    type: 'video',
    title: photo.caption || '',
    author: photo.userName || '',
    desc: photo.caption || '',
    cover: photo.coverUrls?.[0]?.url || '',
    duration: Math.round((photo.duration || 0) / 1000),
    stats: extractVideoStats('kuaishou', photo, photo.statistics, photo.stats),
    pageUrl,
    video: null,
    images: []
  }

  const atlas = photo.ext_params?.atlas
  if (atlas?.cdnList?.length && atlas?.list?.length) {
    const host = atlas.cdnList[0]?.cdn || atlas.cdnList[0]
    const images = atlas.list.map(route => `https://${host}/${route}`).filter(Boolean)
    if (images.length) {
      return { ...base, type: 'images', duration: 0, images, cover: base.cover || images[0] }
    }
  }

  const videoUrl = photo.mainMvUrls?.[0]?.url || ''
  if (!videoUrl) throw new Error('未取到快手视频直链')

  return {
    ...base,
    video: { url: videoUrl, headers: HEADERS, alternatives: [] }
  }
}
