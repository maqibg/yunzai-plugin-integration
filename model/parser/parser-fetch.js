/**
 * 解析器公用请求与文件工具
 * 统一超时、UA 注入、流式下载与体积控制
 */
import fs from 'node:fs'
import path from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { PC_UA, TEMP_DIR } from './parser-const.js'

const _path = process.cwd()
const pluginRoot = path.join(_path, 'plugins', 'yunzai-plugin-integration')

export const tempPath = path.join(pluginRoot, TEMP_DIR)

const DEFAULT_TIMEOUT = 15000

/**
 * 确保临时目录存在
 */
export function ensureTempDir() {
  if (!fs.existsSync(tempPath)) {
    fs.mkdirSync(tempPath, { recursive: true })
  }
  return tempPath
}

/**
 * 带超时的请求封装，默认补上桌面端 UA
 * @param {string} url 请求地址
 * @param {object} options fetch 选项
 * @param {number} timeoutMs 超时毫秒
 */
export async function fetchWithTimeout(url, options = {}, timeoutMs = DEFAULT_TIMEOUT) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  const headers = { 'User-Agent': PC_UA, ...(options.headers || {}) }

  try {
    return await fetch(url, { ...options, headers, signal: controller.signal })
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
 * 探测远端体积
 * 部分 CDN 不支持 HEAD，回落到 Range 探测；都拿不到时返回 0（交由下载阶段边下边卡）
 */
export async function probeRemoteSize(url, headers = {}) {
  const request = async (method) => {
    const option = method === 'GET'
      ? { method, headers: { ...headers, Range: 'bytes=0-0' } }
      : { method, headers }
    const res = await fetchWithTimeout(url, option)

    try {
      const range = res.headers.get('content-range') || ''
      const matched = range.match(/\/(\d+)\s*$/)
      if (matched) return Number(matched[1])
      const len = parseInt(res.headers.get('content-length'), 10) || 0
      // Range GET 返回 206 时 content-length 只是 1 字节，不能当总长
      if (method === 'GET' && res.status === 206) return 0
      return res.ok ? len : 0
    } finally {
      // 只读响应头，body 必须显式关掉，否则连接会一直挂在连接池里
      try { await res.body?.cancel() } catch { }
    }
  }

  try {
    const size = await request('HEAD')
    if (size) return size
  } catch { }

  try {
    return await request('GET')
  } catch {
    return 0
  }
}

/**
 * 流式下载到本地文件，按 maxMB 边下边卡体积
 * 超时覆盖整个传输过程（不是只等响应头）：CDN 卡住时 pipeline 也能被中断，不至于把解析流程挂死
 */
export async function downloadToFile(url, headers = {}, dest, maxMB = 0, timeoutMs = 180000) {
  const res = await fetch(url, {
    headers: { 'User-Agent': PC_UA, ...headers },
    signal: AbortSignal.timeout(timeoutMs)
  })
  if (!res.ok || !res.body) throw new Error(`下载失败 HTTP ${res.status}`)

  const limit = maxMB > 0 ? maxMB * 1048576 : 0
  const declared = parseInt(res.headers.get('content-length'), 10) || 0
  if (limit && declared && declared > limit) {
    try { await res.body.cancel() } catch { }
    throw new Error(`体积 ${(declared / 1048576).toFixed(1)}MB 超过上限 ${maxMB}MB`)
  }

  let received = 0
  const guard = new Transform({
    transform(chunk, _enc, callback) {
      received += chunk.length
      if (limit && received > limit) {
        callback(new Error(`体积超过上限 ${maxMB}MB`))
        return
      }
      callback(null, chunk)
    }
  })

  try {
    await pipeline(Readable.fromWeb(res.body), guard, fs.createWriteStream(dest))
  } catch (error) {
    fs.unlink(dest, () => { })
    throw error
  }

  const size = fs.statSync(dest).size
  if (size < 1024) {
    fs.unlink(dest, () => { })
    throw new Error(`只下到 ${size} 字节，可能是错误响应`)
  }
  return dest
}

/**
 * 格式化文件大小
 */
export function formatSize(bytes) {
  if (bytes < 1024) return bytes + 'B'
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + 'KB'
  if (bytes < 1073741824) return (bytes / 1048576).toFixed(1) + 'MB'
  return (bytes / 1073741824).toFixed(2) + 'GB'
}

/**
 * 格式化时长（秒 → m:ss）
 */
export function formatDuration(seconds) {
  const total = parseInt(seconds) || 0
  const minute = Math.floor(total / 60)
  const second = total % 60
  return `${minute}:${String(second).padStart(2, '0')}`
}

/**
 * 清理临时目录里超龄的文件
 * 下载中途被 kill 会留下半截视频，发完即删的定时器也会随进程消失，
 * 所以除了"发完就删"再留一层按时间的兜底
 * @param {number} maxAgeMs 超过这个时长（毫秒）的文件会被删掉
 * @returns {number} 删除的文件数
 */
export function cleanTempFiles(maxAgeMs = 3600 * 1000) {
  if (!fs.existsSync(tempPath)) return 0

  const expireBefore = Date.now() - maxAgeMs
  let removed = 0

  for (const name of fs.readdirSync(tempPath)) {
    const filePath = path.join(tempPath, name)
    try {
      if (fs.statSync(filePath).mtimeMs < expireBefore) {
        fs.unlinkSync(filePath)
        removed++
      }
    } catch (error) {
      logger.warn(`[解析] 清理临时文件失败 [${name}]: ${error.message}`)
    }
  }

  return removed
}
