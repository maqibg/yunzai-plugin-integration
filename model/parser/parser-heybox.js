/**
 * 小黑盒解析
 * 用 app 接口的 hkey 签名取 link/tree，正文是内容块数组（可含富文本 html、图片、嵌入视频）
 * 风控触发时退回分享预览卡片，至少给出标题与封面
 */
import crypto from 'node:crypto'
import { PC_UA } from './parser-const.js'
import { fetchWithTimeout } from './parser-fetch.js'

const md5 = (text) => crypto.createHash('md5').update(String(text)).digest('hex')

/* ───── 以下为小黑盒 web 端 hkey 签名的等价移植 ───── */
const vm = (value) => (128 & value ? 255 & ((value << 1) ^ 27) : value << 1)
const qm = (value) => vm(value) ^ value
const sm = (value) => qm(vm(value))
const ym = (value) => sm(qm(vm(value)))
const gm = (value) => ym(value) ^ sm(value) ^ qm(value)

function km(values) {
  const temp = [0, 0, 0, 0]
  temp[0] = gm(values[0]) ^ ym(values[1]) ^ sm(values[2]) ^ qm(values[3])
  temp[1] = qm(values[0]) ^ gm(values[1]) ^ ym(values[2]) ^ sm(values[3])
  temp[2] = sm(values[0]) ^ qm(values[1]) ^ gm(values[2]) ^ ym(values[3])
  temp[3] = ym(values[0]) ^ sm(values[1]) ^ qm(values[2]) ^ gm(values[3])
  for (let i = 0; i < 4; i++) values[i] = temp[i]
  return values
}

const sv = (text, table) => {
  let out = ''
  for (let i = 0; i < text.length; i++) out += table[text.charCodeAt(i) % table.length]
  return out
}

const av = (text, table, count) => {
  let out = ''
  const part = table.slice(0, count)
  for (let i = 0; i < text.length; i++) out += part[text.charCodeAt(i) % part.length]
  return out
}

function ov(text, time, nonce) {
  const pathname = '/' + text.split('/').filter(Boolean).join('/') + '/'
  const table = 'AB45STUVWZEFGJ6CH01D237IXYPQRKLMN89'
  const columns = [av(String(time), table, -2), sv(pathname, table), sv(nonce, table)]

  let joined = ''
  const max = Math.max(...columns.map(column => column.length))
  for (let i = 0; i < max; i++) {
    for (const column of columns) {
      if (i < column.length) joined += column[i]
    }
  }
  joined = joined.slice(0, 20)

  const digest = md5(joined)
  let sum = km(digest.slice(-6).split('').map(char => char.charCodeAt(0)))
    .reduce((total, value) => total + value, 0) % 100
  let suffix = String(sum)
  if (suffix.length < 2) suffix = '0' + suffix

  return av(digest.substring(0, 5), table, -4) + suffix
}

/**
 * 为接口路径生成签名参数
 */
function signPath(pathname) {
  const time = Math.floor(Date.now() / 1000)
  const nonce = md5(`${time}${Math.random()}`).toUpperCase()
  return { hkey: ov(pathname, time + 1, nonce), _time: time, nonce }
}

/* ───── HTML 富文本工具 ───── */

function decodeEntities(text) {
  return String(text)
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
}

/**
 * 剥掉 html 标签取纯文本，块级标签转换行
 */
function stripHtml(html) {
  let text = String(html)
  text = text.replace(/<\s*(script|style)[^>]*>[\s\S]*?<\/\s*\1\s*>/gi, '')
  text = text.replace(/<\s*br\s*\/?>/gi, '\n')
  text = text.replace(/<\/\s*(p|div|li|h[1-6])\s*>/gi, '\n')
  text = text.replace(/<[^>]+>/g, '')
  text = decodeEntities(text)
  return text.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
}

/**
 * 从 html 抽嵌入视频：B站 iframe 还原成站内链接，其余保留直链
 */
