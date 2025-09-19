import plugin from '../../../../lib/plugins/plugin.js'
import { pullByTeelebot } from './client/teelebot.js'
import { pullByLocal } from './client/local.js'
import { loadState, saveState } from './state/store.js'
import { parseCommand } from './util/command.js'
import tgSetting from '../../model/tg/tg-setting.js'

const logger = globalThis.logger || console

export default class TgMonitor extends plugin {
  constructor() {
    super({
      name: 'TG 转发',
      dsc: '#tg 拉取 Telegram 消息并转发至 QQ',
      event: 'message',
      priority: 500,
      rule: [
        { reg: '^#tg\\s*$', fnc: 'manualPull' },
        { reg: '^#tg\\s+.+', fnc: 'manualPull' }
      ]
    })
  }

  async manualPull(e) {
    try {
      const cfg = tgSetting.getConfig() || {}
      const state = loadState()
      const req = parseCommand(e, cfg)
      if (!req.channels.length) {
        await e.reply('未找到可处理的频道配置，请检查 tg-config.yaml。')
        return true
      }

      const cloud = cfg.cloud_teelebot || {}
      const useCloud = cloud.enabled !== false && !!cloud.api_endpoint
      const results = []

      for (const ch of req.channels) {
        const label = (ch.alias && String(ch.alias).trim()) || (ch.username && String(ch.username).trim()) || (ch.id && String(ch.id).trim()) || '未知频道'
        try {
          const sum = useCloud
            ? await pullByTeelebot(e, ch, req.limit, state, cloud)
            : await pullByLocal(e, ch, req.limit, state, cfg)
          results.push(`频道 ${label}：成功 ${sum.sent} 条，跳过 ${sum.skipped} 条`)
        } catch (err) {
          logger.error(`[TG] 频道 ${label} 失败：${err.message}`)
          results.push(`频道 ${label}：失败 - ${err.message}`)
          if (useCloud && cloud.fallback_to_local === true) {
            try {
              const fb = await pullByLocal(e, ch, req.limit, state, cfg)
              results.push(`频道 ${label}：已切换本地模式，成功 ${fb.sent} 条`)
            } catch (fbErr) {
              results.push(`频道 ${label}：本地模式失败 - ${fbErr.message}`)
            }
          }
        }
      }

      saveState(state)\n      if ((tgSetting.getConfig()?.logging?.detailed) === true) { await e.reply() }
    } catch (err) {
      logger.error('[TG] 处理失败：' + err.message)
      await e.reply('TG 拉取失败：' + err.message)
    }
    return true
  }
}


