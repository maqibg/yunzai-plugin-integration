/**
 * Bilibili 登录管理模块
 * 负责扫码登录、Cookie刷新等
 */
import QRCode from 'qrcode'
import crypto from 'node:crypto'
import setting from '../../model/bilibili/bilibili-setting.js'
import api, { getBuvid, getBiliTicket, fetchBili } from '../../model/bilibili/bilibili-api.js'
import { API_ENDPOINTS, DEFAULT_HEADERS } from '../../model/bilibili/bilibili-const.js'

export class BilibiliLogin extends plugin {
  constructor() {
    super({
      name: '[Bilibili]登录管理',
      dsc: 'B站扫码登录和Cookie管理',
      event: 'message',
      priority: -120,
      rule: [
        {
          reg: '^#?(b站|B站|bili|bilibili)(扫码)?登(录|陆|路)$',
          fnc: 'login'
        },
        {
          reg: '^#?(查看)?(我的)?(b站|B站|bili|bilibili)账号$',
          fnc: 'showAccount'
        },
        {
          reg: '^#?(强制)?(刷新)(b站|B站|bili|bilibili)(ck|cookie)$',
          fnc: 'refreshCookie'
        },
        {
          reg: '^#?(删除)(b站|B站|bili|bilibili)(ck|cookie)$',
          fnc: 'deleteCookie'
        },
        {
          reg: '^#?清(空|除)(b站|B站|bili|bilibili)缓存$',
          fnc: 'clearCache'
        }
      ]
    })
  }

  /**
   * 扫码登录
   */
  async login(e) {
    if (!e.isMaster) {
      await e.reply('仅主人可执行登录操作')
      return true
    }

    try {
      // 获取二维码
      const res = await fetchBili(API_ENDPOINTS.QR_GENERATE, { headers: DEFAULT_HEADERS })
      const json = await res.json()

      if (json.code !== 0) {
        await e.reply('获取登录二维码失败')
        return true
      }

      const qrcodeUrl = json.data.url
      const qrcodeKey = json.data.qrcode_key

      // 生成二维码图片
      const qrDataUrl = await QRCode.toDataURL(qrcodeUrl)
      const qrImage = segment.image(qrDataUrl.replace('data:image/png;base64,', 'base64://'))

      const msg = await e.reply(['请在120秒内使用B站APP扫码登录', qrImage], true, { recallMsg: 120 })
      const msgId = msg?.message_id || msg?.data?.message_id

      // 轮询扫码状态
      let scanned = false
      let scanMsg = null

      for (let i = 0; i < 120; i++) {
        await this.sleep(1000)

        const pollRes = await fetchBili(`${API_ENDPOINTS.QR_POLL}?qrcode_key=${qrcodeKey}`, {
          headers: DEFAULT_HEADERS
        })
        const pollJson = await pollRes.json()
        const data = pollJson.data

        // 已扫码待确认
        if (data.code === 86090 && !scanned) {
          scanned = true
          scanMsg = await e.reply('二维码已扫描，请确认登录')

          // 撤回二维码
          if (msgId) {
            try {
              if (e.isGroup) await e.group.recallMsg(msgId)
              else await e.friend.recallMsg(msgId)
            } catch { }
          }
        }

        // 二维码失效
        if (data.code === 86038) {
          await e.reply('二维码已失效，请重新获取')
          return true
        }

        // 登录成功
        if (data.code === 0) {
          // 撤回确认消息
          if (scanMsg?.message_id) {
            try {
              if (e.isGroup) await e.group.recallMsg(scanMsg.message_id)
              else await e.friend.recallMsg(scanMsg.message_id)
            } catch { }
          }

          // 提取Cookie
          let cookie = pollRes.headers.get('set-cookie')
          cookie = this.parseCookie(cookie)

          // 获取buvid
          const buvid = await getBuvid(cookie)
          if (buvid) {
            cookie = `buvid3=${buvid.buvid3};buvid4=${buvid.buvid4};${cookie}`
          }

          // 生成BiliTicket
          const csrfMatch = cookie.match(/bili_jct=([\w]+)/)
          if (csrfMatch) {
            await getBiliTicket(csrfMatch[1])
          }

          // 先校验新账号，校验通过才覆盖本地 Cookie，避免把原本能用的 Cookie 冲掉
          const userInfo = await api.getMyInfo(cookie)
          if (!userInfo) {
            await e.reply('扫码成功但账号校验失败（可能被风控或网络异常），已保留原 Cookie，请稍后重试')
            return true
          }

          // 保存Cookie
          setting.setCookie(cookie, data.refresh_token)

          await e.reply([
            'B站登录成功！\n',
            segment.image(userInfo.face),
            `\n账号: ${userInfo.uname}`,
            `\n等级: Lv.${userInfo.level_info?.current_level || 0}`,
            `\n硬币: ${userInfo.money || 0}`
          ])

          return true
        }
      }

      await e.reply('登录超时，请重新扫码')
    } catch (error) {
      logger.error(`[Bilibili] 登录异常: ${error.message}`)
      await e.reply(`登录失败: ${error.message}`)
    }

    return true
  }

