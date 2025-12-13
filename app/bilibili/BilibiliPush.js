/**
 * Bilibili 推送功能模块
 * 负责UP主视频更新推送
 */
import moment from 'moment'
import setting from '../../model/bilibili/bilibili-setting.js'
import api from '../../model/bilibili/bilibili-api.js'

export class BilibiliPush extends plugin {
  constructor() {
    super({
      name: '[Bilibili]视频推送',
      dsc: 'B站UP主视频推送',
      event: 'message.group',
      priority: -120,
      rule: [
        {
          reg: '^#?(添加|开启)(b站|B站|bili|bilibili)推送(\\d+)$',
          fnc: 'addPush'
        },
        {
          reg: '^#?(取消|删除|关闭)(b站|B站|bili|bilibili)推送(\\d+)$',
          fnc: 'removePush'
        },
        {
          reg: '^#?(b站|B站|bili|bilibili)(视频)?推送列表$',
          fnc: 'listPush'
        }
      ]
    })

    // 定时任务
    this.task = {
      cron: this.getCron(),
      name: '[Bilibili]视频推送检查',
      fnc: () => this.checkPush(),
      log: false
    }
  }

  /**
   * 获取cron表达式
   */
  getCron() {
    const config = setting.getConfig()
    const interval = config.push?.interval || 3
    return `0 0/${interval} * * * *`
  }

  /**
   * 添加推送
   */
  async addPush(e) {
    const config = setting.getConfig()
    if (!config.push?.enable) return false

    // 检查权限
    if (!e.member?.is_admin && !e.member?.is_owner && !e.isMaster) {
      return false
    }

    const match = e.msg.match(/(\d+)$/)
    if (!match) return false

    const mid = match[1]
    const groupId = e.group_id

    // 获取UP主信息
    const upInfo = await api.getUserCard(mid)
    if (!upInfo) {
      e.reply('未找到该UP主，请检查UID是否正确')
      return true
    }

    // 检查是否已添加
    const pushConfig = setting.getPushConfig()
    if (pushConfig[mid]?.includes(groupId)) {
      e.reply([
        segment.image(upInfo.face),
        `\nUP主: ${upInfo.name}`,
        '\n\n本群已添加该UP主的推送'
      ])
      return true
    }

    // 添加推送
    setting.addPushSubscription(mid, groupId)

    e.reply([
      segment.image(upInfo.face),
      `\nUP主: ${upInfo.name}`,
      '\n\n添加视频推送成功！'
    ])

    return true
  }

  /**
   * 取消推送
   */
  async removePush(e) {
    const config = setting.getConfig()
    if (!config.push?.enable) return false

    // 检查权限
    if (!e.member?.is_admin && !e.member?.is_owner && !e.isMaster) {
      return false
    }

    const match = e.msg.match(/(\d+)$/)
    if (!match) return false

    const mid = match[1]
    const groupId = e.group_id

    // 检查是否已添加
    const pushConfig = setting.getPushConfig()
    if (!pushConfig[mid]?.includes(groupId)) {
      e.reply('本群未添加该UP主的推送')
      return true
    }

    // 获取UP主信息
    const upInfo = await api.getUserCard(mid)

    // 移除推送
    setting.removePushSubscription(mid, groupId)

    e.reply([
      upInfo ? segment.image(upInfo.face) : '',
      upInfo ? `\nUP主: ${upInfo.name}` : '',
      '\n\n取消视频推送成功'
    ].filter(Boolean))

    return true
  }

  /**
   * 推送列表
   */
  async listPush(e) {
    const config = setting.getConfig()
    if (!config.push?.enable) return false

    const groupId = e.group_id
    const pushConfig = setting.getPushConfig()

    const subscriptions = []
    for (const [mid, groups] of Object.entries(pushConfig)) {
      if (Array.isArray(groups) && groups.includes(groupId)) {
        subscriptions.push(mid)
      }
    }

    if (!subscriptions.length) {
      e.reply('本群当前没有UP主视频推送')
      return true
    }

    // 获取UP主信息
    const messages = []
    for (const mid of subscriptions) {
      const upInfo = await api.getUserCard(mid)
      if (upInfo) {
        messages.push([
          segment.image(upInfo.face),
          `\nUP主: ${upInfo.name}`,
          `\nUID: ${mid}`
        ])
      }
    }

    if (messages.length) {
      // 发送合并消息
      const forwardMsg = messages.map(msg => ({
        message: msg,
        nickname: 'Bilibili推送',
        user_id: Bot.uin
      }))

      await e.reply(await Bot.makeForwardMsg(forwardMsg))
    }

    return true
  }

  /**
   * 检查推送
   */
  async checkPush() {
    const config = setting.getConfig()
    if (!config.push?.enable) return

    const cookie = setting.getCookie()
    if (!cookie) return

    const pushConfig = setting.getPushConfig()
    const timeData = setting.getData('push_time') || {}

    for (const [mid, groups] of Object.entries(pushConfig)) {
      if (!Array.isArray(groups) || !groups.length) continue

      try {
        // 获取最新视频
        const latestVideo = await api.getUserLatestVideo(mid)
        if (!latestVideo) continue

        const lastTime = timeData[`${mid}_time`] || 0

        // 初始化时间记录
        if (!lastTime) {
          timeData[`${mid}_time`] = latestVideo.created
          setting.setData('push_time', timeData)
          continue
        }

        // 检查是否有新视频
        if (latestVideo.created > lastTime) {
          // 更新时间
          timeData[`${mid}_time`] = latestVideo.created
          setting.setData('push_time', timeData)

          // 获取UP主信息
          const upInfo = await api.getUserCard(mid)
          if (!upInfo) continue

          // 发送推送消息
          const msg = [
            segment.image(upInfo.face),
            `\nUP主: ${upInfo.name} 发布了新视频`,
            `\n\n标题: ${latestVideo.title}`,
            `\n链接: https://www.bilibili.com/video/${latestVideo.bvid}`,
            `\n日期: ${moment(latestVideo.created * 1000).format('MM-DD HH:mm')}`,
            latestVideo.pic ? segment.image(latestVideo.pic) : ''
          ].filter(Boolean)

          // 向所有订阅群发送
          for (const groupId of groups) {
            try {
              const group = Bot.pickGroup(groupId)
              if (group) {
                await group.sendMsg(msg)
                // 间隔发送，避免风控
                await this.sleep(Math.random() * 10000 + 5000)
              }
            } catch (error) {
              logger.error(`[Bilibili] 推送到群 ${groupId} 失败: ${error.message}`)
            }
          }
        }
      } catch (error) {
        logger.error(`[Bilibili] 检查UP主 ${mid} 更新失败: ${error.message}`)
      }
    }
  }

  /**
   * 延迟
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms))
  }
}
