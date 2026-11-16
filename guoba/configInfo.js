import { hsDingzhenSchema } from './schemas/hs-dingzhen.js'
import { getBilibiliConfigSchema } from './schemas/bilibili.js'
import { parseSchema } from './schemas/parse.js'
import { rconsoleSchema } from './schemas/rconsole.js'
import { tgSchema } from './schemas/tg.js'
import tgSetting from '../model/tg/tg-setting.js'
import hsSetting from '../model/hs/hs-setting.js'
import bilibiliSetting from '../model/bilibili/bilibili-setting.js'
import rconsoleSetting from '../model/rconsole/rconsole-setting.js'

// 将所有 schema 导出一个统一的配置对象
// key 即为后续在 config.yaml 中保存的键名
const bilibiliSchemas = getBilibiliConfigSchema()

// B 站配置在 bilibili.yaml 里的顶层段名，面板每个 GSubForm 对应其中一段
const BILI_SECTIONS = ['basic', 'video', 'multiPage', 'display', 'dynamic', 'interact', 'push', 'link']

export const config = {
  schemas: [
    // 综合解析放在最前：面板默认展示第一组
    parseSchema,
    {
      title: '坤坤丁真功能配置',
      ...hsDingzhenSchema
    },
    ...bilibiliSchemas,
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
    // 获取当前配置数据，添加详细错误处理
    const result = {}
    
    console.log('[锅巴配置] 开始获取配置数据')
    
    try {
      console.log('[锅巴配置] 读取hs-kunkundinzhen配置...')
      result['hs-kunkundinzhen'] = hsSetting.getConfig('hs-kunkundinzhen')
      console.log('[锅巴配置] hs-kunkundinzhen配置读取成功')
    } catch (error) {
      console.error('[锅巴配置] 读取hs-kunkundinzhen配置失败:', error.message, error.stack)
      result['hs-kunkundinzhen'] = {}
    }
    
    try {
      console.log('[锅巴配置] 读取bilibili配置...')
      result['bilibili'] = bilibiliSetting.getConfig()
      console.log('[锅巴配置] bilibili配置读取成功')
    } catch (error) {
      console.error('[锅巴配置] 读取bilibili配置失败:', error.message, error.stack)
      result['bilibili'] = {}
    }

    try {
      console.log('[锅巴配置] 展开B站各段配置...')
      const biliConfig = bilibiliSetting.getConfig()
      for (const key of BILI_SECTIONS) {
        result[key] = biliConfig[key] || {}
      }
      // smartQuality 实际存在 video 段内，面板里作为独立子表单展示
      result['smartQuality'] = biliConfig.video?.smartQuality || {}
      console.log('[锅巴配置] B站各段配置展开完成')
    } catch (error) {
      console.error('[锅巴配置] 展开B站各段配置失败:', error.message, error.stack)
    }

    try {
      console.log('[锅巴配置] 读取综合解析配置...')
      // 综合解析存在 bilibili.yaml 的 parse 段，单独暴露成顶层键供 GSubForm 使用
      result['parse'] = bilibiliSetting.getConfig().parse || {}
      console.log('[锅巴配置] 综合解析配置读取成功')
    } catch (error) {
      console.error('[锅巴配置] 读取综合解析配置失败:', error.message, error.stack)
      result['parse'] = {}
    }
    
    try {
      console.log('[锅巴配置] 读取rconsole配置...')
      result['rconsole'] = rconsoleSetting.getConfig('rconsole')
      console.log('[锅巴配置] rconsole配置读取成功')
    } catch (error) {
      console.error('[锅巴配置] 读取rconsole配置失败:', error.message, error.stack)
      result['rconsole'] = {}
    }
    
    try {
      console.log('[锅巴配置] 读取tg-config配置...')
      result['tg-config'] = tgSetting.getConfig()
      console.log('[锅巴配置] tg-config配置读取成功')
    } catch (error) {
      console.error('[锅巴配置] 读取tg-config配置失败:', error.message, error.stack)
      result['tg-config'] = {}
    }
    
    console.log('[锅巴配置] 配置数据获取完成', JSON.stringify(result, null, 2))
    return result
  },
  setConfigData(data, { Result }) {
    try {
      let saved = false
      
      // 保存hs-kunkundinzhen配置
      if (data['hs-kunkundinzhen']) {
        const success = hsSetting.setConfig('hs-kunkundinzhen', data['hs-kunkundinzhen'])
        if (success) saved = true
      }
      
      // 保存bilibili配置
      if (data['bilibili']) {
        const success = bilibiliSetting.setConfig(data['bilibili'])
        if (success) saved = true
      }
      
      // 保存 B 站各段配置：面板每个 GSubForm 作为一个顶层键提交
      if (BILI_SECTIONS.some(key => data[key]) || data['smartQuality']) {
        const current = bilibiliSetting.getConfig()
        const next = { ...current }

        for (const key of BILI_SECTIONS) {
          if (!data[key]) continue
          // 逐段浅合并，面板没展示的字段（如 Cookie）不会被覆盖掉
          next[key] = { ...(current[key] || {}), ...data[key] }
        }

        if (data['smartQuality']) {
          next.video = {
            ...(next.video || {}),
            smartQuality: { ...(current.video?.smartQuality || {}), ...data['smartQuality'] }
          }
        }

        if (bilibiliSetting.setConfig(next)) saved = true
      }

      // 保存综合解析配置：写回 bilibili.yaml 的 parse 段
      if (data['parse']) {
        const current = bilibiliSetting.getConfig()
        const success = bilibiliSetting.setConfig({ ...current, parse: data['parse'] })
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
