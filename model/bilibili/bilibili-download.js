/**
 * Bilibili 下载处理模块
 * 包含智能画质选择、文件大小检测、FFmpeg合并等
 */
import fs from 'node:fs'
import path from 'node:path'
import fetch from 'node-fetch'
import { execSync } from 'child_process'
import setting from './bilibili-setting.js'
import api, { buildHeaders } from './bilibili-api.js'
import { QN_MAP, QUALITY_PRIORITY, DEFAULT_HEADERS } from './bilibili-const.js'

const pluginRoot = path.join(process.cwd(), 'plugins', 'yunzai-plugin-integration')

/**
 * 下载状态管理（防止并发下载）
 */
let isDownloading = false

/**
 * 获取画质名称
 */
function getQualityName(qn) {
  return QN_MAP[qn]?.name || `${qn}P`
}

/**
 * 格式化文件大小
 */
function formatSize(bytes) {
  if (bytes < 1024) return bytes + 'B'
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + 'KB'
  if (bytes < 1073741824) return (bytes / 1048576).toFixed(1) + 'MB'
  return (bytes / 1073741824).toFixed(2) + 'GB'
}

/**
 * 获取流的文件大小
 */
async function getStreamSize(url, headers) {
  try {
    const res = await fetch(url, { method: 'HEAD', headers })
    const size = parseInt(res.headers.get('content-length'), 10)
    return isNaN(size) ? 0 : size
  } catch {
    return 0
  }
}

/**
 * 下载流到文件
 */
async function downloadStream(url, filePath, headers) {
  const res = await fetch(url, { headers })
  if (!res.ok) throw new Error(`下载失败: ${res.status}`)

  const buffer = Buffer.from(await res.arrayBuffer())
  fs.writeFileSync(filePath, buffer)
  return buffer.length
}

/**
 * 智能画质选择
 * 根据文件大小自动降级画质
 */
async function smartQualitySelection(bvid, cid, headers) {
  const config = setting.getConfig()
  const videoConfig = config.video || {}
  const smartConfig = videoConfig.smartQuality || {}

  // 默认画质
  let targetQn = videoConfig.quality || 64

  // 如果未启用智能画质，直接返回默认画质
  if (!smartConfig.enable) {
    return { qn: targetQn, reason: null }
  }

  const threshold = (smartConfig.threshold || 100) * 1048576 // MB转字节
  const targetSize = (smartConfig.targetSize || 80) * 1048576
  const priority = smartConfig.priority || [80, 64, 32, 16]

  // 获取播放地址并检查大小
  const playData = await api.getPlayUrl(bvid, cid, targetQn)
  if (!playData?.dash) {
    return { qn: targetQn, reason: null }
  }

  // 找到最接近目标画质的视频流
  let videoStream = null
  let actualQn = targetQn

  for (const v of playData.dash.video) {
    if (v.id <= targetQn) {
      videoStream = v
      actualQn = v.id
      break
    }
  }

  if (!videoStream) {
    videoStream = playData.dash.video[playData.dash.video.length - 1]
    actualQn = videoStream?.id || 16
  }

  // 获取音频流
  const audioStream = playData.dash.audio?.[0]
  if (!videoStream || !audioStream) {
    return { qn: actualQn, reason: null }
  }

  // 计算总大小
  const videoSize = await getStreamSize(videoStream.baseUrl, headers)
  const audioSize = await getStreamSize(audioStream.baseUrl, headers)
  const totalSize = videoSize + audioSize

  logger.mark(`[Bilibili] 当前画质: ${getQualityName(actualQn)}, 预估大小: ${formatSize(totalSize)}`)

  // 如果大小在阈值内，不需要降级
  if (totalSize <= threshold) {
    return {
      qn: actualQn,
      size: totalSize,
      videoUrl: videoStream.baseUrl,
      audioUrl: audioStream.baseUrl,
      reason: null
    }
  }

  // 需要降级，按优先级尝试更低画质
  const originalQn = actualQn

  for (const qn of priority) {
    // 跳过比当前画质更高或相同的
    if (qn >= actualQn) continue

    const lowerPlayData = await api.getPlayUrl(bvid, cid, qn)
    if (!lowerPlayData?.dash?.video?.length) continue

    const lowerVideo = lowerPlayData.dash.video.find(v => v.id <= qn) ||
      lowerPlayData.dash.video[0]
    const lowerAudio = lowerPlayData.dash.audio?.[0]

    if (!lowerVideo || !lowerAudio) continue

    const lowerVideoSize = await getStreamSize(lowerVideo.baseUrl, headers)
    const lowerAudioSize = await getStreamSize(lowerAudio.baseUrl, headers)
    const lowerTotal = lowerVideoSize + lowerAudioSize

    logger.mark(`[Bilibili] 尝试画质: ${getQualityName(lowerVideo.id)}, 预估大小: ${formatSize(lowerTotal)}`)

    // 如果达到目标大小或已是最低画质
    if (lowerTotal <= targetSize || qn === priority[priority.length - 1]) {
      return {
        qn: lowerVideo.id,
        size: lowerTotal,
        videoUrl: lowerVideo.baseUrl,
        audioUrl: lowerAudio.baseUrl,
        reason: `智能降级: ${getQualityName(originalQn)} → ${getQualityName(lowerVideo.id)}`,
        originalQn
      }
    }
  }

  // 无法降级到目标大小，使用最低画质
  return {
    qn: actualQn,
    size: totalSize,
    videoUrl: videoStream.baseUrl,
    audioUrl: audioStream.baseUrl,
    reason: null
  }
}

