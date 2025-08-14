import tgSetting from '../../model/tg/tg-setting.js'

const defaultConfig = tgSetting.getConfig('tg-forwarder')

export const tgSchema = {
  field: 'tg-forwarder',
  label: 'TG转发插件配置',
  component: 'GSubForm',
  componentProps: {
    multiple: false,
    schemas: [
      {
        field: 'telegram',
        label: 'Telegram Bot配置',
        component: 'GSubForm',
        componentProps: {
          multiple: false,
          schemas: [
            {
              field: 'botToken',
              label: 'Bot Token',
              component: 'Input',
              componentProps: {
                placeholder: '请输入Telegram Bot Token',
                type: 'password'
              },
              value: defaultConfig?.telegram?.botToken,
              required: true
            },
            {
              field: 'channels',
              label: '监控频道',
              component: 'Select',
              componentProps: {
                mode: 'tags',
                placeholder: '输入频道用户名，如: @channelname',
                allowClear: true
              },
              value: defaultConfig?.telegram?.channels || []
            }
          ]
        }
      },
      {
        field: 'qq',
        label: 'QQ群配置',
        component: 'GSubForm',
        componentProps: {
          multiple: false,
          schemas: [
            {
              field: 'targetGroups',
              label: '目标QQ群',
              component: 'Select',
              componentProps: {
                mode: 'tags',
                placeholder: '输入QQ群号，如: 123456789',
                allowClear: true
              },
              value: defaultConfig?.qq?.targetGroups || []
            }
          ]
        }
      },
      {
        field: 'monitor',
        label: '监控设置',
        component: 'GSubForm',
        componentProps: {
          multiple: false,
          schemas: [
            {
              field: 'enabled',
              label: '启用自动监控',
              component: 'Switch',
              componentProps: {
                checkedChildren: '开启',
                unCheckedChildren: '关闭'
              },
              value: defaultConfig?.monitor?.enabled !== false
            },
            {
              field: 'interval',
              label: '监控间隔(分钟)',
              component: 'InputNumber',
              componentProps: {
                min: 1,
                max: 1440,
                placeholder: '输入监控间隔分钟数'
              },
              value: Math.floor((defaultConfig?.monitor?.interval || 3600000) / 60000)
            }
          ]
        }
      },
      {
        field: 'proxy',
        label: '代理设置',
        component: 'GSubForm',
        componentProps: {
          multiple: false,
          schemas: [
            {
              field: 'enabled',
              label: '启用代理',
              component: 'Switch',
              componentProps: {
                checkedChildren: '开启',
                unCheckedChildren: '关闭'
              },
              value: defaultConfig?.proxy?.enabled || false
            },
            {
              field: 'url',
              label: '代理地址',
              component: 'Input',
              componentProps: {
                placeholder: 'http://127.0.0.1:7890 或 socks5://127.0.0.1:1080'
              },
              value: defaultConfig?.proxy?.url || '',
              help: '支持HTTP和SOCKS5代理'
            }
          ]
        }
      },
      {
        field: 'files',
        label: '文件设置',
        component: 'GSubForm',
        componentProps: {
          multiple: false,
          schemas: [
            {
              field: 'maxSize',
              label: '最大文件大小(MB)',
              component: 'InputNumber',
              componentProps: {
                min: 1,
                max: 50,
                placeholder: '文件大小限制'
              },
              value: Math.floor((defaultConfig?.files?.maxSize || 52428800) / 1048576),
              help: '超过此大小的文件将不会下载转发'
            },
            {
              field: 'autoCleanup',
              label: '自动清理临时文件',
              component: 'Switch',
              componentProps: {
                checkedChildren: '开启',
                unCheckedChildren: '关闭'
              },
              value: defaultConfig?.files?.autoCleanup !== false
            }
          ]
        }
      },
      {
        field: 'advanced',
        label: '高级设置',
        component: 'GSubForm',
        componentProps: {
          multiple: false,
          schemas: [
            {
              field: 'requestTimeout',
              label: '请求超时(秒)',
              component: 'InputNumber',
              componentProps: {
                min: 5,
                max: 300,
                placeholder: 'API请求超时时间'
              },
              value: Math.floor((defaultConfig?.advanced?.requestTimeout || 30000) / 1000)
            },
            {
              field: 'retryCount',
              label: '失败重试次数',
              component: 'InputNumber',
              componentProps: {
                min: 0,
                max: 10,
                placeholder: '请求失败重试次数'
              },
              value: defaultConfig?.advanced?.retryCount || 3
            }
          ]
        }
      }
    ]
  }
}