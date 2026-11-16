/**
 * 解析结果发送
 * 优先渲染详情卡片；图文走合并转发折叠，视频下载后发本体
 * 任何一环失败都保留可读的兜底（直链/原页面），不允许静默丢消息
 */
import fs from 'node:fs'
import path from 'node:path'
import {
  DOUYIN_LONG_VIDEO_SECONDS,
  MOBILE_UA
} from './parser-const.js'
import {
  downloadToFile,
  ensureTempDir,
  fetchWithTimeout,
  formatDuration,
  formatSize,
  probeRemoteSize,
  tempPath
} from './parser-fetch.js'
import { renderParseCard } from './parser-card.js'

/**
 * 降级文案（卡片渲染不出来时使用）
 */
function buildHeader(result) {
  const lines = [`${result.platform}${result.type === 'live' ? '直播' : '解析'}`]
  if (result.title) lines.push(`标题: ${result.title}`)
  if (result.author) lines.push(`作者: ${result.author}`)
  if (result.duration) lines.push(`时长: ${formatDuration(result.duration)}`)
  return lines.join('\n')
}

/**
 * 截断长文本，避免一条消息过长被适配器截掉
 */
function clip(text, max = 500) {
  const value = String(text || '').trim()
  return value.length > max ? value.slice(0, max) + '…' : value
}

/**
 * 抖音长视频：分钟级作品即便没超体积上限，也容易把发视频流程拖崩
 */
function isDouyinLongVideo(result) {
  return result.platform === '抖音'
    && (result.duration >= DOUYIN_LONG_VIDEO_SECONDS || /(?:long-video|long_video)/i.test(result.video?.url || ''))
}

// 图片 CDN 对请求头要求不同：抖音的图不带 Referer 会被拒，小红书同理
const IMAGE_HEADERS = {
  '抖音': { 'User-Agent': MOBILE_UA, Referer: 'https://www.douyin.com/' },
  '小红书': { 'User-Agent': MOBILE_UA, Referer: 'https://www.xiaohongshu.com/' }
}

/**
 * 取一张图并转成图片消息
 * 必须先落成 buffer：直接把 URL 交给适配器时无法附带 Referer，抖音/小红书会回 403
 */
async function toImageSegment(url, platform) {
  const headers = IMAGE_HEADERS[platform]
  if (!headers) return segment.image(url)

  try {
    const res = await fetchWithTimeout(url, { headers }, 20000)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return segment.image(Buffer.from(await res.arrayBuffer()))
  } catch (error) {
    logger.warn(`[解析] 图片下载失败，改用直链发送: ${error.message}`)
    return segment.image(url)
  }
}

/**
 * 按 3 张一组并发取图，串行会把十几张图拖到几分钟
 */
async function loadImageSegments(urls, platform) {
  const segments = []
  for (let i = 0; i < urls.length; i += 3) {
    const chunk = urls.slice(i, i + 3)
    segments.push(...await Promise.all(chunk.map(url => toImageSegment(url, platform))))
  }
  return segments
}

/**
 * 合并转发：把文案与图片折成一条聊天记录
 * @returns {Promise<boolean>} 是否发送成功
 */
async function sendForwardImages(e, result, config) {
  const limit = Number(config.imageLimit) || 18
  const list = (result.images || []).slice(0, limit)
  if (!list.length) return false

  const title = result.title || `${result.platform}图文`
  const nodes = []

  let head = [result.platform, result.title, result.author].filter(Boolean).join('\n')
  if (result.desc && result.desc !== result.title) head += `\n\n${clip(result.desc, 1200)}`
  if (result.pageUrl) head += `\n\n🔗 ${result.pageUrl}`
  nodes.push(head)

  nodes.push(...await loadImageSegments(list, result.platform))

  const messages = nodes.map(node => ({
    message: node,
    nickname: clip(title, 20) || '图文解析',
    user_id: Bot.uin
  }))

  await e.reply(await Bot.makeForwardMsg(messages))
  return true
}

/**
 * 分批发图（合并转发不可用时的退路）
 */
async function sendImagesDirect(e, result, config) {
  const limit = Number(config.imageLimit) || 18
  const list = (result.images || []).slice(0, limit)
  const batchSize = result.platform === '抖音' ? 4 : 8

  for (let start = 0; start < list.length; start += batchSize) {
    const batch = list.slice(start, start + batchSize)
    await e.reply(await loadImageSegments(batch, result.platform))
  }

  if (result.images.length > limit) {
    await e.reply(`共 ${result.images.length} 张图片，仅发送前 ${limit} 张`)
  }
}

/**
 * 下载并发送单个视频，失败回退页面链接
 */
async function sendVideoFile(e, video, config, label = '视频', fallbackUrl = '') {
  ensureTempDir()
  const filePath = path.join(tempPath, `parse_${Date.now()}_${Math.floor(Math.random() * 1000000)}.mp4`)
  const maxMB = Number(config.fileSizeLimit) || 0

  try {
    await downloadToFile(video.url, video.headers || {}, filePath, maxMB)
    const size = fs.statSync(filePath).size
    logger.mark(`[解析] ${label}已下载 ${formatSize(size)}`)
    await e.reply(segment.video(filePath))
  } catch (error) {
    logger.error(`[解析] ${label}发送失败: ${error.message}`)
    // 视频直链是短时效签名地址，别人点开常常已经 403，优先给作品页
    const link = fallbackUrl || video.url
    await e.reply(`${label}发送失败，直接甩链接👇\n🔗 ${link}`)
  } finally {
    // 适配器在 reply 返回后还要读文件（上传/转码），立刻删会让发送偶发失败
    setTimeout(() => fs.unlink(filePath, () => { }), 60000)
  }
}