  /**
   * 显示账号信息
   */
  async showAccount(e) {
    if (!e.isMaster) return false

    const cookie = setting.getCookie()
    if (!cookie) {
      await e.reply('未登录B站账号，请先执行 #b站登录')
      return true
    }

    const userInfo = await api.getMyInfo()
    if (!userInfo) {
      await e.reply('获取账号信息失败，Cookie可能已失效')
      return true
    }

    await e.reply([
      segment.image(userInfo.face),
      `\n账号: ${userInfo.uname}`,
      `\nUID: ${userInfo.mid}`,
      `\n等级: Lv.${userInfo.level_info?.current_level || 0}`,
      `\n硬币: ${userInfo.money || 0}`,
      `\n大会员: ${userInfo.vipStatus ? '是' : '否'}`
    ])

    return true
  }

  /**
   * 刷新Cookie
   */
  async refreshCookie(e) {
    if (!e.isMaster) return false

    const cookie = setting.getCookie()
    if (!cookie) {
      await e.reply('未登录B站账号')
      return true
    }

    const refreshToken = setting.getRefreshToken()
    if (!refreshToken) {
      await e.reply('缺少刷新令牌，请重新登录')
      return true
    }

    const force = e.msg.includes('强制')

    try {
      // 检查是否需要刷新
      const csrfMatch = cookie.match(/bili_jct=([\w]+)/)
      const csrf = csrfMatch ? csrfMatch[1] : ''

      const headers = { ...DEFAULT_HEADERS, Cookie: cookie }
      const checkRes = await fetchBili(`${API_ENDPOINTS.COOKIE_INFO}?csrf=${csrf}`, { headers })
      const checkJson = await checkRes.json()

      if (checkJson.code !== 0) {
        await e.reply(`检查失败: ${checkJson.message}`)
        return true
      }

      if (!checkJson.data.refresh && !force) {
        await e.reply('Cookie状态正常，无需刷新。如需强制刷新请发送：#强制刷新b站ck')
        return true
      }

      // 获取refresh_csrf
      const timestamp = checkJson.data.timestamp
      const correspondPath = await this.getCorrespondPath(timestamp)

      const csrfRes = await fetchBili(`https://www.bilibili.com/correspond/1/${correspondPath}`, { headers })
      const csrfText = await csrfRes.text()
      const refreshCsrfMatch = csrfText.match(/id="1-name">([\w]+)<\/div>/)

      if (!refreshCsrfMatch) {
        await e.reply('获取刷新凭证失败')
        return true
      }

      const refreshCsrf = refreshCsrfMatch[1]

      // 刷新Cookie
      const refreshUrl = `${API_ENDPOINTS.COOKIE_REFRESH}?csrf=${csrf}&source=main_web&refresh_csrf=${refreshCsrf}&refresh_token=${refreshToken}`
      headers.Accept = 'application/x-www-form-urlencoded'

      const refreshRes = await fetchBili(refreshUrl, { method: 'POST', headers })
      const refreshJson = await refreshRes.json()

      if (refreshJson.code !== 0) {
        await e.reply(`刷新失败: ${refreshJson.message}`)
        return true
      }

      // 提取新Cookie
      let newCookie = refreshRes.headers.get('set-cookie')
      newCookie = this.parseCookie(newCookie)

      // 获取buvid
      const buvid = await getBuvid(newCookie)
      if (buvid) {
        newCookie = `buvid3=${buvid.buvid3};buvid4=${buvid.buvid4};${newCookie}`
      }

      const newRefreshToken = refreshJson.data.refresh_token

      // 先校验新 Cookie，能拿到账号信息才继续：
      // 确认刷新会让旧 refresh_token 失效，校验失败时若已确认刷新，旧 Cookie 就再也刷不动了
      const userInfo = await api.getMyInfo(newCookie)
      if (!userInfo) {
        await e.reply('Cookie 已刷新但校验失败（可能被风控或网络异常），已保留原 Cookie，请稍后重试')
        return true
      }

      // 确认刷新（使旧Token失效）
      const newCsrfMatch = newCookie.match(/bili_jct=([\w]+)/)
      const newCsrf = newCsrfMatch ? newCsrfMatch[1] : ''

      await fetchBili(`${API_ENDPOINTS.CONFIRM_REFRESH}?csrf=${newCsrf}&refresh_token=${refreshToken}`, {
        method: 'POST',
        headers: { ...DEFAULT_HEADERS, Cookie: newCookie }
      })

      // 生成新BiliTicket（会写入 Redis，放在校验通过之后，避免旧 Cookie 配上新账号的票）
      await getBiliTicket(newCsrf)

      // 保存新Cookie
      setting.setCookie(newCookie, newRefreshToken)

      await e.reply([
        'B站Cookie刷新成功！\n',
        segment.image(userInfo.face),
        `\n账号: ${userInfo.uname}`,
        `\n等级: Lv.${userInfo.level_info?.current_level || 0}`
      ])
    } catch (error) {
      logger.error(`[Bilibili] 刷新Cookie异常: ${error.message}`)
      await e.reply(`刷新失败: ${error.message}`)
    }

    return true
  }

