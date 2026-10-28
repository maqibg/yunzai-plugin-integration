/**
 * Bilibili 下载处理模块
 * 包含智能画质选择、文件大小检测、FFmpeg合并等
 */
import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'child_process'
import { pipeline } from 'node:stream/promises'
import setting from './bilibili-setting.js'
import api, { buildHeaders, fetchBili } from './bilibili-api.js'
import { QN_MAP, QUALITY_PRIORITY, DEFAULT_HEADERS } from './bilibili-const.js'

const pluginRoot = path.join(process.cwd(), 'plugins', 'yunzai-plugin-integration')

/**
 * 下载状态管理（防止并发下载）
 */
let isDownloading = false

/**
 * 预估大小与紧随其后的下载会问同一份播放地址和文件大小，用短缓存避免重复请求
 */
const MEDIA_CACHE_TTL = 2 * 60 * 1000
const playUrlCache = new Map()
const streamSizeCache = new Map()

function cacheGet(cache, key) {
  const hit = cache.get(key)
  if (!hit) return undefined
  if (Date.now() - hit.time > MEDIA_CACHE_TTL) {
    cache.delete(key)
    return undefined
  }
  return hit.value
}

function cacheSet(cache, key, value) {
  cache.set(key, { value, time: Date.now() })
  // 条目上限，避免机器人长期运行后缓存无限增长
  if (cache.size > 200) {
    cache.delete(cache.keys().next().value)
  }
}

async function getPlayUrlCached(bvid, cid, qn) {
  const key = `${bvid}:${cid}:${qn}`
  const cached = cacheGet(playUrlCache, key)
  if (cached !== undefined) return cached

  const data = await api.getPlayUrl(bvid, cid, qn)
  if (data) cacheSet(playUrlCache, key, data)
  return data
}

/**
 * 重置下载锁
 */
function resetDownloadLock() {
  isDownloading = false
}

/**
 * 获取下载状态
 */
function getDownloadStatus() {
  return isDownloading
}

/**
 * 下载排队：同一时刻只跑一个下载，后来的排队而不是被直接拒绝
 */
const MAX_DOWNLOAD_QUEUE = 3
let queueCount = 0
let runningChain = Promise.resolve()

/**
 * 重置下载队列与内存状态（进程刚启动，或人工兜底时调用）
 */
function resetDownloadQueue() {
  isDownloading = false
  queueCount = 0
  runningChain = Promise.resolve()
  playUrlCache.clear()
  streamSizeCache.clear()
}

/**
 * 清空上次运行遗留的临时文件（重启时调用）
 * 只动插件自己的 temp 目录，其它位置一律不碰
 */
async function cleanTempFiles() {
  const dir = setting.tempPath
  if (!fs.existsSync(dir)) return 0

  let removed = 0
  for (const name of fs.readdirSync(dir)) {
    const target = path.join(dir, name)
    try {
      const stat = fs.statSync(target)
      if (stat.isDirectory()) {
        fs.rmSync(target, { recursive: true, force: true })
      } else {
        fs.unlinkSync(target)
      }
      removed++
    } catch (error) {
      logger.warn(`[Bilibili] 启动清理失败 ${name}: ${error.message}`)
    }
  }
  return removed
}

/**
 * 启动自检：重置队列 + 清理缓存
 */
async function startupReset() {
  resetDownloadQueue()
  const removed = await cleanTempFiles()
  logger.mark(`[Bilibili] 启动自检完成：下载队列已重置，清理临时文件 ${removed} 个`)
  return removed
}

/**
 * 异步执行 ffmpeg（原来用 execSync 会把整个机器人卡住最长 5 分钟）
 */
