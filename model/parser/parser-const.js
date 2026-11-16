/**
 * 视频/图文链接解析 常量定义
 * 支持 抖音 / 快手 / 小红书 / 小黑盒（B站由 model/bilibili 独立处理）
 */

// 桌面端 UA：小黑盒、快手网页接口用
export const PC_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'

// 移动端 UA：抖音/快手/小红书的分享页只在移动端 UA 下返回内嵌数据
export const MOBILE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1'

// 平台标识 → 展示名
export const PLATFORM_NAME = {
  douyin: '抖音',
  kuaishou: '快手',
  xiaohongshu: '小红书',
  heybox: '小黑盒'
}

// 平台标识 → 配置开关字段名（对应 config 中 parse 段的同名键）
export const PLATFORM_SWITCH = {
  douyin: 'douyin',
  kuaishou: 'kuaishou',
  xiaohongshu: 'xiaohongshu',
  heybox: 'heybox'
}

// 链接识别，顺序即优先级；同一平台内先短链后完整链接
// 完整链接只认作品页路径：主页、搜索页、合集页贴进群里不该触发解析
export const URL_PATTERNS = {
  DOUYIN_LIVE: /https?:\/\/(?:live\.douyin\.com\/\d+|www\.douyin\.com\/live\/\d+)[^\s'"<>]*/i,
  DOUYIN_SHORT: /https?:\/\/v\.douyin\.com\/[A-Za-z0-9_-]+/i,
  DOUYIN_FULL: /https?:\/\/(?:www\.)?(?:douyin|iesdouyin)\.com\/(?:video|note|share\/(?:video|note))\/[^\s'"<>]*/i,
  KUAISHOU_SHORT: /https?:\/\/v\.kuaishou\.com\/[A-Za-z0-9_-]+/i,
  KUAISHOU_FULL: /https?:\/\/(?:www\.|v\.m\.|m\.)?(?:kuaishou|chenzhongtech|gifshow)\.com\/(?:short-video|photo|fw)\/[^\s'"<>]*/i,
  XHS_SHORT: /https?:\/\/xhslink\.(?:com|cn)\/[A-Za-z0-9/_-]+/i,
  XHS_NOTE: /https?:\/\/(?:www\.)?xiaohongshu\.com\/(?:explore|discovery\/item)\/[0-9a-fA-F]+[^\s'"<>]*/i,
  HEYBOX: /https?:\/\/(?:[a-z0-9-]+\.)?(?:xiaoheihe\.cn|heybox\.cn)\/(?:app\/bbs\/link|community|link|bbs\/app\/api\/web\/share)[^\s'"<>]*/i
}

// Redis键前缀
export const REDIS_PREFIX = {
  PARSE_COOLDOWN: 'parser:cooldown:'
}

// 临时文件目录（与 temp/bilibili 并列）
export const TEMP_DIR = 'temp/parser'

// 抖音长视频：即便未超体积上限，几分钟的片子也容易把适配器发视频流程拖崩，单独甩直链
export const DOUYIN_LONG_VIDEO_SECONDS = 180

/**
 * 从一段文本里识别平台与链接
 * @param {string} text 消息原文（含 JSON/XML 卡片内容）
 * @returns {{platform: string, url: string} | null}
 */
export function detectPlatform(text) {
  if (!text) return null

  let matched = text.match(URL_PATTERNS.DOUYIN_LIVE)
  if (matched) return { platform: 'douyin', url: matched[0] }
  matched = text.match(URL_PATTERNS.DOUYIN_SHORT)
  if (matched) return { platform: 'douyin', url: matched[0] }
  matched = text.match(URL_PATTERNS.DOUYIN_FULL)
  if (matched) return { platform: 'douyin', url: matched[0] }

  matched = text.match(URL_PATTERNS.KUAISHOU_SHORT)
  if (matched) return { platform: 'kuaishou', url: matched[0] }
  matched = text.match(URL_PATTERNS.KUAISHOU_FULL)
  if (matched) return { platform: 'kuaishou', url: matched[0] }

  matched = text.match(URL_PATTERNS.XHS_SHORT)
  if (matched) return { platform: 'xiaohongshu', url: matched[0] }
  matched = text.match(URL_PATTERNS.XHS_NOTE)
  if (matched) return { platform: 'xiaohongshu', url: matched[0] }

  matched = text.match(URL_PATTERNS.HEYBOX)
  if (matched) return { platform: 'heybox', url: matched[0] }

  return null
}