  /**
   * 删除Cookie
   */
  async deleteCookie(e) {
    if (!e.isMaster) return false

    const cookie = setting.getCookie()
    if (!cookie) {
      await e.reply('未登录B站账号')
      return true
    }

    const userInfo = await api.getMyInfo()
    setting.setCookie('', '')

    if (userInfo) {
      await e.reply(`已删除B站账号: ${userInfo.uname}`)
    } else {
      await e.reply('已删除B站Cookie')
    }

    return true
  }

  /**
   * 清空缓存
   */
  async clearCache(e) {
    if (!e.isMaster) return false

    const success = setting.clearTemp()
    if (success) {
      await e.reply('已清空B站缓存')
    } else {
      await e.reply('清空缓存失败')
    }

    return true
  }

  /**
   * 解析Cookie字符串
   */
  parseCookie(setCookieHeader) {
    if (!setCookieHeader) return ''

    // set-cookie 的 Expires 属性自带逗号（Thu, 11 Dec 2026 ...），
    // 直接按逗号切会把日期当成 cookie，只有在「逗号后紧跟 name=」时才算下一个 cookie
    const segments = String(setCookieHeader).split(/,(?=\s*[\w.-]+\s*=)/)
    const cookiePairs = []

    for (const cookie of segments) {
      const pair = cookie.split(';')[0].trim()
      if (pair && pair.includes('=')) {
        cookiePairs.push(pair)
      }
    }

    return cookiePairs.join(';').replace(/\n/g, '')
  }

  /**
   * 获取CorrespondPath（用于刷新Cookie）
   */
  async getCorrespondPath(timestamp) {
    const publicKey = await crypto.subtle.importKey(
      'jwk',
      {
        kty: 'RSA',
        n: 'y4HdjgJHBlbaBN04VERG4qNBIFHP6a3GozCl75AihQloSWCXC5HDNgyinEnhaQ_4-gaMud_GF50elYXLlCToR9se9Z8z433U3KjM-3Yx7ptKkmQNAMggQwAVKgq3zYAoidNEWuxpkY_mAitTSRLnsJW-NCTa0bqBFF6Wm1MxgfE',
        e: 'AQAB'
      },
      { name: 'RSA-OAEP', hash: 'SHA-256' },
      true,
      ['encrypt']
    )

    const data = new TextEncoder().encode(`refresh_${timestamp}`)
    const encrypted = new Uint8Array(
      await crypto.subtle.encrypt({ name: 'RSA-OAEP' }, publicKey, data)
    )

    return encrypted.reduce((str, c) => str + c.toString(16).padStart(2, '0'), '')
  }

  /**
   * 延迟
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms))
  }
}
