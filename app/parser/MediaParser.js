/**
 * 抖音/快手/小红书/小黑盒 链接解析
 * 被动识别消息里的分享链接，解析出视频、图集与文案；B站由 BilibiliParser 负责
 */
import setting from '../../model/bilibili/bilibili-setting.js'
import { detectPlatform, PLATFORM_NAME, PLATFORM_SWITCH, REDIS_PREFIX } from '../../model/parser/parser-const.js'
import { parseDouyin } from '../../model/parser/parser-douyin.js'
import { parseKuaishou } from '../../model/parser/parser-kuaishou.js'
import { parseXiaohongshu } from '../../model/parser/parser-xiaohongshu.js'
import { parseHeybox } from '../../model/parser/parser-heybox.js'
import { sendParseResult } from '../../model/parser/parser-send.js'
import { cleanTempFiles } from '../../model/parser/parser-fetch.js'

// 同一条消息只处理一次，避免 accept 与后续事件重复触发
const recentMessages = new Set()

export class MediaParser extends plugin {
  constructor() {
    super({
      name: '[解析]视频图文链接',
      dsc: '抖音/快手/小红书/小黑盒链接自动解析',
      event: 'message',
      priority: -120,
      rule: [
        {
          reg: '^#?(开启|开|打开|关闭|关)(视频|图文)解析$',
          fnc: 'toggleGroup',
          permission: 'admin'
        },
        {
          reg: '^#?(视频|图文)解析状态$',
          fnc: 'groupStatus'
        }
      ]
    })

    // 每小时清一次超龄临时文件：发完即删的定时器会随进程一起消失，
    // 这里兜住被 kill 或删除失败留下的半截视频
    this.task = {
      cron: '0 30 * * * *',
      name: '[解析]清理临时文件',
      fnc: () => this.clearCache(),
      log: false
    }
  }

  /**
   * 清理临时目录里超过 1 小时的文件
   */
  async clearCache() {
    try {
      const removed = cleanTempFiles()
      if (removed > 0) logger.mark(`[解析] 清理临时文件 ${removed} 个`)
    } catch (error) {
      logger.error(`[解析] 清理临时文件失败: ${error.message}`)
    }
  }

  /**
   * 本群是否停用了自动解析
   */
  isGroupDisabled(groupId) {
    const list = setting.getConfig().parse?.disabledGroups
    return Array.isArray(list) && list.map(String).includes(String(groupId))
  }

  /**
   * 群开关：群号写进 parse.disabledGroups，热生效
   */
  async toggleGroup(e) {
    if (!e.isGroup) {
      await e.reply('视频解析的群开关要在群里使用')
      return true
    }
    if (!e.isMaster && !e.isOwner && !e.isAdmin) {
      await e.reply('只有群主、管理员或机器人主人才能开关本群解析')
      return true
    }

    const enabled = /开启|开|打开/.test(e.msg)
    const current = setting.getConfig().parse || {}
    const groups = new Set((current.disabledGroups || []).map(String))

    if (enabled) groups.delete(String(e.group_id))
    else groups.add(String(e.group_id))

    if (!setting.setConfigItem('parse.disabledGroups', [...groups])) {
      logger.error('[解析] 写入群开关失败，请检查配置文件权限')
      await e.reply('设置失败，请检查配置文件权限')
      return true
    }

    await e.reply(enabled ? '本群自动解析已开启' : '本群自动解析已关闭')
    return true
  }

  /**
   * 查询本群开关状态
   */
  async groupStatus(e) {
    if (!e.isGroup) {
      await e.reply('解析状态请在群里查看')
      return true
    }
    await e.reply(this.isGroupDisabled(e.group_id) ? '本群自动解析已关闭' : '本群自动解析已开启')
    return true
  }

  /**
   * 汇总消息里所有可能含链接的文本
   * JSON/XML 卡片分享的 e.msg 往往为空，只能从 message 段里捞
   */
  collectText(e) {
    const parts = [e.msg || '', e.raw_message || '']

    for (const seg of e.message || []) {
      if (!seg) continue
      if (seg.type === 'text') {
        parts.push(seg.text || '')
      } else if (seg.type === 'json' || seg.type === 'xml') {
        let raw = seg.data
        if (raw && typeof raw === 'object') raw = raw.data || JSON.stringify(raw)
        parts.push(String(raw || ''))
      }
    }

    // 卡片里的链接常被转义成 https:\/\/ 和 &amp;
    return parts.join('\n').replace(/\\\//g, '/').replace(/&amp;/g, '&')
  }

  /**
   * 按平台分发解析
   */
  async parseByPlatform(platform, url, config) {
    if (platform === 'douyin') return parseDouyin(url)
    if (platform === 'kuaishou') return parseKuaishou(url)
    if (platform === 'xiaohongshu') return parseXiaohongshu(url, config)
    if (platform === 'heybox') return parseHeybox(url, config)
    throw new Error(`暂不支持的平台: ${platform}`)
  }

  /**
   * 被动钩子：Yunzai 会在 rule 匹配前调用，能覆盖 JSON 卡片分享
   */
  async accept(e) {
    if (e.post_type !== 'message') return

    const config = setting.getConfig().parse || {}
    if (config.enable === false) return

    const hit = detectPlatform(this.collectText(e))
    if (!hit) return

    // 群级开关：私聊不受影响
    if (e.isGroup && this.isGroupDisabled(e.group_id)) return

    // 平台级开关
    const switchKey = PLATFORM_SWITCH[hit.platform]
    if (switchKey && config[switchKey] === false) return

    // 回落键用 用户+链接：JSON 卡片的 raw_message 常是固定串，用它去重会误杀不同作品
    const messageId = e.message_id || `${e.user_id}:${hit.url}`
    if (recentMessages.has(messageId)) return
    recentMessages.add(messageId)
    setTimeout(() => recentMessages.delete(messageId), 60000)

    // 冷却按群（私聊按人）+ 链接维度，避免同一作品被反复解析刷屏
    const cooldown = Number(config.cooldown) || 0
    const sceneKey = e.isGroup ? `g${e.group_id}` : `u${e.user_id}`
    const cooldownKey = `${REDIS_PREFIX.PARSE_COOLDOWN}${sceneKey}:${hit.url}`

    try {
      if (cooldown > 0 && !e.isMaster && await redis.get(cooldownKey)) {
        logger.mark(`[解析] ${PLATFORM_NAME[hit.platform]}链接冷却中（${sceneKey}），跳过`)
        return
      }

      logger.mark(`[解析] 开始解析${PLATFORM_NAME[hit.platform]}链接: ${hit.url}`)
      const result = await this.parseByPlatform(hit.platform, hit.url, config)
      await sendParseResult(e, result, config)

      if (cooldown > 0) {
        await redis.set(cooldownKey, Date.now().toString(), { EX: cooldown })
      }
    } catch (error) {
      logger.error(`[解析] ${hit.platform} 解析失败（${hit.url}）: ${error.message}`)
      // silent 表示链接本身不是作品页（主页、合集页之类），往群里报错只会变成噪音
      if (!error.silent) {
        await e.reply(`${PLATFORM_NAME[hit.platform]}解析失败（链接可能已失效或被平台风控）`)
      }
    }

    // 解析类消息到此为止，阻断后续插件继续处理同一条链接
    return 'return'
  }
}
