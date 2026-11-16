/**
 * 综合解析（抖音 / 快手 / 小红书 / 小黑盒）锅巴配置
 * 用 GSubForm 结构：field 对应 getConfigData 返回的顶层键，内部 field 是该项配置的键名
 */

const switchProps = {
  checkedChildren: '开启',
  unCheckedChildren: '关闭'
}

export const parseSchema = {
  field: 'parse',
  label: '综合解析 - 抖音/快手/小红书/小黑盒',
  component: 'GSubForm',
  componentProps: {
    multiple: false,
    schemas: [
      {
        field: 'enable',
        label: '启用综合解析',
        bottomHelpMessage: '群里直接发分享链接即解析，无需指令',
        component: 'Switch',
        componentProps: switchProps
      },
      {
        field: 'douyin',
        label: '解析抖音',
        component: 'Switch',
        componentProps: switchProps
      },
      {
        field: 'kuaishou',
        label: '解析快手',
        component: 'Switch',
        componentProps: switchProps
      },
      {
        field: 'xiaohongshu',
        label: '解析小红书',
        component: 'Switch',
        componentProps: switchProps
      },
      {
        field: 'heybox',
        label: '解析小黑盒',
        component: 'Switch',
        componentProps: switchProps
      },
      {
        field: 'sendVideo',
        label: '发送视频本体',
        bottomHelpMessage: '关闭后只发标题、封面与链接，不下载视频',
        component: 'Switch',
        componentProps: switchProps
      },
      {
        field: 'showCover',
        label: '发送封面',
        component: 'Switch',
        componentProps: switchProps
      },
      {
        field: 'durationLimit',
        label: '视频时长上限（秒）',
        bottomHelpMessage: '超过此时长只发信息与链接，不下载视频',
        component: 'InputNumber',
        componentProps: { min: 0, max: 7200, step: 30 }
      },
      {
        field: 'fileSizeLimit',
        label: '视频体积上限（MB）',
        bottomHelpMessage: '超过此大小只发信息与链接，0 表示不限制',
        component: 'InputNumber',
        componentProps: { min: 0, max: 500, step: 10 }
      },
      {
        field: 'cooldown',
        label: '解析冷却（秒）',
        bottomHelpMessage: '同一链接在同一群（私聊按人）的冷却时间，0 表示无冷却',
        component: 'InputNumber',
        componentProps: { min: 0, max: 600, step: 5 }
      },
      {
        field: 'imageLimit',
        label: '单条最多发图',
        component: 'InputNumber',
        componentProps: { min: 1, max: 40, step: 1 }
      },
      {
        field: 'maxLive',
        label: '实况图上限',
        bottomHelpMessage: '小红书实况图最多按视频发送的数量',
        component: 'InputNumber',
        componentProps: { min: 0, max: 20, step: 1 }
      },
      {
        field: 'xhsCookie',
        label: '小红书 Cookie',
        bottomHelpMessage: '公开笔记留空即可，登录态笔记才需要填写',
        component: 'Input'
      },
      {
        field: 'heyboxCookie',
        label: '小黑盒 Cookie',
        bottomHelpMessage: '触发风控验证码时填写登录 cookie',
        component: 'Input'
      }
    ]
  }
}