/**
 * 发送解析结果
 * @param {object} e 消息事件
 * @param {object} result 统一解析结果
 * @param {object} config parse 配置段
 */
export async function sendParseResult(e, result, config = {}) {
  const showCover = config.showCover !== false

  // 直播：只给房间信息与链接，不下载流
  if (result.type === 'live') {
    const card = await renderParseCard(result, '直播间识别成功')
    if (card) await e.reply(card)
    else await e.reply(buildHeader(result))

    if (!card && showCover && result.cover) await e.reply(segment.image(result.cover))
    if (result.pageUrl) await e.reply(`🔗 ${result.pageUrl}`)
    return
  }

  // 纯文字卡片（小黑盒拿不到正文媒体时的兜底）
  if (result.type === 'card') {
    const card = await renderParseCard(result, '解析成功 · 图文卡片')
    if (card) await e.reply(card)
    else await e.reply(buildHeader(result))

    if (result.desc) await e.reply(clip(result.desc, 300))
    if (!card && showCover && result.cover) await e.reply(segment.image(result.cover))
    for (const url of result.biliUrls || []) await e.reply(`文章内嵌 B站视频👇\n🔗 ${url}`)
    for (const url of result.extEmbeds || []) await e.reply(`文章内嵌视频👇\n🔗 ${url}`)
    if (result.pageUrl) await e.reply(`🔗 ${result.pageUrl}`)
    return
  }

  // 图文/图集
  if (result.type === 'images' || result.type === 'note') {
    const mediaCount = (result.images?.length || 0) + (result.liveVideos?.length || 0)
    const card = await renderParseCard(result, mediaCount ? `图文解析成功 · 共 ${mediaCount} 项媒体` : '图文解析成功')

    if (card) {
      await e.reply(card)
    } else {
      const desc = result.desc && result.desc !== result.title ? `\n\n${clip(result.desc, 400)}` : ''
      await e.reply(buildHeader(result) + desc)
      // 封面回落到首图时不再单发，免得和图片重复
      if (showCover && result.cover && result.cover !== result.images?.[0]) {
        await e.reply(segment.image(result.cover))
      }
    }

    if (result.images?.length) {
      let forwarded = false
      try {
        forwarded = await sendForwardImages(e, result, config)
      } catch (error) {
        logger.error(`[解析] 图文合并转发失败，改为分批发送: ${error.message}`)
      }
      if (!forwarded) await sendImagesDirect(e, result, config)
    }

    const liveVideos = result.liveVideos || []
    if (liveVideos.length && config.sendVideo !== false) {
      const maxLive = Number(config.maxLive) || 6
      for (const video of liveVideos.slice(0, maxLive)) {
        await sendVideoFile(e, video, config, '实况图', result.pageUrl)
      }
    }

    for (const url of result.biliUrls || []) await e.reply(`文章内嵌 B站视频👇\n🔗 ${url}`)
    for (const url of result.extEmbeds || []) await e.reply(`文章内嵌视频👇\n🔗 ${url}`)
    if (result.pageUrl) await e.reply(`🔗 ${result.pageUrl}`)
    return
  }

  // 视频：先判断能不能发本体，再决定下载还是甩链接
  if (!result.video) {
    const card = await renderParseCard(result, '未取到视频直链')
    if (card) await e.reply(card)
    else await e.reply(buildHeader(result))

    if (!card && showCover && result.cover) await e.reply(segment.image(result.cover))
    if (result.pageUrl) await e.reply(`🔗 ${result.pageUrl}`)
    return
  }

  const maxMB = Number(config.fileSizeLimit) || 0
  const maxDuration = Number(config.durationLimit) || 0
  let reason = ''

  if (config.sendVideo === false) {
    reason = '已关闭视频发送'
  } else if (maxDuration && result.duration && result.duration > maxDuration) {
    reason = `时长 ${formatDuration(result.duration)} 超过上限 ${formatDuration(maxDuration)}`
  } else if (isDouyinLongVideo(result)) {
    reason = '抖音长视频'
  } else if (maxMB) {
    const remoteSize = await probeRemoteSize(result.video.url, result.video.headers || {})
    if (remoteSize && remoteSize / 1048576 > maxMB) {
      reason = `体积 ${formatSize(remoteSize)} 超过上限 ${maxMB}MB`
    }
  }

  const link = result.pageUrl || result.video.url
  if (reason) {
    logger.mark(`[解析] ${result.platform} 不下载本体：${reason}`)
    const card = await renderParseCard(result, `${reason} · 可打开链接`)
    if (card) await e.reply(card)
    else await e.reply(buildHeader(result))

    if (!card && showCover && result.cover) await e.reply(segment.image(result.cover))
    await e.reply(`🔗 ${link}`)
    return
  }

  const card = await renderParseCard(result, '解析成功 · 视频可发送')
  if (card) {
    await e.reply(card)
  } else {
    await e.reply(buildHeader(result))
    if (showCover && result.cover) await e.reply(segment.image(result.cover))
  }

  await sendVideoFile(e, result.video, config, `${result.platform}视频`, result.pageUrl)
}
