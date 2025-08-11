import setting from '../../model/hs/hs-setting.js'

// 获取默认配置
const defaultConfig = setting.getConfig('hs-kunkundinzhen')

export const hsDingzhenSchema = {
  field: 'hs-kunkundinzhen',
  label: '坤坤丁真功能配置',
  component: 'GSubForm',
  componentProps: {
    multiple: false,
    schemas: [
      {
        field: 'dz',
        label: '丁真功能开关',
        bottomHelpMessage: '开启后可触发丁真图片发送（一眼丁真、雪豹闭嘴等）',
        component: 'Switch',
        componentProps: {
          checkedChildren: '开启',
          unCheckedChildren: '关闭'
        }
      },
      {
        field: 'kunkun',
        label: '坤坤功能开关',
        bottomHelpMessage: '开启后可触发坤坤图片发送（鸡你太美、小黑子等）',
        component: 'Switch',
        componentProps: {
          checkedChildren: '开启',
          unCheckedChildren: '关闭'
        }
      },
      {
        field: 'weekday',
        label: '星期几功能开关',
        bottomHelpMessage: '开启后可使用"今天星期几"命令',
        component: 'Switch',
        componentProps: {
          checkedChildren: '开启',
          unCheckedChildren: '关闭'
        }
      }
    ]
  }
}