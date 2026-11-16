/**
 * 小红书解析
 * 笔记页 __INITIAL_STATE__ 自解析；公开笔记免 cookie，登录态内容可在配置里填 cookie
 */
import { MOBILE_UA } from './parser-const.js'
import { fetchWithTimeout } from './parser-fetch.js'

/**
 * 从图片对象里挑可用地址（PC 结构用 urlDefault，移动端用 url / infoList）
 */
function pickImageUrl(image) {
  return image?.urlDefault
    || image?.url
    || image?.infoList?.[image.infoList.length - 1]?.url
    || image?.infoList?.[0]?.url
    || ''
}

/**
 * 从 stream 里按编码优先级挑一条可播放直链
 */
function pickStreamUrl(stream) {
  if (!stream || typeof stream !== 'object') return ''

  for (const codec of ['h264', 'h265', 'h266', 'av1']) {
    const list = stream[codec]
    if (Array.isArray(list) && list[0]) {
      return list[0].masterUrl || list[0].backupUrls?.[0] || ''
    }
  }

  for (const key of Object.keys(stream)) {
    const list = stream[key]
    if (Array.isArray(list) && list[0]?.masterUrl) return list[0].masterUrl
  }

  return ''
}

/**
 * 解析小红书笔记
 * @param {string} rawUrl 分享链接
 * @param {object} config parse 配置段
 */
export async function parseXiaohongshu(rawUrl, config = {}) {
  // app_share 短链用 PC UA 会被踢到 /404，必须用移动端 UA
  const headers = { 'User-Agent': MOBILE_UA, Referer: 'https://www.xiaohongshu.com/' }
  if (config.xhsCookie) headers.Cookie = config.xhsCookie

  let url = rawUrl
  if (/xhslink\.(?:com|cn)/i.test(url)) {
    try {
      const res = await fetchWithTimeout(url, { headers })
      url = res.url || url
    } catch { }
  }

  // 从落地 URL 里抽 noteId 与 xsec_token，重建标准笔记页（绕开 app_share 落地的 /404）
  const noteId = (url.match(/(?:explore\/|discovery\/item\/|noteId=)([0-9a-fA-F]{24})/)
    || url.match(/([0-9a-fA-F]{24})/))?.[1]
  const token = (url.match(/xsec_token=([^&]+)/) || [])[1] || ''
  const pageUrl = noteId
    ? `https://www.xiaohongshu.com/explore/${noteId}${token ? `?xsec_token=${token}&xsec_source=pc_share` : ''}`
    : url

  const res = await fetchWithTimeout(pageUrl, { headers })
  const html = await res.text()

  const start = html.indexOf('window.__INITIAL_STATE__=')
  if (start < 0) throw new Error('小红书页面结构变化或需要登录（可在配置填 cookie）')

  let raw = html.slice(start + 'window.__INITIAL_STATE__='.length)
  const end = raw.indexOf('</script>')
  // indexOf 返回 -1 时不能 slice，否则会静默截掉最后一个字符，把"页面截断"误报成"数据格式错误"
  if (end > 0) raw = raw.slice(0, end)
  raw = raw.trim()
  // 小红书页面里用 undefined 字面量，JSON.parse 不认；只替换值位置，别动正文里的英文单词
  raw = raw.replace(/:\s*undefined\b/g, ':null').replace(/([\[,]\s*)undefined\b/g, '$1null')

  let data
  try {
    data = JSON.parse(raw)
  } catch {
    throw new Error('小红书页面数据解析失败')
  }

  // 兼容两套结构：PC 端 note.noteDetailMap[id].note；移动端 noteData.data.noteData
  let note = null
  let id = noteId
  const detailMap = data?.note?.noteDetailMap
  if (detailMap && typeof detailMap === 'object') {
    const key = Object.keys(detailMap).find(item => detailMap[item]?.note)
    if (key) {
      note = detailMap[key].note
      id = key
    }
  }
  if (!note && data?.noteData?.data?.noteData) {
    note = data.noteData.data.noteData
    id = note.noteId || id
  }
  if (!note) throw new Error('小红书笔记获取失败（可能已删除、私密，或 xsec_token 失效，请重新复制分享链接）')

  const title = note.title || ''
  const desc = note.desc || ''
  const author = note.user?.nickname || note.user?.nickName || ''
  const imageList = Array.isArray(note.imageList) ? note.imageList : []
  const cover = note.cover?.urlDefault || note.cover?.url || pickImageUrl(imageList[0])
  const pageOut = id ? `https://www.xiaohongshu.com/explore/${id}` : pageUrl
  const videoHeaders = { 'User-Agent': MOBILE_UA, Referer: 'https://www.xiaohongshu.com/' }

  // 视频笔记
  if (note.type === 'video' && note.video) {
    const videoUrl = pickStreamUrl(note.video?.media?.stream)
    return {
      platform: '小红书',
      type: 'video',
      title,
      author,
      desc,
      cover,
      duration: Math.round(note.video?.capa?.duration || 0),
      pageUrl: pageOut,
      video: videoUrl ? { url: videoUrl, headers: videoHeaders, alternatives: [] } : null,
      images: [],
      liveVideos: []
    }
  }

  // 图文/多图笔记：逐张取图，带 livePhoto 的额外收实况小视频
  const images = []
  const liveVideos = []
  for (const image of imageList) {
    const url = pickImageUrl(image)
    if (url) images.push(url)

    if (image?.livePhoto) {
      const liveUrl = pickStreamUrl(image?.stream)
      if (liveUrl) liveVideos.push({ url: liveUrl, headers: videoHeaders, alternatives: [] })
    }
  }
  if (!images.length && !desc) throw new Error('未取到小红书笔记内容')

  return {
    platform: '小红书',
    type: 'note',
    title,
    author,
    desc,
    cover: cover || images[0] || '',
    duration: 0,
    pageUrl: pageOut,
    video: null,
    images,
    liveVideos
  }
}
