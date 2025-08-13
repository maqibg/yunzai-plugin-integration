import lotusSetting from '../../model/lotus/lotus-setting.js'

// 获取默认配置
const defaultConfig = lotusSetting.getConfig('lotus-parser')

export const lotusParserSchema = {
  field: 'lotus-parser',
  label: 'Lotus解析器配置',
  component: 'GSubForm',
  componentProps: {
    multiple: false,
    schemas: [
      {
        field: 'bilibili',
        label: 'B站解析配置',
        component: 'GSubForm',
        componentProps: {
          multiple: false,
          schemas: [
            {
              field: 'sessData',
              label: 'B站SESSDATA',
              bottomHelpMessage: '登录B站后获取的SESSDATA，优先级最高，会覆盖BBDown的自动获取',
              component: 'Input',
              componentProps: {
                placeholder: '请输入B站SESSDATA（可选）'
              }
            },
            {
              field: 'displayCover',
              label: '显示封面',
              bottomHelpMessage: '是否在消息中展示视频封面',
              component: 'Switch',
              componentProps: { checkedChildren: '开启', unCheckedChildren: '关闭' }
            },
            {
              field: 'displayInfo',
              label: '显示信息',
              bottomHelpMessage: '是否展示播放/弹幕/点赞等统计信息',
              component: 'Switch',
              componentProps: { checkedChildren: '开启', unCheckedChildren: '关闭' }
            },
            {
              field: 'displayIntro',
              label: '显示简介',
              bottomHelpMessage: '是否展示视频简介（会按长度截断）',
              component: 'Switch',
              componentProps: { checkedChildren: '开启', unCheckedChildren: '关闭' }
            },
            {
              field: 'introLenLimit',
              label: '简介长度',
              bottomHelpMessage: '简介展示的最大字符数，超出自动省略',
              component: 'InputNumber',
              componentProps: { min: 30, max: 1000, placeholder: '120' }
            },
            {
              field: 'displaySummary',
              label: '显示总结',
              bottomHelpMessage: '调用B站官方总结接口生成摘要（需Cookie，可能受接口策略影响）',
              component: 'Switch',
              componentProps: { checkedChildren: '开启', unCheckedChildren: '关闭' }
            },
            {
              field: 'useBBDown',
              label: '使用BBDown',
              bottomHelpMessage: '是否优先使用BBDown进行下载，启用后可解析会员内容且更可靠',
              component: 'Switch',
              componentProps: {
                checkedChildren: '开启',
                unCheckedChildren: '关闭'
              }
            },
            {
              field: 'useAria2',
              label: '使用Aria2加速',
              bottomHelpMessage: '使用BBDown时，是否调用aria2c进行下载加速',
              component: 'Switch',
              componentProps: {
                checkedChildren: '开启',
                unCheckedChildren: '关闭'
              }
            },
            {
              field: 'resolution',
              label: '默认画质',
              bottomHelpMessage: '视频默认下载画质',
              component: 'Select',
              componentProps: {
                options: [
                  { label: '4K (120)', value: 120 },
                  { label: '1080P60 (116)', value: 116 },
                  { label: '1080P高码率 (112)', value: 112 },
                  { label: '1080P (80)', value: 80 },
                  { label: '720P60 (74)', value: 74 },
                  { label: '720P (64)', value: 64 },
                  { label: '480P (32)', value: 32 },
                  { label: '360P (16)', value: 16 }
                ]
              }
            },
            {
              field: 'durationLimit',
              label: '视频时长限制',
              bottomHelpMessage: '视频时长限制（秒），超过则只发信息不发视频',
              component: 'InputNumber',
              componentProps: {
                min: 60,
                max: 7200,
                placeholder: '3600'
              }
            },
            {
              field: 'fileSizeLimit',
              label: '文件大小限制',
              bottomHelpMessage: '视频文件大小限制（单位MB），超过则不下载视频仅发送信息，设置为0表示无限制',
              component: 'InputNumber',
              componentProps: {
                min: 0,
                max: 1000,
                placeholder: '200'
              }
            }
          ]
        }
      },
      {
        field: 'external_tools',
        label: '外部工具配置',
        component: 'GSubForm',
        componentProps: {
          multiple: false,
          schemas: [
            {
              field: 'toolsPath',
              label: '外部工具路径',
              bottomHelpMessage: '存放BBDown.exe, ffmpeg.exe等工具的文件夹绝对路径',
              component: 'Input',
              componentProps: {
                placeholder: '例如: D:/Apps/ffmpeg'
              }
            }
          ]
        }
      },
      {
        field: 'general',
        label: '通用配置',
        component: 'GSubForm',
        componentProps: {
          multiple: false,
          schemas: [
            {
              field: 'identifyPrefix',
              label: '消息前缀',
              bottomHelpMessage: '解析成功时消息的前缀',
              component: 'Input',
              componentProps: {
                placeholder: '[Lotus解析]'
              }
            },
            {
              field: 'videoSizeLimit',
              label: '视频大小限制',
              bottomHelpMessage: '视频文件大小限制（单位MB），超过此大小将转为上传群文件',
              component: 'InputNumber',
              componentProps: {
                min: 10,
                max: 1000,
                placeholder: '100'
              }
            }
          ]
        }
      }
    ]
  }
}
