/**
 * 解析详情卡片渲染
 * 用 Yunzai 自带的 puppeteer 把 resources/parser/parse.html 截成图片；
 * 渲染失败返回 null，由调用方降级成纯文字消息
 */
import path from 'node:path'
import puppeteer from '../../../../lib/puppeteer/puppeteer.js'
import { formatDuration } from './parser-fetch.js'
import { buildVideoStats } from './parser-stats.js'

const pluginRoot = path.join(process.cwd(), 'plugins', 'yunzai-plugin-integration')
const TEMPLATE = path.join(pluginRoot, 'resources', 'parser', 'parse.html')

// 平台 → 模板里的主题类名（决定卡片配色与图标）
const PLATFORM_HINT = {
  '抖音': 'douyin',
  '快手': 'kuaishou',
  '小红书': 'xiaohongshu',
  '小黑盒': 'heybox'
}

/**
 * 组装卡片要用的展示数据
 */
function buildCardData(result, statusText) {
  const imageCount = result.images?.length || 0
  const liveCount = result.liveVideos?.length || 0
  const mediaCount = imageCount + liveCount
  const isVideo = result.type === 'video'
  const isLive = result.type === 'live'
  const sizeMB = result.video?.size ? result.video.size / 1048576 : 0

  return {
    platform: result.platform || '解析',
    platformHint: PLATFORM_HINT[result.platform] || 'link',
    title: String(result.title || result.desc || '未命名作品').slice(0, 100),
    author: String(result.author || '未知作者').slice(0, 40),
    cover: result.cover || result.images?.[0] || '',
    durationText: isLive ? '直播' : (result.duration ? formatDuration(result.duration) : (isVideo ? '未知' : '图文')),
    kindText: isLive ? '直播间' : (isVideo ? '视频作品' : (mediaCount ? '图文 / 图集作品' : '图文卡片')),
    contentText: mediaCount
      ? `${mediaCount} 项媒体`
      : (sizeMB ? `约 ${sizeMB.toFixed(1)} MB` : (result.desc ? `${String(result.desc).slice(0, 24)}…` : '图文')),
    statusText: String(statusText || '解析成功').slice(0, 60),
    stats: isLive ? [] : buildVideoStats(result)
  }
}

/**
 * 渲染详情卡片
 * @param {object} result 解析结果
 * @param {string} statusText 卡片右上角状态文案
 * @returns {Promise<object|null>} 图片消息段，失败返回 null
 */
export async function renderParseCard(result, statusText = '解析成功') {
  const data = buildCardData(result, statusText)

  try {
    return await puppeteer.screenshot('parseCard', {
      tplFile: TEMPLATE,
      // 模板里用 {{pluResPath}}/plugins/... 找背景图，所以这里要给项目根目录
      pluResPath: process.cwd(),
      saveId: `parse_${Date.now()}_${Math.floor(Math.random() * 1000000)}`,
      imgType: 'png',
      data
    })
  } catch (error) {
    logger.warn(`[解析] 详情卡片渲染失败，降级为普通消息: ${error.message}`)
    return null
  }
}