function runFfmpeg(bin, args, timeoutMs = 300000) {
  return new Promise((resolve, reject) => {
    let stderr = ''
    const child = spawn(bin, args)

    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      // 超时也把已有输出带出来，好判断是卡在解码还是磁盘
      if (stderr.trim()) {
        logger.error(`[Bilibili] ffmpeg 超时前输出（尾部）:\n${stderr.trim().slice(-4000)}`)
      }
      reject(new Error(`合并超时（${timeoutMs}ms）`))
    }, timeoutMs)

    child.stderr?.on('data', chunk => {
      // 只留尾部，避免长日志占内存
      stderr = (stderr + chunk.toString()).slice(-8000)
    })

    child.on('error', error => {
      clearTimeout(timer)
      reject(error)
    })

    child.on('close', code => {
      clearTimeout(timer)
      if (code === 0) {
        resolve()
        return
      }

      const tail = stderr.trim()
      if (tail) {
        // 单独一行打出来，避免和汇总错误互相截断
        logger.error(`[Bilibili] ffmpeg 错误输出（尾部 ${Math.min(tail.length, 4000)} 字符）:\n${tail.slice(-4000)}`)
      } else {
        logger.error('[Bilibili] ffmpeg 没输出任何错误信息，通常是输入文件损坏或为空')
      }

      const brief = tail ? tail.split('\n').pop().slice(0, 300) : ''
      reject(new Error(`ffmpeg 退出码 ${code}${brief ? ': ' + brief : ''}`))
    })
  })
}

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
  const cached = cacheGet(streamSizeCache, url)
  if (cached !== undefined) return cached

  // 部分 PCDN(mcdn) 节点不支持 HEAD，会回 404 + 十几字节的错误页，
  // 这种 content-length 绝不能当文件大小用，改用 Range 探测总长度
  try {
    const res = await fetchBili(url, { method: 'HEAD', headers })
    const type = (res.headers.get('content-type') || '').toLowerCase()
    const len = parseInt(res.headers.get('content-length'), 10) || 0
    if (res.ok && !type.startsWith('text/') && len > 1024) {
      cacheSet(streamSizeCache, url, len)
      return len
    }
  } catch {
    // 落到 Range 探测
  }

  const probed = await probeSizeByRange(url, headers)
  if (probed > 0) cacheSet(streamSizeCache, url, probed)
  return probed
}

/**
 * 用 Range 请求探真实总长度（兼容不支持 HEAD 的节点）
 */
async function probeSizeByRange(url, headers) {
  try {
    const res = await fetchBili(url, { headers: { ...headers, Range: 'bytes=0-0' } })
    const range = res.headers.get('content-range') || ''
    const matched = range.match(/\/(\d+)\s*$/)
    if (matched) return Number(matched[1])
    const len = parseInt(res.headers.get('content-length'), 10) || 0
    return res.ok ? len : 0
  } catch {
    return 0
  }
}

/**
 * 一条流的所有可用地址，非 PCDN 节点优先
 * mcdn 节点不支持 HEAD，也更容易在大文件上下载到一半断掉
 */
function streamCandidates(stream) {
  if (!stream) return []
  const urls = [
    stream.baseUrl,
    stream.base_url,
    ...(stream.backupUrl || []),
    ...(stream.backup_url || [])
  ].filter(u => typeof u === 'string' && u)

  return [...new Set(urls)].sort((a, b) => {
    const rank = url => (String(url).includes('.mcdn.') ? 1 : 0)
    return rank(a) - rank(b)
  })
}

/**
 * 下载流到文件
 */