function extractEmbedVideos(html) {
  const list = []
  let matched

  const iframePattern = /<iframe[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi
  while ((matched = iframePattern.exec(html))) {
    let src = decodeEntities(matched[1])
    if (src.startsWith('//')) src = 'https:' + src

    const bvid = src.match(/bvid=(BV[0-9A-Za-z]{10})/i)
    const aid = src.match(/[?&]aid=(\d+)/i)
    if (/player\.bilibili\.com/i.test(src) && (bvid || aid)) {
      list.push({ kind: 'bili', url: bvid ? `https://www.bilibili.com/video/${bvid[1]}` : `https://www.bilibili.com/video/av${aid[1]}` })
    } else {
      list.push({ kind: 'iframe', url: src })
    }
  }

  const videoPattern = /<video[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi
  while ((matched = videoPattern.exec(html))) {
    let src = decodeEntities(matched[1])
    if (src.startsWith('//')) src = 'https:' + src
    if (src) list.push({ kind: 'video', url: src })
  }

  return list
}

/**
 * 从 html 抽真实图片（排除游戏卡，它没有真实 url）
 */
function extractHtmlImages(html) {
  const list = []
  const pattern = /<img\b[^>]*>/gi
  let matched

  while ((matched = pattern.exec(html))) {
    const tag = matched[0]
    if (/class=["'][^"']*mention-game/i.test(tag)) continue
    const url = (tag.match(/data-original=["']([^"']+)["']/i) || tag.match(/\bsrc=["']([^"']+)["']/i))?.[1]
    if (url) list.push(decodeEntities(url))
  }

  return list
}

/* ───── 接口 ───── */

/**
 * 从分享接口的 302 跳转里取预览信息与 link_id
 */
async function getShareInfo(rawUrl) {
  let linkId = (rawUrl.match(/link_id=([0-9a-fA-F]+)/)
    || rawUrl.match(/\/link\/([0-9a-fA-F]+)/)
    || rawUrl.match(/\/(?:bbs\/)?link\/(\d+)/))?.[1] || ''
  let info = {}

  try {
    const url = linkId
      ? `https://api.xiaoheihe.cn/v3/bbs/app/api/web/share?link_id=${linkId}&h_src=YXBwX3NoYXJl`
      : rawUrl
    const res = await fetchWithTimeout(url, { headers: { 'User-Agent': PC_UA }, redirect: 'manual' })
    const location = res.headers.get('location') || ''

    if (!linkId) {
      linkId = (location.match(/link_id=([0-9a-fA-F]+)/) || location.match(/\/link\/([0-9a-fA-F]+)/))?.[1] || ''
    }

    const data = location.match(/redirect_data=([^&]+)/)
    if (data) {
      try { info = JSON.parse(decodeURIComponent(data[1]))?.link || {} } catch { }
    }
  } catch (error) {
    logger.warn(`[解析] 小黑盒分享接口失败: ${error.message}`)
  }

  return { linkId, info }
}

/**
 * 取作品正文
 */
async function fetchLinkTree(linkId, cookie) {
  const pathname = '/bbs/app/link/tree/v2'
  const sign = signPath(pathname)

  const params = new URLSearchParams({
    link_id: linkId,
    x_client_type: 'web',
    os_type: 'web',
    x_os_type: 'Mac',
    client_type: 'web',
    x_app: 'heybox_website',
    web_version: '2.5',
    heybox_id: '-1',
    version: '999.0.4',
    app: 'heybox',
    ...sign
  })

  const headers = { 'User-Agent': PC_UA, Referer: 'https://www.xiaoheihe.cn/' }
  if (cookie) headers.Cookie = cookie

  const res = await fetchWithTimeout(`https://api.xiaoheihe.cn${pathname}?${params}`, { headers })
  return res.json()
}

/**
 * 解析小黑盒帖子
 * @param {string} rawUrl 分享链接
 * @param {object} config parse 配置段
 */
export async function parseHeybox(rawUrl, config = {}) {
  const { linkId, info } = await getShareInfo(rawUrl)
  // silent：链接不是帖子页，不该在群里报错
  if (!linkId) throw Object.assign(new Error('未取到小黑盒作品 ID'), { silent: true })

  const json = await fetchLinkTree(linkId, config.heyboxCookie || '')

  if (json?.status !== 'ok' || !json?.result?.link?.body) {
    // 风控/验证码导致正文拉不到时，退回分享预览（该接口免签名、不受风控影响）
    if (info.title || info.thumb) {
      const tip = json?.status === 'show_captcha'
        ? '\n（小黑盒风控验证，仅取到预览；想要全文多图可在配置填登录 cookie）'
        : ''
      return {
        platform: '小黑盒',
        type: 'note',
        title: info.title || '',
        author: '',
        desc: (info.description || '') + tip,
        cover: info.thumb || '',
        duration: 0,
        pageUrl: `https://www.xiaoheihe.cn/app/bbs/link/${linkId}`,
        video: null,
        images: []
      }
    }

    if (json?.status === 'show_captcha') {
      throw new Error('小黑盒触发了验证码（可在配置填登录 cookie 后重试）')
    }
    throw new Error('小黑盒作品获取失败（可能已删除、私密，或接口风控）')
  }

  const body = json.result.link.body
  const author = body.user?.username || ''
  const title = body.title || info.title || ''
  // 接口给了页面地址就用它，自己拼容易和站内路由规则对不上
  const pageUrl = json.result.link?.url || json.result.link?.share_url || `https://www.xiaoheihe.cn/app/bbs/link/${linkId}`
  const stripCube = (text) => String(text || '').replace(/\[cube_[^\]]+\]/g, '')

  // body.text 可能是「内容块数组的 JSON 字符串」，也可能是纯文本（部分视频帖）
  let blocks = null
  try {
    const parsed = JSON.parse(body.text)
    if (Array.isArray(parsed)) blocks = parsed
  } catch { }

  if (blocks) {
    const texts = []
    const imageBlocks = []
    let embeds = []
    let htmlImages = []

    for (const block of blocks) {
      if (block?.type === 'img' && block.url) {
        imageBlocks.push(block.url)
        continue
      }

      const text = block?.text || ''
      if (/<[a-z!/]/i.test(text)) {
        const plain = stripHtml(text)
        if (plain) texts.push(stripCube(plain))
        embeds = embeds.concat(extractEmbedVideos(text))
        htmlImages = htmlImages.concat(extractHtmlImages(text))
      } else if (text.trim()) {
        texts.push(stripCube(text.trim()))
      }
    }

    // 独立图片块带缩放参数、更稳，优先用它
    const images = imageBlocks.length ? imageBlocks : htmlImages
    const desc = texts.join('\n').trim()
    const biliUrls = embeds.filter(item => item.kind === 'bili').map(item => item.url)
    const extEmbeds = embeds.filter(item => item.kind !== 'bili').map(item => item.url)

    return {
      platform: '小黑盒',
      type: images.length || desc ? 'note' : 'card',
      title,
      author,
      desc,
      cover: images[0] || info.thumb || '',
      duration: 0,
      pageUrl,
      video: null,
      images,
      biliUrls,
      extEmbeds
    }
  }

  const plain = body.text || info.description || ''
  const embeds = /<[a-z!/]/i.test(plain) ? extractEmbedVideos(plain) : []

  return {
    platform: '小黑盒',
    type: 'card',
    title,
    author,
    desc: stripCube(/<[a-z!/]/i.test(plain) ? stripHtml(plain) : plain),
    cover: info.thumb || '',
    duration: 0,
    pageUrl,
    video: null,
    images: [],
    biliUrls: embeds.filter(item => item.kind === 'bili').map(item => item.url),
    extEmbeds: embeds.filter(item => item.kind !== 'bili').map(item => item.url)
  }
}