/**
 * 下载并合并视频
 */
async function downloadAndMerge(videoUrl, audioUrl, outputPath, headers) {
  const tempDir = setting.tempPath
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true })
  }

  const videoPath = path.join(tempDir, 'video.m4s')
  const audioPath = path.join(tempDir, 'audio.m4s')

  try {
    logger.mark('[Bilibili] 开始下载视频和音频...')

    // 下载视频
    await downloadStream(videoUrl, videoPath, headers)
    logger.mark('[Bilibili] 视频下载完成')

    // 下载音频
    await downloadStream(audioUrl, audioPath, headers)
    logger.mark('[Bilibili] 音频下载完成')

    // FFmpeg合并
    logger.mark('[Bilibili] 开始合并音视频...')

    const ffmpegCmd = `ffmpeg -i "${videoPath}" -i "${audioPath}" -c:v copy -c:a copy -f mp4 -y -loglevel error "${outputPath}"`

    execSync(ffmpegCmd, {
      cwd: tempDir,
      timeout: 300000 // 5分钟超时
    })

    logger.mark('[Bilibili] 音视频合并完成')

    // 清理临时文件
    if (fs.existsSync(videoPath)) fs.unlinkSync(videoPath)
    if (fs.existsSync(audioPath)) fs.unlinkSync(audioPath)

    return true
  } catch (error) {
    logger.error(`[Bilibili] 下载合并失败: ${error.message}`)

    // 清理临时文件
    if (fs.existsSync(videoPath)) fs.unlinkSync(videoPath)
    if (fs.existsSync(audioPath)) fs.unlinkSync(audioPath)

    return false
  }
}

/**
 * 视频下载器类
 */
