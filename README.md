# yunzai-plugin-integration

Yunzai 功能集成插件。在 app 下按功能分目录动态加载，可通过锅巴进行配置管理。

## 新增功能（Rconsole 子集）

- `#cat`：随机猫图（来源：thecatapi）。
- `#买家秀`：随机图片（来源：uomg）。
- `#累了`：放松图集（来源：imgapi.cn）。

以上功能位于 `app/rconsole/`，并由 `app/rconsole.js` 聚合加载。

## 配置开关（锅巴）

- 路径：锅巴 → yunzai-plugin-integration → Rconsole 查询与趣味
- 配置文件：`plugins/yunzai-plugin-integration/config/rconsole.yaml`（首次由默认值生成）
- 默认模板：`plugins/yunzai-plugin-integration/config/default/default-rconsole.yaml`

示例：

```
features:
  cat: true
  buyerShow: true
  cospro: true
```

## 目录说明

- `app/rconsole/`：Rconsole 三个指令实现（`cat.js`、`买家秀.js`、`累了.js`）
- `app/rconsole.js`：rconsole 子目录的入口聚合
- `model/rconsole/rconsole-setting.js`：YAML 配置读写与热更新
- `guoba/schemas/rconsole.js`：锅巴表单 Schema
- `config/default/default-rconsole.yaml`：默认配置

