import rconsoleSetting from '../../model/rconsole/rconsole-setting.js'

const defaultConfig = rconsoleSetting.getConfig('rconsole')

export const rconsoleSchema = {
  field: 'rconsole',
  label: 'Rconsole 查询与趣味',
  component: 'GSubForm',
  componentProps: {
    multiple: false,
    schemas: [
      {
        field: 'features',
        label: '功能开关',
        component: 'GSubForm',
        componentProps: {
          multiple: false,
          schemas: [
            {
              field: 'cat',
              label: '#cat 吸猫',
              component: 'Switch',
              componentProps: { checkedChildren: '开启', unCheckedChildren: '关闭' },
              value: defaultConfig?.features?.cat
            },
            {
              field: 'buyerShow',
              label: '#买家秀',
              component: 'Switch',
              componentProps: { checkedChildren: '开启', unCheckedChildren: '关闭' },
              value: defaultConfig?.features?.buyerShow
            },
            {
              field: 'cospro',
              label: '#累了',
              component: 'Switch',
              componentProps: { checkedChildren: '开启', unCheckedChildren: '关闭' },
              value: defaultConfig?.features?.cospro
            }
          ]
        }
      }
    ]
  }
}

