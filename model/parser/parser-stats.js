/**
 * 解析结果的互动数据整理
 * 只用手上接口已有的字段，不额外发请求；"缺失"与"真实的 0"分开处理
 */

// 各平台字段别名，按优先级排列
const FIELDS = {
  douyin: {
    likes: ['digg_count', 'diggCount'],
    comments: ['comment_count', 'commentCount'],
    shares: ['share_count', 'shareCount'],
    views: ['play_count', 'playCount'],
    favorites: ['collect_count', 'collectCount']
  },
  kuaishou: {
    likes: ['likeCount', 'like_count', 'likeCnt'],
    comments: ['commentCount', 'comment_count', 'commentCnt'],
    shares: ['shareCount', 'share_count', 'shareCnt'],
    views: ['viewCount', 'view_count', 'viewCnt'],
    favorites: ['collectCount', 'collect_count', 'collectCnt']
  }
}

/**
 * 把 "1.2万" / "3,456" / 数字统一成整数，无法识别时返回 null
 */
function countValue(value) {
  if (typeof value !== 'number' && typeof value !== 'string') return null

  if (typeof value === 'string') {
    const matched = value.trim().replace(/[,，]/g, '').match(/^(\d+(?:\.\d+)?)\s*([万亿wW]?)\+?$/)
    if (!matched) return null
    const unit = { 万: 1e4, 亿: 1e8, w: 1e4, W: 1e4 }[matched[2]] || 1
    value = Number(matched[1]) * unit
  }

  return Number.isFinite(value) && value >= 0 ? Math.floor(value) : null
}

/**
 * 从若干候选对象里提取互动数据
 * @param {string} platform douyin | kuaishou
 * @param {...object} sources 依次尝试的数据来源
 */
export function extractVideoStats(platform, ...sources) {
  const result = {}

  for (const [key, aliases] of Object.entries(FIELDS[platform] || {})) {
    result[key] = null

    for (const source of sources) {
      for (const alias of aliases) {
        const value = countValue(source?.[alias])
        // 抖音公开详情里 play_count=0 是"未公开播放量"的占位值，不能当成 0 播放
        if (platform === 'douyin' && key === 'views' && value === 0) continue
        if (value !== null) {
          result[key] = value
          break
        }
      }
      if (result[key] !== null) break
    }
  }

  return result
}

/**
 * 数字转紧凑写法：1.2万 / 3.4亿
 */
export function formatVideoCount(value) {
  const count = countValue(value)
  if (count === null) return '—'

  const compact = (unit, suffix) => `${Number((count / unit).toFixed(1))}${suffix}`
  if (count >= 99995000) return compact(1e8, '亿')
  if (count >= 10000) return compact(1e4, '万')
  return String(count)
}

/**
 * 生成卡片数据栏的条目：点赞/评论/转发恒显示，其余有值才显示
 */
export function buildVideoStats(result) {
  if (result.live) return []

  const stats = result.stats || {}
  return [
    ['likes', '点赞'],
    ['comments', '评论'],
    ['shares', '转发'],
    ['views', '播放'],
    ['favorites', '收藏']
  ]
    .filter(([key], index) => index < 3 || countValue(stats[key]) !== null)
    .map(([key, label]) => ({ key, label, value: formatVideoCount(stats[key]) }))
}
