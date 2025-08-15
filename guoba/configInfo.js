import { hsDingzhenSchema } from './schemas/hs-dingzhen.js'
import { lotusParserSchema } from './schemas/lotus-parser.js'
import { rconsoleSchema } from './schemas/rconsole.js'
import { tgSchema } from './schemas/tg.js'
import tgSetting from '../model/tg/tg-setting.js'
import hsSetting from '../model/hs/hs-setting.js'
import lotusSetting from '../model/lotus/lotus-setting.js'
import rconsoleSetting from '../model/rconsole/rconsole-setting.js'

// 将所有 schema 导出一个统一的配置对象
// key 即为后续在 config.yaml 中保存的键名
export const config = {
  schemas: [
    {
      title: '坤坤丁真功能配置',
      ...hsDingzhenSchema
    },
    {
      title: 'Lotus解析器配置',
      ...lotusParserSchema
    },
    {
      title: 'Rconsole 查询与趣味',
      ...rconsoleSchema
    },
    {
      title: 'Telegram 监听与转发',
      ...tgSchema
    }
  ],
  getConfigData() {
    // 获取当前配置数据
    return {
      'hs-kunkundinzhen': hsSetting.getConfig('hs-kunkundinzhen'),
      'lotus-parser': lotusSetting.getConfig('lotus-parser'),
      'rconsole': rconsoleSetting.getConfig('rconsole'),
      'tg-config': tgSetting.getConfig()
    }
  },
  setConfigData(data, { Result }) {
    try {
      let saved = false
      
      // 保存hs-kunkundinzhen配置
      if (data['hs-kunkundinzhen']) {
        const success = hsSetting.setConfig('hs-kunkundinzhen', data['hs-kunkundinzhen'])
        if (success) saved = true
      }
      
      // 保存lotus-parser配置
      if (data['lotus-parser']) {
        const success = lotusSetting.setConfig('lotus-parser', data['lotus-parser'])
        if (success) saved = true
      }
      
      // 保存rconsole配置
      if (data['rconsole']) {
        const success = rconsoleSetting.setConfig('rconsole', data['rconsole'])
        if (success) saved = true
      }

      // 保存 tg-config
      if (data['tg-config']) {
        const success = tgSetting.setConfig(data['tg-config'])
        if (success) saved = true
      }
      
      if (saved) {
        return Result.ok({}, '配置保存成功')
      } else {
        return Result.ok({}, '没有需要保存的配置')
      }
    } catch (error) {
      logger.error('[Guoba配置] 保存配置失败:', error)
      return Result.error(`配置保存失败: ${error.message}`)
    }
  }
}
