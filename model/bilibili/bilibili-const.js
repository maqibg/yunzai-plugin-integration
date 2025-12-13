/**
 * Bilibili 常量定义
 * 包含画质映射、API端点、WBI签名参数等
 */

// 画质ID映射表
export const QN_MAP = {
  16: { name: '360P', desc: '流畅' },
  32: { name: '480P', desc: '清晰' },
  64: { name: '720P', desc: '高清' },
  74: { name: '720P60', desc: '高清60帧' },
  80: { name: '1080P', desc: '高清' },
  112: { name: '1080P+', desc: '高码率' },
  116: { name: '1080P60', desc: '高清60帧' },
  120: { name: '4K', desc: '超清' },
  125: { name: 'HDR', desc: '真彩色' },
  126: { name: '杜比视界', desc: 'Dolby Vision' },
  127: { name: '8K', desc: '超高清' }
}

// 画质降级优先级（从高到低）
export const QUALITY_PRIORITY = [127, 126, 125, 120, 116, 112, 80, 74, 64, 32, 16]

// WBI签名混淆表
export const MIXIN_KEY_ENC_TAB = [
  46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35,
  27, 43, 5, 49, 33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13,
  37, 48, 7, 16, 24, 55, 40, 61, 26, 17, 0, 1, 60, 51, 30, 4,
  22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11, 36, 20, 34, 44, 52
]

// BiliTicket签名密钥
export const BILI_TICKET_HMAC_KEY = 'XgwSnGZ1p'

// API端点
export const API_ENDPOINTS = {
  // 视频相关（普通版本，无需登录）
  VIDEO_INFO: 'https://api.bilibili.com/x/web-interface/view',
  VIDEO_PLAYURL: 'https://api.bilibili.com/x/player/wbi/playurl',
  VIDEO_PLAYURL_HTML5: 'https://api.bilibili.com/x/player/playurl',
  VIDEO_PAGELIST: 'https://api.bilibili.com/x/player/pagelist',
  VIDEO_ONLINE: 'https://api.bilibili.com/x/player/online/total',
  VIDEO_HAS_LIKE: 'https://api.bilibili.com/x/web-interface/archive/has/like',
  VIDEO_COINS: 'https://api.bilibili.com/x/web-interface/archive/coins',
  VIDEO_FAVOURED: 'https://api.bilibili.com/x/v2/fav/video/favoured',
  VIDEO_LIKE: 'https://api.bilibili.com/x/web-interface/archive/like',
  VIDEO_COIN: 'https://api.bilibili.com/x/web-interface/coin/add',
  VIDEO_TRIPLE: 'https://api.bilibili.com/x/web-interface/archive/like/triple',

  // 收藏相关
  FAV_DEAL: 'https://api.bilibili.com/x/v3/fav/resource/deal',
  FAV_LIST: 'https://api.bilibili.com/x/v3/fav/folder/created/list-all',

  // 用户相关
  USER_CARD: 'https://api.bilibili.com/x/web-interface/card',
  USER_NAV: 'https://api.bilibili.com/x/web-interface/nav',
  USER_SPACE_ARC: 'https://api.bilibili.com/x/space/wbi/arc/search',
  USER_RELATION: 'https://api.bilibili.com/x/relation/modify',

  // 动态相关
  DYNAMIC_DETAIL: 'https://api.bilibili.com/x/polymer/web-dynamic/v1/detail',
  DYNAMIC_DETAIL_OLD: 'https://api.vc.bilibili.com/dynamic_svr/v1/dynamic_svr/get_dynamic_detail',

  // 评论相关
  REPLY_MAIN: 'https://api.bilibili.com/x/v2/reply',
  REPLY_REPLY: 'https://api.bilibili.com/x/v2/reply/reply',
  REPLY_ADD: 'https://api.bilibili.com/x/v2/reply/add',

  // 登录相关
  QR_GENERATE: 'https://passport.bilibili.com/x/passport-login/web/qrcode/generate',
  QR_POLL: 'https://passport.bilibili.com/x/passport-login/web/qrcode/poll',
  COOKIE_INFO: 'https://passport.bilibili.com/x/passport-login/web/cookie/info',
  COOKIE_REFRESH: 'https://passport.bilibili.com/x/passport-login/web/cookie/refresh',
  CONFIRM_REFRESH: 'https://passport.bilibili.com/x/passport-login/web/confirm/refresh',

  // 其他
  FINGER_SPI: 'https://api.bilibili.com/x/frontend/finger/spi',
  GEN_WEB_TICKET: 'https://api.bilibili.com/bapis/bilibili.api.ticket.v1.Ticket/GenWebTicket'
}

// 评论区类型
export const REPLY_TYPE = {
  VIDEO: 1,
  DYNAMIC: 17,
  ARTICLE: 12,
  PHOTO_ALBUM: 11
}

// 链接匹配正则
export const URL_PATTERNS = {
  // BV号
  BV: /BV[a-zA-Z0-9]{10}/,
  // av号
  AV: /av(\d+)/i,
  // 视频链接
  VIDEO_WWW: /https?:\/\/www\.bilibili\.com\/video\/([\w]+)/,
  VIDEO_M: /https?:\/\/m\.bilibili\.com\/video\/([\w]+)/,
  // 动态链接
  DYNAMIC_WWW: /https?:\/\/www\.bilibili\.com\/opus\/([\w]+)/,
  DYNAMIC_M: /https?:\/\/m\.bilibili\.com\/opus\/([\w]+)/,
  DYNAMIC_M2: /https?:\/\/m\.bilibili\.com\/dynamic\/([\w]+)/,
  DYNAMIC_T: /https?:\/\/t\.bilibili\.com\/([\w]+)/,
  // 短链接
  SHORT_LINK: /https?:\/\/b23\.tv\/([\w]+)/,
  // 直播链接
  LIVE: /https?:\/\/live\.bilibili\.com\/(\d+)/
}

// 请求头
export const DEFAULT_HEADERS = {
  Accept: 'application/json, text/plain, */*',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  Referer: 'https://www.bilibili.com/'
}

// Redis键前缀
export const REDIS_PREFIX = {
  BILI_TICKET: 'bilibili:ticket',
  PAGE_SELECT: 'bilibili:page_select:',
  COOLDOWN: 'bilibili:cooldown:',
  PUSH: 'bilibili:push:'
}

// 临时文件目录
export const TEMP_DIR = 'temp/bilibili'

// 缓存数据目录
export const DATA_DIR = 'data/bilibili'
