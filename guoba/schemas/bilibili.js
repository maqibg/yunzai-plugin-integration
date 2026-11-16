/**
 * Bilibili Guoba配置面板
 * 使用 GSubForm 结构：每个段是一个子表单，field 对应 getConfigData 返回的顶层键
 */

const onOff = {
  checkedChildren: '开启',
  unCheckedChildren: '关闭'
}

// 视频画质选项，与原配置里的数值一一对应
const QUALITY_OPTIONS = [
  { label: '360P 流畅', value: 16 },
  { label: '480P 清晰', value: 32 },
  { label: '720P 高清', value: 64 },
  { label: '720P60 高帧率', value: 74 },
  { label: '1080P 高清', value: 80 },
  { label: '1080P+ 高码率 (需大会员)', value: 112 },
  { label: '1080P60 高帧率 (需大会员)', value: 116 },
  { label: '4K 超清 (需大会员)', value: 120 }
]

export const bilibiliSchemas = [
  {
    field: 'basic',
    label: 'B站解析 - 基础配置',
    component: 'GSubForm',
    componentProps: {
      multiple: false,
      schemas: [
        {
          field: 'enable',
          label: '启用B站解析',
          bottomHelpMessage: '是否启用B站视频/动态解析功能',
          component: 'Switch',
          componentProps: onOff
        },
        {
          field: 'cooldown',
          label: '解析冷却时间（秒）',
          bottomHelpMessage: '同一视频/动态的解析冷却时间，0 表示无冷却',
          component: 'InputNumber',
          componentProps: { min: 0, max: 600, step: 10 }
        }
      ]
    }
  },

  {
    field: 'video',
    label: 'B站解析 - 视频配置',
    component: 'GSubForm',
    componentProps: {
      multiple: false,
      schemas: [
        {
          field: 'quality',
          label: '默认画质',
          bottomHelpMessage: '高画质需要大会员权限',
          component: 'Select',
          componentProps: {
            options: QUALITY_OPTIONS
          }
        },
        {
          field: 'durationLimit',
          label: '时长限制（秒）',
          bottomHelpMessage: '超过此时长只发信息不下载，0 表示无限制',
          component: 'InputNumber',
          componentProps: { min: 0, max: 36000, step: 60 }
        },
        {
          field: 'fileSizeLimit',
          label: '文件大小限制（MB）',
          bottomHelpMessage: '超过此大小不下载，0 表示无限制',
          component: 'InputNumber',
          componentProps: { min: 0, max: 1000, step: 10 }
        },
        {
          field: 'sendThreshold',
          label: '群文件阈值（MB）',
          bottomHelpMessage: '超过此大小的视频上传为群文件',
          component: 'InputNumber',
          componentProps: { min: 10, max: 200, step: 10 }
        }
      ]
    }
  },

  {
    // 数据实际落在 video.smartQuality，getConfigData 会单独暴露成顶层键
    field: 'smartQuality',
    label: 'B站解析 - 智能画质',
    component: 'GSubForm',
    componentProps: {
      multiple: false,
      schemas: [
        {
          field: 'enable',
          label: '启用智能画质',
          bottomHelpMessage: '根据文件大小自动降低画质',
          component: 'Switch',
          componentProps: onOff
        },
        {
          field: 'threshold',
          label: '降级触发阈值（MB）',
          bottomHelpMessage: '视频超过此大小时尝试降级',
          component: 'InputNumber',
          componentProps: { min: 10, max: 500, step: 10 }
        },
        {
          field: 'targetSize',
          label: '目标大小（MB）',
          bottomHelpMessage: '降级后尝试达到的目标大小',
          component: 'InputNumber',
          componentProps: { min: 10, max: 200, step: 10 }
        },
        {
          field: 'showNotice',
          label: '显示降级提示',
          bottomHelpMessage: '发生画质降级时显示提示消息',
          component: 'Switch',
          componentProps: onOff
        }
      ]
    }
  },

  {
    field: 'multiPage',
    label: 'B站解析 - 分P配置',
    component: 'GSubForm',
    componentProps: {
      multiple: false,
      schemas: [
        {
          field: 'timeout',
          label: '选择超时（秒）',
          bottomHelpMessage: '分P选择等待超时时间',
          component: 'InputNumber',
          componentProps: { min: 30, max: 600, step: 30 }
        },
        {
          field: 'autoFirstPage',
          label: '自动播放第一P',
          bottomHelpMessage: '多P视频自动播放第一P而不询问',
          component: 'Switch',
          componentProps: onOff
        }
      ]
    }
  },

  {
    field: 'display',
    label: 'B站解析 - 显示配置',
    component: 'GSubForm',
    componentProps: {
      multiple: false,
      schemas: [
        {
          field: 'showCover',
          label: '显示封面',
          component: 'Switch',
          componentProps: onOff
        },
        {
          field: 'showStats',
          label: '显示统计',
          bottomHelpMessage: '播放量、点赞等统计数据',
          component: 'Switch',
          componentProps: onOff
        },
        {
          field: 'showDesc',
          label: '显示简介',
          component: 'Switch',
          componentProps: onOff
        },
        {
          field: 'descMaxLength',
          label: '简介最大长度',
          component: 'InputNumber',
          componentProps: { min: 50, max: 500, step: 10 }
        },
        {
          field: 'showSummary',
          label: '显示AI摘要',
          bottomHelpMessage: '需要有效 Cookie 才能取到摘要',
          component: 'Switch',
          componentProps: onOff
        },
        {
          field: 'commentCount',
          label: '评论数量',
          bottomHelpMessage: '评论区显示条数',
          component: 'InputNumber',
          componentProps: { min: 1, max: 20, step: 1 }
        }
      ]
    }
  },

  {
    field: 'dynamic',
    label: 'B站解析 - 动态配置',
    component: 'GSubForm',
    componentProps: {
      multiple: false,
      schemas: [
        {
          field: 'enable',
          label: '启用动态解析',
          component: 'Switch',
          componentProps: onOff
        },
        {
          field: 'sendImages',
          label: '发送动态图片',
          component: 'Switch',
          componentProps: onOff
        },
        {
          field: 'imageLimit',
          label: '图片数量限制',
          bottomHelpMessage: '单条动态最多发送的图片数量，0 表示不限制',
          component: 'InputNumber',
          componentProps: { min: 0, max: 20, step: 1 }
        }
      ]
    }
  },

  {
    field: 'interact',
    label: 'B站解析 - 互动配置',
    component: 'GSubForm',
    componentProps: {
      multiple: false,
      schemas: [
        {
          field: 'enable',
          label: '启用互动功能',
          bottomHelpMessage: '点赞、投币、收藏等互动',
          component: 'Switch',
          componentProps: onOff
        },
        {
          field: 'defaultFavFolder',
          label: '默认收藏夹',
          bottomHelpMessage: '收藏视频时使用的收藏夹序号',
          component: 'InputNumber',
          componentProps: { min: 1, max: 100, step: 1 }
        }
      ]
    }
  },

  {
    field: 'push',
    label: 'B站解析 - 推送配置',
    component: 'GSubForm',
    componentProps: {
      multiple: false,
      schemas: [
        {
          field: 'enable',
          label: '启用视频推送',
          bottomHelpMessage: 'UP主视频更新推送',
          component: 'Switch',
          componentProps: onOff
        },
        {
          field: 'interval',
          label: '检查间隔（分钟）',
          component: 'InputNumber',
          componentProps: { min: 1, max: 60, step: 1 }
        }
      ]
    }
  },

  {
    field: 'link',
    label: 'B站解析 - 链接配置',
    component: 'GSubForm',
    componentProps: {
      multiple: false,
      schemas: [
        {
          field: 'showOriginal',
          label: '显示原链接',
          bottomHelpMessage: '解析后是否发送原B站链接',
          component: 'Switch',
          componentProps: onOff
        }
      ]
    }
  }
]

export function getBilibiliConfigSchema() {
  return bilibiliSchemas
}
