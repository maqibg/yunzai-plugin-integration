/**
 * 提瓦特小助手 API 调用
 */
import fetch from 'node-fetch'

// 提瓦特小助手请求头（模拟微信小程序）
const headers = {
  referer: 'https://servicewechat.com/wx2ac9dce11213c3a8/192/page-frame.html',
  'user-agent': 'Mozilla/5.0 (Linux; Android 12; SM-G977N Build/SP1A.210812.016; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/86.0.4240.99 XWEB/4375 MMWEBSDK/20221011 Mobile Safari/537.36 MMWEBID/4357 MicroMessenger/8.0.30.2244(0x28001E44) WeChat/arm64 Weixin GPVersion/1 NetType/WIFI Language/zh_CN ABI/arm64 MiniProgramEnv/android'
}

// API 地址映射
const apiMap = {
  single: 'https://api.lelaer.com/ys/getDamageResult.php',
  team: 'https://api.lelaer.com/ys/getTeamResult.php'
}

/**
 * 获取提瓦特小助手数据
 * @param {Object} body 请求体
 * @param {String} type 类型: 'single' | 'team'
 * @returns {Promise<Object>} API 返回数据
 */
export async function getTeyvatData(body, type = 'single') {
  try {
    const response = await fetch(apiMap[type], {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...headers
      },
      body: JSON.stringify(body),
      timeout: 15000
    })
    return await response.json()
  } catch (error) {
    logger.error(`[提瓦特小助手] API 请求失败: ${error.message}`)
    return { error: '提瓦特小助手接口无法访问或返回错误' }
  }
}

/**
 * 请求 Enka API 获取面板数据
 * @param {String} uid 用户 UID
 * @returns {Promise<Object>} 面板数据
 */
export async function requestEnka(uid) {
  const enkaMirrors = [
    'https://enka.network',
    'http://profile.microgg.cn'
  ]

  // B 服优先从 MicroGG API 尝试
  if (Number(uid[0]) === 5) {
    enkaMirrors.reverse()
  }

  let resJson = {}
  for (let idx = 0; idx < enkaMirrors.length; idx++) {
    const root = enkaMirrors[idx]
    const apiName = root.includes('microgg') ? 'MicroGG API' : 'Enka API'

    try {
      const res = await fetch(`${root}/api/uid/${uid}`, {
        headers: {
          Accept: 'application/json',
          'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8,en-US;q=0.7',
          'Cache-Control': 'no-cache',
          Cookie: 'locale=zh-CN',
          Referer: 'https://enka.network/',
          'User-Agent': 'GsPanel/0.2'
        },
        follow: 1,
        timeout: 20000
      })

      const errorMsg = {
        400: `玩家 ${uid} UID 格式错误！`,
        404: `玩家 ${uid} 不存在！`,
        424: `${apiName} 正在维护中！`,
        429: `${apiName} 访问过于频繁！`,
        500: `${apiName} 服务器普通故障！`,
        503: `${apiName} 服务器严重错误！`
      }

      const status = String(res.status)
      if (['400', '404'].includes(status)) {
        return { error: errorMsg[status] }
      } else if (status in errorMsg) {
        if (idx === enkaMirrors.length - 1) {
          return { error: errorMsg[status] }
        }
        logger.error(errorMsg[status])
        continue
      }

      resJson = await res.json()
      break
    } catch (e) {
      if (idx === enkaMirrors.length - 1) {
        logger.error(e)
        return { error: `[${e.name}] 暂时无法访问面板数据接口..` }
      }
      logger.info(`[提瓦特小助手] 从 ${apiName} 获取面板失败，正在自动切换镜像重试...`)
    }
  }

  if (!resJson.playerInfo) {
    return { error: `玩家 ${uid} 返回信息不全，接口可能正在维护..` }
  }
  if (!resJson.avatarInfoList) {
    return { error: `玩家 ${uid} 的角色展柜详细数据已隐藏！` }
  }
  if (!resJson.playerInfo.showAvatarInfoList) {
    return { error: `玩家 ${uid} 的角色展柜内还没有角色哦！` }
  }

  logger.info('[提瓦特小助手] Enka 请求成功')
  return resJson
}

/**
 * 获取服务器标识
 * @param {String} uid UID
 * @param {Boolean} forApi 是否用于 API 请求
 * @returns {String} 服务器标识
 */
export function getServer(uid, forApi = false) {
  const serverMap = {
    1: 'cn_gf01',   // 官服
    2: 'cn_gf01',   // 官服
    5: 'cn_qd01',   // B服
    6: 'os_usa',    // 美服
    7: 'os_euro',   // 欧服
    8: 'os_asia',   // 亚服
    9: 'os_cht'     // 港澳台服
  }

  const firstDigit = uid[0]
  if (forApi && ['1', '2'].includes(firstDigit)) {
    return undefined // 国服不需要传 server
  }
  return serverMap[firstDigit] || 'cn_gf01'
}

export default { getTeyvatData, requestEnka, getServer }
