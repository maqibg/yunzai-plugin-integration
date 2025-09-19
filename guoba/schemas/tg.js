// 锅巴配置面板 Schema（Telegram 监听与转发）
// - 通过 GSubForm 定义 UI 布局，将修改后的值写回 tg-config.yaml
// - 字段说明：
//   token：官方 bot token
//   proxy：代理参数（enable、protocol、host、port）
//   batch：每批次合并转发的节点数上限
//   dedup：去重数据保留天数
//   download.dir：下载目录（默认 plugins/.../data/temp/tg）
//   cloud_teelebot：云端API配置（突破20MB限制）
//   channels：频道与 QQ 目标映射（可多条）
// - 使用方式：发送 #tg 指令手动拉取频道消息并转发到QQ

// Schema不再预设配置值，而是通过getConfigData动态获取
import { cloudConfigSchema } from './tg-cloud.js'

export const tgSchema = {
  field: 'tg-config',
  label: 'Telegram 监听与转发',
  component: 'GSubForm',
  componentProps: {
    multiple: false,
    schemas: [
      {
        field: 'token',
        label: 'Bot Token',
        bottomHelpMessage: 'Telegram 官方 bot token（必填）',
        component: 'Input',
        componentProps: { placeholder: '123456:ABC-xxx' },
      },
      {
        field: 'proxy',
        label: '代理设置',
        component: 'GSubForm',
        componentProps: {
          multiple: false,
          schemas: [
            { field: 'enable', label: '启用代理', component: 'Switch', componentProps: { checkedChildren: '开启', unCheckedChildren: '关闭' } },
            { field: 'protocol', label: '协议', component: 'Select', componentProps: { options: [ { label: 'http', value: 'http' }, { label: 'https', value: 'https' } ] } },
            { field: 'host', label: '主机', component: 'Input', componentProps: { placeholder: '127.0.0.1' } },
            { field: 'port', label: '端口', component: 'InputNumber', componentProps: { min: 1, max: 65535, placeholder: '7890' } }
          ]
        }
      },
      {
        field: 'batch',
        label: '批次',
        component: 'GSubForm',
        componentProps: { multiple: false, schemas: [ { field: 'size', label: '每批条数', component: 'InputNumber', componentProps: { min: 1, max: 20, placeholder: '8' } } ] }
      },
      {
        field: 'dedup',
        label: '去重/保留',
        component: 'GSubForm',
        componentProps: { multiple: false, schemas: [ { field: 'ttl_days', label: '去重保留(天)', component: 'InputNumber', componentProps: { min: 1, max: 30, placeholder: '7' } } ] }
      },
      {
        field: 'download',
        label: '下载设置',
        component: 'GSubForm',
        componentProps: { 
          multiple: false, 
          schemas: [ 
            { field: 'dir', label: '目录', component: 'Input', componentProps: { placeholder: 'plugins/yunzai-plugin-integration/data/temp/tg' } }, 
            { field: 'max_file_mb', label: '单文件上限(MB)', component: 'InputNumber', componentProps: { min: 1, max: 50, placeholder: '20' } },
            { field: 'auto_cleanup', label: '自动清理', bottomHelpMessage: '是否启用文件自动清理', component: 'Switch', componentProps: { checkedChildren: '开启', unCheckedChildren: '关闭' } },
            { field: 'cleanup_days', label: '清理天数', bottomHelpMessage: '清理超过指定天数的文件', component: 'InputNumber', componentProps: { min: 1, max: 30, placeholder: '7' } }
          ] 
        }
      },
      {
        field: 'cloud_teelebot',
        label: '云端API配置',
        bottomHelpMessage: '配置云端teelebot API服务，突破20MB文件大小限制。需要单独部署teelebot FileLinker插件。',
        component: 'GSubForm',
        componentProps: {
          multiple: false,
          schemas: [
            { 
              field: 'enabled', 
              label: '启用云端API', 
              bottomHelpMessage: '是否启用云端teelebot API（需要单独部署）', 
              component: 'Switch', 
              componentProps: { checkedChildren: '开启', unCheckedChildren: '关闭' } 
            },
            
            { 
              field: 'download_root', 
              label: '下载根路径', 
              bottomHelpMessage: 'teelebot 下载目录（Yunzai 可读路径），为空使用内置默认', 
              component: 'Input', 
              componentProps: { placeholder: 'plugins/yunzai-plugin-integration/model/tg/teelebot/plugins/TGDownloader/download' },
              ifShow: ({ model }) => model?.cloud_teelebot?.enabled
            },
            {
              field: 'auth_token', 
              label: 'API认证Token', 
              bottomHelpMessage: 'API认证token（与teelebot FileLinker插件配置保持一致）', 
              component: 'Input', 
              componentProps: { placeholder: '请输入认证token' },
              ifShow: ({ model }) => model?.cloud_teelebot?.enabled
            },
            { 
              field: 'timeout', 
              label: 'API请求超时(秒)', 
              component: 'InputNumber', 
              componentProps: { min: 5, max: 300, placeholder: '30' },
              ifShow: ({ model }) => model?.cloud_teelebot?.enabled
            },
            { 
              field: 'retry_count', 
              label: '失败重试次数', 
              component: 'InputNumber', 
              componentProps: { min: 0, max: 10, placeholder: '3' },
              ifShow: ({ model }) => model?.cloud_teelebot?.enabled
            },
            { 
              field: 'fallback_to_local', 
              label: '回退到本地下载', 
              bottomHelpMessage: '云端失败时是否回退到本地下载', 
              component: 'Switch', 
              componentProps: { checkedChildren: '开启', unCheckedChildren: '关闭' },
              ifShow: ({ model }) => model?.cloud_teelebot?.enabled
            },
            { 
              field: 'force_cloud', 
              label: '强制云端模式', 
              bottomHelpMessage: '是否强制使用云端模式（忽略文件大小判断）', 
              component: 'Switch', 
              componentProps: { checkedChildren: '开启', unCheckedChildren: '关闭' },
              ifShow: ({ model }) => model?.cloud_teelebot?.enabled
            },
            { 
              field: 'local_max_mb', 
              label: '本地下载最大大小(MB)', 
              bottomHelpMessage: '超过此大小优选云端下载', 
              component: 'InputNumber', 
              componentProps: { min: 1, max: 100, placeholder: '20' },
              ifShow: ({ model }) => model?.cloud_teelebot?.enabled
            },
            { 
              field: 'cloud_max_mb', 
              label: '云端下载最大大小(MB)', 
              bottomHelpMessage: '云端API支持的最大文件大小', 
              component: 'InputNumber', 
              componentProps: { min: 20, max: 5000, placeholder: '2000' },
              ifShow: ({ model }) => model?.cloud_teelebot?.enabled
            },
            { 
              field: 'cloud_preferred_types', 
              label: '优选云端下载的文件类型', 
              bottomHelpMessage: '这些类型的文件优先使用云端下载', 
              component: 'Select', 
              componentProps: { 
                mode: 'multiple',
                options: [
                  { label: '视频', value: 'video' },
                  { label: '文档', value: 'document' },
                  { label: '音频', value: 'audio' },
                  { label: '图片', value: 'photo' }
                ],
                placeholder: '选择优选云端下载的文件类型'
              },
              ifShow: ({ model }) => model?.cloud_teelebot?.enabled
            }
          ]
        }
      },
      {
        field: 'logging',
        label: '日志设置',
        component: 'GSubForm',
        componentProps: {
          multiple: false,
          schemas: [
            { field: 'detailed', label: '详细日志', bottomHelpMessage: '开启后显示DEBUG级别的详细日志信息', component: 'Switch', componentProps: { checkedChildren: '开启', unCheckedChildren: '关闭' } }
          ]
        }
      },
      {
        field: 'filters',
        label: '内容过滤器',
        component: 'GSubForm',
        componentProps: {
          multiple: false,
          schemas: [
            { field: 'enable', label: '启用过滤器', component: 'Switch', componentProps: { checkedChildren: '开启', unCheckedChildren: '关闭' } },
            { field: 'remove_telegram_domains', label: '过滤Telegram域名', bottomHelpMessage: '将消息中的Telegram域名替换为https:///', component: 'Switch', componentProps: { checkedChildren: '开启', unCheckedChildren: '关闭' } }
          ]
        }
      },
      {
        field: 'channels',
        label: '频道映射（简化）',
        bottomHelpMessage: '可为空或添加多条频道配置。id 和 username 可为空，复杂场景可直接编辑 tg-config.yaml',
        component: 'GSubForm',
        componentProps: {
          multiple: true,
          schemas: [
            { field: 'id', label: '频道ID', component: 'Input', componentProps: { placeholder: '-100xxxxxxxxxx（优先）' } },
            { field: 'username', label: '频道用户名', component: 'Input', componentProps: { placeholder: '@channel（可选）' } },
            { field: 'types', label: '同步类型', component: 'Select', componentProps: { mode: 'multiple', options: [ { label: '文本', value: 'text' }, { label: '图片', value: 'photo' }, { label: '视频', value: 'video' }, { label: '文档', value: 'document' }, { label: '音频', value: 'audio' } ], placeholder: '选择要同步的消息类型' } },
            { field: 'target', label: 'QQ 目标', component: 'GSubForm', componentProps: { multiple: false, schemas: [ { field: 'type', label: '类型', component: 'Select', componentProps: { options: [ { label: '群', value: 'group' }, { label: '私聊', value: 'user' } ] } }, { field: 'id', label: 'ID', component: 'InputNumber', componentProps: { min: 1, placeholder: '群号或 QQ 号' } } ] } }
          ]
        }
      }
    ]
  }
}



