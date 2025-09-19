// 云端API配置Schema - 锅巴配置界面
import lodash from 'lodash'

const cloudConfigSchema = {
  type: 'object',
  title: '云端API配置',
  description: '云端优先策略：启用后所有消息都优先通过云端API处理，失败后回退本地',
  properties: {
    enabled: {
      type: 'boolean',
      title: '启用云端API',
      description: '启用后所有消息（包括文本和文件）都优先通过云端teelebot API处理',
      default: false
    },
        download_root: {\r\n      type: 'string',\r\n      title: '下载根路径',\r\n      description: 'teelebot 下载目录（Yunzai 可读路径）',\r\n      default: '',\r\n      minLength: 0\r\n    },\r\n    auth_token: {
      type: 'string',
      title: 'API认证Token',
      description: 'API认证token（与teelebot FileLinker插件配置保持一致）',
      default: '',
      'if': {
        properties: { enabled: { const: true } }
      }
    },
    timeout: {
      type: 'integer',
      title: 'API请求超时(秒)',
      description: 'API请求超时时间',
      default: 30,
      minimum: 5,
      maximum: 300
    },
    retry_count: {
      type: 'integer',
      title: '失败重试次数',
      description: '失败重试次数',
      default: 3,
      minimum: 0,
      maximum: 10
    },
    retry_delay: {
      type: 'integer',
      title: '重试延迟(秒)',
      description: '重试延迟',
      default: 5,
      minimum: 1,
      maximum: 30
    },
    health_check_cache: {
      type: 'integer',
      title: '健康检查缓存(秒)',
      description: '健康检查缓存时间',
      default: 30,
      minimum: 5,
      maximum: 300
    },
    max_batch_size: {
      type: 'integer',
      title: '批量请求最大文件数',
      description: '批量请求最大文件数',
      default: 10,
      minimum: 1,
      maximum: 50
    },
    download_timeout: {
      type: 'integer',
      title: '文件下载超时(秒)',
      description: '文件下载超时时间',
      default: 300,
      minimum: 30,
      maximum: 1800
    },
    max_file_size: {
      type: 'integer',
      title: '云端最大文件大小(字节)',
      description: '云端最大文件大小（默认2GB）',
      default: 2147483648,
      minimum: 1048576,
      maximum: 5368709120
    },
    max_concurrent_downloads: {
      type: 'integer',
      title: '最大并发下载数',
      description: '最大并发下载数',
      default: 3,
      minimum: 1,
      maximum: 10
    },
    fallback_to_local: {
      type: 'boolean',
      title: '回退到本地下载',
      description: '云端失败时是否回退到本地下载',
      default: true
    },
    force_cloud: {
      type: 'boolean',
      title: '强制云端模式',
      description: '是否强制使用云端模式',
      default: false
    },
    local_max_mb: {
      type: 'integer',
      title: '本地下载最大大小(MB)',
      description: '本地下载最大大小',
      default: 20,
      minimum: 1,
      maximum: 100
    },
    cloud_max_mb: {
      type: 'integer',
      title: '云端下载最大大小(MB)',
      description: '云端下载最大大小',
      default: 2000,
      minimum: 20,
      maximum: 5000
    },
    cloud_preferred_types: {
      type: 'array',
      title: '优选云端下载的文件类型',
      description: '优选云端下载的文件类型',
      items: {
        type: 'string',
        enum: ['video', 'document', 'audio', 'photo']
      },
      default: ['video', 'document'],
      uniqueItems: true
    }
  },
  required: [],
  dependencies: {
    enabled: {
      oneOf: [
        {
          properties: {
            enabled: { const: false }
          }
        },
        {
          properties: {
            enabled: { const: true },
                download_root: {\r\n      type: 'string',\r\n      title: '下载根路径',\r\n      description: 'teelebot 下载目录（Yunzai 可读路径）',\r\n      default: '',\r\n      minLength: 0\r\n    },\r\n            auth_token: { minLength: 1 }
          },
          required: ['api_endpoint', 'auth_token']
        }
      ]
    }
  }
}

export { cloudConfigSchema }