async function downloadStream(urls, filePath, headers) {
  const candidates = Array.isArray(urls) ? urls.filter(Boolean) : [urls].filter(Boolean)
  let lastError = null

  for (const url of candidates) {
    try {
      const res = await fetchBili(url, { headers })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)

      // 边下边写盘：音视频流可能有几百 MB，整份读进内存容易把进程撑爆
      await pipeline(res.body, fs.createWriteStream(filePath))
      const size = fs.statSync(filePath).size
      if (size < 1024) throw new Error(`只下到 ${size} 字节，可能是错误响应`)
      return size
    } catch (error) {
      lastError = error
      // 残缺文件不能留，否则 ffmpeg 会把它当完整流去合并
      try {
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath)
      } catch { }
      const host = String(url).split('/')[2] || '未知主机'
      logger.warn(`[Bilibili] 从 ${host} 下载失败: ${error.message}，尝试下一个地址`)
    }
  }

  throw lastError || new Error('所有下载地址都失败')
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
  const playData = await getPlayUrlCached(bvid, cid, targetQn)
  if (!playData?.dash?.video?.length) {
    logger.error(`[Bilibili] 智能画质获取播放地址失败: bvid=${bvid}, cid=${cid}, qn=${targetQn}, dash=${!!playData?.dash}, video=${playData?.dash?.video?.length || 0}, audio=${playData?.dash?.audio?.length || 0}`)
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

  // 获取音频流（部分稿件为无声视频，B站不返回任何音频流）
  const audioStream = playData.dash.audio?.[0]
  if (!videoStream) {
    logger.error(`[Bilibili] 未获取到视频流: bvid=${bvid}, cid=${cid}, qn=${targetQn}, video=${playData.dash.video?.length || 0}`)
    return { qn: actualQn, reason: null }
  }
  if (!audioStream) {
    logger.mark(`[Bilibili] 稿件 ${bvid} 无音频流（无声视频），将仅下载视频轨`)
  }

  // 计算总大小（无音频时只计视频轨）
  const videoSize = await getStreamSize(videoStream.baseUrl, headers)
  const audioSize = audioStream ? await getStreamSize(audioStream.baseUrl, headers) : 0
  const totalSize = videoSize + audioSize

  logger.mark(`[Bilibili] 当前画质: ${getQualityName(actualQn)}, 预估大小: ${formatSize(totalSize)}`)

  // 如果大小在阈值内，不需要降级
  if (totalSize <= threshold) {
    return {
      qn: actualQn,
      size: totalSize,
      videoUrl: videoStream.baseUrl,
      audioUrl: audioStream?.baseUrl || null,
      videoUrls: streamCandidates(videoStream),
      audioUrls: streamCandidates(audioStream),
      reason: null
    }
  }

  // 需要降级，按优先级尝试更低画质
  const originalQn = actualQn

  for (const qn of priority) {
    // 跳过比当前画质更高或相同的
    if (qn >= actualQn) continue

    const lowerPlayData = await getPlayUrlCached(bvid, cid, qn)
    if (!lowerPlayData?.dash?.video?.length) continue

    const lowerVideo = lowerPlayData.dash.video.find(v => v.id <= qn) ||
      lowerPlayData.dash.video[0]
    const lowerAudio = lowerPlayData.dash.audio?.[0]

    if (!lowerVideo) continue

    const lowerVideoSize = await getStreamSize(lowerVideo.baseUrl, headers)
    const lowerAudioSize = lowerAudio ? await getStreamSize(lowerAudio.baseUrl, headers) : 0
    const lowerTotal = lowerVideoSize + lowerAudioSize

    logger.mark(`[Bilibili] 尝试画质: ${getQualityName(lowerVideo.id)}, 预估大小: ${formatSize(lowerTotal)}`)

    // 如果达到目标大小或已是最低画质
    if (lowerTotal <= targetSize || qn === priority[priority.length - 1]) {
      return {
        qn: lowerVideo.id,
        size: lowerTotal,
        videoUrl: lowerVideo.baseUrl,
        audioUrl: lowerAudio?.baseUrl || null,
        videoUrls: streamCandidates(lowerVideo),
        audioUrls: streamCandidates(lowerAudio),
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
    audioUrl: audioStream?.baseUrl || null,
    videoUrls: streamCandidates(videoStream),
    audioUrls: streamCandidates(audioStream),
    reason: null
  }
}

/**
 * 下载并合并视频
 */
async function downloadAndMerge(videoUrl, audioUrl, outputPath, headers, videoUrls = null, audioUrls = null) {
  const tempDir = setting.tempPath
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true })
  }

  // 临时文件名必须按视频唯一：固定叫 video.m4s / audio.m4s 时，
  // 任何并发下载、或手工跑测试脚本，都会互相覆盖/删除对方的文件
  const stem = path.basename(outputPath, path.extname(outputPath))
  const videoPath = path.join(tempDir, `${stem}.video.m4s`)
  const audioPath = path.join(tempDir, `${stem}.audio.m4s`)
  // 无声稿件没有音频流，仅封装视频轨
  const videoSources = Array.isArray(videoUrls) && videoUrls.length ? videoUrls : videoUrl
  const audioSources = Array.isArray(audioUrls) && audioUrls.length ? audioUrls : audioUrl
  const hasAudio = !!audioUrl

  // 使用项目内的 ffmpeg
  const ffmpegPath = path.join(pluginRoot, 'model', 'ffmpeg', 'ffmpeg')

  try {
    logger.mark(`[Bilibili] 开始下载${hasAudio ? '视频和音频' : '视频（该稿件无音轨）'}...`)

    // 下载视频
    await downloadStream(videoSources, videoPath, headers)
    logger.mark('[Bilibili] 视频下载完成')

    // 下载音频
    if (hasAudio) {
      await downloadStream(audioSources, audioPath, headers)
      logger.mark('[Bilibili] 音频下载完成')
    } else {
      logger.mark('[Bilibili] 该稿件无音频轨，跳过音频下载')
    }

    // 合并前先确认输入真的是媒体：CDN 的报错页也会被存成 .m4s，
    // 直接喂给 ffmpeg 只会回一句看不懂的 Invalid data found when processing input
    for (const [label, file] of [['视频', videoPath], ['音频', audioPath]]) {
      if (label === '音频' && !hasAudio) continue

      const stat = fs.existsSync(file) ? fs.statSync(file) : null
      if (!stat || stat.size < 1024) {
        throw new Error(`${label}流只有 ${stat ? stat.size : 0} 字节，明显不是有效媒体，已中止合并`)
      }

      const head = Buffer.alloc(256)
      const fd = fs.openSync(file, 'r')
      try {
        fs.readSync(fd, head, 0, 256, 0)
      } finally {
        fs.closeSync(fd)
      }
      const probe = head.toString('utf8').toLowerCase()
      if (probe.includes('<!doctype') || probe.includes('<html') || probe.trimStart().startsWith('{')) {
        throw new Error(`${label}流里是网页/JSON 错误内容而不是媒体，已中止合并`)
      }

      logger.mark(`[Bilibili] ${label}流大小: ${formatSize(stat.size)}`)
    }

    // FFmpeg合并
    logger.mark('[Bilibili] 开始合并...')

    const ffmpegArgs = hasAudio
      ? ['-i', videoPath, '-i', audioPath, '-c:v', 'copy', '-c:a', 'copy', '-f', 'mp4', '-y', '-loglevel', 'error', outputPath]
      : ['-i', videoPath, '-c:v', 'copy', '-f', 'mp4', '-y', '-loglevel', 'error', outputPath]

    await runFfmpeg(ffmpegPath, ffmpegArgs, 300000)

    logger.mark('[Bilibili] 合并完成')

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
    // 排队而不是直接拒绝：最多再排 MAX_DOWNLOAD_QUEUE 个，超出才回绝
    if (queueCount > MAX_DOWNLOAD_QUEUE) {
      if (sendMessage) await e.reply(`当前有 ${queueCount} 个视频在排队，请稍后再试`, true)
      return null
    }

    queueCount++
    const previous = runningChain
    let release
    runningChain = new Promise(resolve => { release = resolve })

    try {
      if (queueCount > 1 && sendMessage) {
        await e.reply(`已加入下载队列（前面还有 ${queueCount - 1} 个），完成后自动开始`, true)
      }
      await previous
      return await this.downloadInner(e, bvid, pageIndex, sendMessage)
    } finally {
      release()
      queueCount--
    }
  }

  /**
   * 以文件形式发送（超过直接发送上限时走这里）
   */
  async sendAsFile(e, filePath, fileName) {
    const target = e.isGroup ? e.group : e.friend
    if (target?.sendFile) {
      await target.sendFile(filePath, fileName)
      return true
    }
    await e.reply(segment.file(filePath, fileName))
    return true
  }

  /**
   * 实际下载流程（由 download 排队后调用）
   */
  async downloadInner(e, bvid, pageIndex = 0, sendMessage = true) {

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
    const aid = videoInfo.aid

    // 检查时长限制
    const duration = page.duration || videoInfo.duration
    if (videoConfig.durationLimit && duration > videoConfig.durationLimit) {
      if (sendMessage) {
        e.reply(`视频时长 ${Math.floor(duration / 60)} 分钟，超过限制 ${Math.floor(videoConfig.durationLimit / 60)} 分钟，不进行下载`)
      }
      return null
    }

    // 检查是否登录
    const headers = await buildHeaders(null, true)

    // 未登录时使用 HTML5 低画质下载
    if (!headers) {
      return await this.downloadHtml5(e, aid, cid, bvid, pageIndex, sendMessage)
    }

    // 已登录：使用 DASH 高画质下载
    // 智能画质选择
    const qualityResult = await smartQualitySelection(bvid, cid, headers)
    if (!qualityResult.videoUrl) {
      // 需要重新获取播放地址
      const playData = await getPlayUrlCached(bvid, cid, qualityResult.qn)
      // 只要有视频流即可下载；audio 为空只代表稿件本身无声，不视为失败
      if (!playData?.dash?.video?.length) {
        logger.error(`[Bilibili] 获取视频下载地址失败: bvid=${bvid}, cid=${cid}, qn=${qualityResult.qn}, dash=${!!playData?.dash}, video=${playData?.dash?.video?.length || 0}, audio=${playData?.dash?.audio?.length || 0}`)
        if (sendMessage) e.reply('获取视频下载地址失败')
        return null
      }

      qualityResult.videoUrl = playData.dash.video[0].baseUrl
      qualityResult.audioUrl = playData.dash.audio?.[0]?.baseUrl || null
      qualityResult.videoUrls = streamCandidates(playData.dash.video[0])
      qualityResult.audioUrls = streamCandidates(playData.dash.audio?.[0])
      if (!qualityResult.audioUrl) {
        logger.mark(`[Bilibili] 稿件 ${bvid} 无音频流（无声视频），仅下载视频轨`)
      }

      // 重新计算大小（无音频时只计视频轨）
      const vSize = await getStreamSize(qualityResult.videoUrl, headers)
      const aSize = qualityResult.audioUrl ? await getStreamSize(qualityResult.audioUrl, headers) : 0
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

    // 直接发送上限来自配置（video.sendThreshold，默认 100MB），超过则下载后上传群文件
    const directLimit = (videoConfig.sendThreshold || 100) * 1048576
    const useGroupFile = qualityResult.size > directLimit

    isDownloading = true

    let downloadMsg = null
    if (sendMessage) {
      let msg = `开始下载视频，画质: ${getQualityName(qualityResult.qn)}, 大小: ${formatSize(qualityResult.size)}`
      if (qualityResult.reason) {
        msg += `\n${qualityResult.reason}`
      }
      if (useGroupFile) {
        msg += `\n超过 ${videoConfig.sendThreshold || 100}MB，下载完成后上传为群文件`
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
        headers,
        qualityResult.videoUrls,
        qualityResult.audioUrls
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

      // 超过直接发送上限时改上传群文件，避免大视频直接丢失
      if (useGroupFile) {
        await this.sendAsFile(e, outputPath, `${bvid}_p${pageIndex + 1}.mp4`)
        setTimeout(() => {
          if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath)
        }, 60000)
        return null
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
   * HTML5 低画质下载（无需登录）
   * @param {object} e 消息事件
   * @param {number} aid 视频aid
   * @param {number} cid 视频cid
   * @param {string} bvid BV号
   * @param {number} pageIndex 分P索引
   * @param {boolean} sendMessage 是否发送消息
   */
  async downloadHtml5(e, aid, cid, bvid, pageIndex, sendMessage = true) {
    isDownloading = true

    const videoConfig = setting.getConfig().video || {}

    let downloadMsg = null
    if (sendMessage) {
      downloadMsg = await e.reply('开始下载视频 (360P)...', true)
    }

    try {
      // 获取 HTML5 播放地址
      const playData = await api.getPlayUrlHtml5(aid, cid, 16)
      if (!playData?.durl?.[0]?.url) {
        if (sendMessage) e.reply('获取视频地址失败')
        return null
      }

      const videoUrl = playData.durl[0].url
      // 接口会一并给出成品大小，先按配置判断要不要下、要不要走群文件
      const declaredSize = playData.durl[0].size || 0
      const fileSizeLimit = (videoConfig.fileSizeLimit || 0) * 1048576
      if (fileSizeLimit > 0 && declaredSize > fileSizeLimit) {
        if (sendMessage) {
          await e.reply(`视频大小 ${formatSize(declaredSize)} 超过限制 ${videoConfig.fileSizeLimit}MB，不进行下载`)
        }
        return null
      }
      const directLimit = (videoConfig.sendThreshold || 100) * 1048576
      const useGroupFile = declaredSize > directLimit

      // 下载视频
      const tempDir = setting.tempPath
      if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true })
      }
      const outputPath = path.join(tempDir, `${bvid}_p${pageIndex + 1}.mp4`)

      logger.mark('[Bilibili] 开始下载 HTML5 视频...')

      const res = await fetchBili(videoUrl, {
        headers: {
          ...DEFAULT_HEADERS,
          Referer: 'https://www.bilibili.com/'
        }
      })

      if (!res.ok) {
        if (sendMessage) e.reply('视频下载失败')
        return null
      }

      // 边下边写盘，避免整份视频进内存
      await pipeline(res.body, fs.createWriteStream(outputPath))

      logger.mark('[Bilibili] HTML5 视频下载完成')

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

      if (useGroupFile) {
        await this.sendAsFile(e, outputPath, `${bvid}_p${pageIndex + 1}.mp4`)
        setTimeout(() => {
          if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath)
        }, 60000)
        return null
      }

      const video = segment.video(outputPath)

      // 发送后延迟删除临时文件
      setTimeout(() => {
        if (fs.existsSync(outputPath)) {
          fs.unlinkSync(outputPath)
        }
      }, 60000)

      return video
    } catch (error) {
      logger.error(`[Bilibili] HTML5 下载失败: ${error.message}`)
      if (sendMessage) e.reply('视频下载失败')
      return null
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
    const headers = await buildHeaders(null, true)
    if (!headers) return 0

    const playData = await getPlayUrlCached(bvid, cid, qn)
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
  startupReset,
  resetDownloadQueue,
  cleanTempFiles,
  smartQualitySelection,
  downloadAndMerge,
  getQualityName,
  formatSize,
  getStreamSize,
  resetDownloadLock,
  getDownloadStatus
}