class BilibiliDownloader {
  /**
   * 下载视频
   * @param {object} e 消息事件
   * @param {string} bvid BV号
   * @param {number} pageIndex 分P索引（从0开始）
   * @param {boolean} sendMessage 是否发送下载消息
   */
  async download(e, bvid, pageIndex = 0, sendMessage = true) {
    if (isDownloading) {
      if (sendMessage) e.reply('有其他视频正在下载中，请稍后再试', true)
      return null
    }

    const config = setting.getConfig()
    const videoConfig = config.video || {}

    // 获取视频信息
    const videoInfo = await api.getVideoInfo(bvid)
    if (!videoInfo) {
      if (sendMessage) e.reply('获取视频信息失败')
      return null
    }

    // 获取分P信息
    const pages = videoInfo.pages || []
    if (pageIndex >= pages.length) {
      if (sendMessage) e.reply(`分P ${pageIndex + 1} 不存在，该视频共 ${pages.length} P`)
      return null
    }

    const page = pages[pageIndex]
    const cid = page.cid

    // 检查时长限制
    const duration = page.duration || videoInfo.duration
    if (videoConfig.durationLimit && duration > videoConfig.durationLimit) {
      if (sendMessage) {
        e.reply(`视频时长 ${Math.floor(duration / 60)} 分钟，超过限制 ${Math.floor(videoConfig.durationLimit / 60)} 分钟，不进行下载`)
      }
      return null
    }

    const headers = await buildHeaders()
    if (!headers) {
      if (sendMessage) e.reply('获取认证信息失败，请先执行 #b站登录')
      return null
    }

    // 智能画质选择
    const qualityResult = await smartQualitySelection(bvid, cid, headers)
    if (!qualityResult.videoUrl || !qualityResult.audioUrl) {
      // 需要重新获取播放地址
      const playData = await api.getPlayUrl(bvid, cid, qualityResult.qn)
      if (!playData?.dash?.video?.length || !playData?.dash?.audio?.length) {
        if (sendMessage) e.reply('获取视频下载地址失败')
        return null
      }

      qualityResult.videoUrl = playData.dash.video[0].baseUrl
      qualityResult.audioUrl = playData.dash.audio[0].baseUrl

      // 重新计算大小
      const vSize = await getStreamSize(qualityResult.videoUrl, headers)
      const aSize = await getStreamSize(qualityResult.audioUrl, headers)
      qualityResult.size = vSize + aSize
    }

    // 检查文件大小限制
    const fileSizeLimit = (videoConfig.fileSizeLimit || 0) * 1048576
    if (fileSizeLimit > 0 && qualityResult.size > fileSizeLimit) {
      if (sendMessage) {
        e.reply(`视频大小 ${formatSize(qualityResult.size)} 超过限制 ${videoConfig.fileSizeLimit}MB，不进行下载`)
      }
      return null
    }

    // 检查最大发送限制（约100MB）
    if (qualityResult.size > 104857600) {
      if (sendMessage) e.reply('视频超过100MB，无法直接发送')
      return null
    }

    isDownloading = true

    let downloadMsg = null
    if (sendMessage) {
      let msg = `开始下载视频，画质: ${getQualityName(qualityResult.qn)}, 大小: ${formatSize(qualityResult.size)}`
      if (qualityResult.reason) {
        msg += `\n${qualityResult.reason}`
      }
      downloadMsg = await e.reply(msg, true)
    }

    try {
      // 准备输出路径
      const tempDir = setting.tempPath
      if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true })
      }
      const outputPath = path.join(tempDir, `${bvid}_p${pageIndex + 1}.mp4`)

      // 下载并合并
      const success = await downloadAndMerge(
        qualityResult.videoUrl,
        qualityResult.audioUrl,
        outputPath,
        headers
      )

      if (!success) {
        if (sendMessage) e.reply('视频下载失败')
        return null
      }

      // 撤回下载提示
      if (downloadMsg?.message_id) {
        try {
          if (e.isGroup) {
            await e.group.recallMsg(downloadMsg.message_id)
          } else {
            await e.friend.recallMsg(downloadMsg.message_id)
          }
        } catch { }
      }

      // 返回视频segment
      const video = segment.video(outputPath)

      // 发送后延迟删除临时文件
      setTimeout(() => {
        if (fs.existsSync(outputPath)) {
          fs.unlinkSync(outputPath)
        }
      }, 60000)

      return video
    } finally {
      isDownloading = false
    }
  }

  /**
   * 检查是否可以下载（预检查）
   */
  async canDownload(bvid, pageIndex = 0) {
    const config = setting.getConfig()
    const videoConfig = config.video || {}

    const videoInfo = await api.getVideoInfo(bvid)
    if (!videoInfo) return { can: false, reason: '无法获取视频信息' }

    const pages = videoInfo.pages || []
    if (pageIndex >= pages.length) {
      return { can: false, reason: `分P ${pageIndex + 1} 不存在` }
    }

    const page = pages[pageIndex]
    const duration = page.duration || videoInfo.duration

    if (videoConfig.durationLimit && duration > videoConfig.durationLimit) {
      return {
        can: false,
        reason: `时长超限 (${Math.floor(duration / 60)}分钟 > ${Math.floor(videoConfig.durationLimit / 60)}分钟)`
      }
    }

    return { can: true, videoInfo, page }
  }

  /**
   * 获取预估大小
   */
  async getEstimatedSize(bvid, cid, qn = 64) {
    const headers = await buildHeaders()
    if (!headers) return 0

    const playData = await api.getPlayUrl(bvid, cid, qn)
    if (!playData?.dash) return 0

    const video = playData.dash.video?.find(v => v.id <= qn) || playData.dash.video?.[0]
    const audio = playData.dash.audio?.[0]

    if (!video || !audio) return 0

    const vSize = await getStreamSize(video.baseUrl, headers)
    const aSize = await getStreamSize(audio.baseUrl, headers)

    return vSize + aSize
  }
}

export default new BilibiliDownloader()
export {
  smartQualitySelection,
  downloadAndMerge,
  getQualityName,
  formatSize,
  getStreamSize
}
