// 锅巴配置面板 Schema（Telegram 监听与转发）
// - 通过 GSubForm 定义 UI 布局，将修改后的值写回 tg-config.yaml
// - 字段说明：
//   token：官方 bot token
//   proxy：代理参数（enable、protocol、host、port）
//   polling：是否开启定时拉取与间隔（毫秒）
//   batch：每批次合并转发的节点数上限
//   dedup：去重数据保留天数
//   download.dir：下载目录（默认 plugins/.../data/temp/tg）
//   channels：频道与 QQ 目标映射（可多条）
import tgSetting from '../../model/tg/tg-setting.js'

const def = tgSetting.getConfig()

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
        value: def?.token
      },
      {
        field: 'proxy',
        label: '代理设置',
        component: 'GSubForm',
        componentProps: {
          multiple: false,
          schemas: [
            { field: 'enable', label: '启用代理', component: 'Switch', componentProps: { checkedChildren: '开启', unCheckedChildren: '关闭' }, value: def?.proxy?.enable },
            { field: 'protocol', label: '协议', component: 'Select', componentProps: { options: [ { label: 'http', value: 'http' }, { label: 'https', value: 'https' } ] }, value: def?.proxy?.protocol },
            { field: 'host', label: '主机', component: 'Input', componentProps: { placeholder: '127.0.0.1' }, value: def?.proxy?.host },
            { field: 'port', label: '端口', component: 'InputNumber', componentProps: { min: 1, max: 65535, placeholder: '7890' }, value: def?.proxy?.port }
          ]
        }
      },
      {
        field: 'polling',
        label: '轮询',
        component: 'GSubForm',
        componentProps: {
          multiple: false,
          schemas: [
            { field: 'enable', label: '开启定时拉取', component: 'Switch', componentProps: { checkedChildren: '开启', unCheckedChildren: '关闭' }, value: def?.polling?.enable },
            { field: 'interval_ms', label: '小循环间隔(ms)', bottomHelpMessage: '每个30秒轮询后的间隔时间', component: 'InputNumber', componentProps: { min: 1000, max: 120000, placeholder: '5000' }, value: def?.polling?.interval_ms },
            { field: 'timeout_sec', label: '长轮询超时(s)', bottomHelpMessage: 'TG getUpdates 长轮询超时时间', component: 'InputNumber', componentProps: { min: 1, max: 60, placeholder: '30' }, value: def?.polling?.timeout_sec },
            { field: 'cycles_per_batch', label: '大循环小循环数', bottomHelpMessage: '大循环包含的小循环次数', component: 'InputNumber', componentProps: { min: 1, max: 10, placeholder: '3' }, value: def?.polling?.cycles_per_batch },
            { field: 'batch_interval_ms', label: '大循环间隔(ms)', bottomHelpMessage: '大循环结束后的间隔时间', component: 'InputNumber', componentProps: { min: 5000, max: 300000, placeholder: '20000' }, value: def?.polling?.batch_interval_ms }
          ]
        }
      },
      {
        field: 'batch',
        label: '批次',
        component: 'GSubForm',
        componentProps: { multiple: false, schemas: [ { field: 'size', label: '每批条数', component: 'InputNumber', componentProps: { min: 1, max: 20, placeholder: '8' }, value: def?.batch?.size } ] }
      },
      {
        field: 'dedup',
        label: '去重/保留',
        component: 'GSubForm',
        componentProps: { multiple: false, schemas: [ { field: 'ttl_days', label: '去重保留(天)', component: 'InputNumber', componentProps: { min: 1, max: 30, placeholder: '7' }, value: def?.dedup?.ttl_days } ] }
      },
      {
        field: 'download',
        label: '下载目录',
        component: 'GSubForm',
        componentProps: { multiple: false, schemas: [ { field: 'dir', label: '目录', component: 'Input', componentProps: { placeholder: 'plugins/yunzai-plugin-integration/data/temp/tg' }, value: def?.download?.dir }, { field: 'max_file_mb', label: '单文件上限(MB)', component: 'InputNumber', componentProps: { min: 1, max: 50, placeholder: '20' }, value: def?.download?.max_file_mb } ] }
      },
      {
        field: 'logging',
        label: '日志设置',
        component: 'GSubForm',
        componentProps: {
          multiple: false,
          schemas: [
            { field: 'detailed', label: '详细日志', bottomHelpMessage: '开启后显示DEBUG级别的详细日志信息', component: 'Switch', componentProps: { checkedChildren: '开启', unCheckedChildren: '关闭' }, value: def?.logging?.detailed },
            { field: 'show_cycles', label: '显示循环日志', bottomHelpMessage: '显示小循环执行进度信息', component: 'Switch', componentProps: { checkedChildren: '开启', unCheckedChildren: '关闭' }, value: def?.logging?.show_cycles }
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
            { field: 'enable', label: '启用过滤器', component: 'Switch', componentProps: { checkedChildren: '开启', unCheckedChildren: '关闭' }, value: def?.filters?.enable },
            { field: 'remove_telegram_domains', label: '过滤Telegram域名', bottomHelpMessage: '将消息中的Telegram域名替换为https:///', component: 'Switch', componentProps: { checkedChildren: '开启', unCheckedChildren: '关闭' }, value: def?.filters?.remove_telegram_domains }
          ]
        }
      },
      {
        field: 'channels',
        label: '频道映射（简化）',
        bottomHelpMessage: '可添加多条：id 或 username，选择目标与类型；复杂场景可直接编辑 tg-config.yaml',
        component: 'GSubForm',
        componentProps: {
          multiple: true,
          schemas: [
            { field: 'id', label: '频道ID', component: 'Input', componentProps: { placeholder: '-100xxxxxxxxxx（优先）' } },
            { field: 'username', label: '频道用户名', component: 'Input', componentProps: { placeholder: '@channel（可选）' } },
            { field: 'types', label: '同步类型(逗号分隔)', component: 'Input', componentProps: { placeholder: 'text,photo,video,document,audio' } },
            { field: 'target', label: 'QQ 目标', component: 'GSubForm', componentProps: { multiple: false, schemas: [ { field: 'type', label: '类型', component: 'Select', componentProps: { options: [ { label: '群', value: 'group' }, { label: '私聊', value: 'user' } ] } }, { field: 'id', label: 'ID', component: 'InputNumber', componentProps: { min: 1, placeholder: '群号或 QQ 号' } } ] } }
          ]
        }
      }
    ]
  }
}
