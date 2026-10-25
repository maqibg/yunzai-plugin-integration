# yunzai-plugin-integration

<div align="center">


# 🎯 Yunzai 功能集成插件

*一个集成了多个常用Yunzai插件功能的综合插件*

[![Version](https://img.shields.io/badge/version-1.0.0-blue.svg)](https://github.com/your-repo/yunzai-plugin-integration)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![Yunzai](https://img.shields.io/badge/Yunzai-v3+-red.svg)](https://github.com/Le-niao/Yunzai-Bot)
[![Node.js](https://img.shields.io/badge/Node.js-16+-brightgreen.svg)](https://nodejs.org)

</div>

## 📖 简介

yunzai-plugin-integration 是一个为 Yunzai-Bot 设计的综合性插件，集成了多个热门插件的核心功能，让您无需安装多个插件即可享受丰富的机器人功能。

## ✨ 功能特色

### 🎪 **娱乐功能模块 (HS)**

- 🤡 **坤坤丁真功能**：支持丁真图片、坤坤图片发送
- 📅 **星期几查询**：一键查询今天星期几
- 🖼️ **图片管理**：支持上传、删除自定义图片
- ⚙️ **配置管理**：支持锅巴插件可视化配置

### 🌸 **多媒体解析模块 (Lotus)**

- 📺 **B站解析**：视频（含分P）、动态、直播间、评论区、点赞投币收藏关注
- 🎬 **画质与下载**：登录后走高清分离流下载并合并，未登录自动降级；同一条视频解析成功才会进入冷却
- 📦 **大文件处理**：下载前先按配置预估大小，超过直发上限自动改为上传群文件
- 🎨 **自定义配置**：灵活的解析参数设置

### 🤖 **自动化模块 (Auto-Plugin)**

- 📋 **自动回复**：智能自动回复系统
- 🔄 **策略管理**：多种自动化策略
- ⏰ **定时任务**：支持定时执行功能
- 🎯 **精准控制**：细粒度权限管理

### 🔍 **查询功能模块 (Cyxz)**

- 📊 **数据查询**：多种数据查询功能
- 🔗 **接口集成**：整合常用API接口
- 📈 **结果展示**：美观的查询结果展示

### 🐾 **Rconsole 查询与趣味模块**

- 🐱 `#cat`：随机猫图（来源：thecatapi，合并转发多图）。
- 😮‍💨 `#累了`：放松图集（来源：imgapi.cn，合并转发多图）。
  - 锅巴可控制开关；位于 `app/rconsole/`，由 `app/rconsole.js` 动态聚合加载。

## 🚀 安装指南

### 环境要求

- Node.js >= 16.0.0
- Yunzai-Bot v3+
- pnpm (推荐)

### 使用 Git 安装

```bash
# 进入 Yunzai 插件目录
cd Yunzai-Bot/plugins

# 克隆插件
git clone https://github.com/maqibg/yunzai-plugin-integration.git

# 进入插件目录
cd yunzai-plugin-integration

# 安装依赖
pnpm install
# 或者在 Yunzai 根目录执行
# pnpm install --filter=yunzai-plugin-integration
```

### 使用包管理器安装

```bash
# 在 Yunzai 根目录执行
pnpm install -P  # 安装所有插件的生产依赖
```

## ⚙️ 配置说明

插件支持锅巴插件可视化配置，也可以手动编辑配置文件：

### 配置文件位置

```
plugins/yunzai-plugin-integration/
├── config/
│   ├── hs-kunkundinzhen.yaml      # 娱乐功能配置
│   ├── bilibili.yaml              # B站解析配置（首次自动生成）
│   └── rconsole.yaml              # Rconsole 查询与趣味配置（首次自动生成）
└── resources/                     # 资源文件
```

### 主要配置项

#### 坤坤丁真功能配置

```yaml
# hs-kunkundinzhen.yaml
dz: true        # 丁真功能开关
kunkun: true    # 坤坤功能开关  
weekday: true   # 星期几功能开关
```

#### B站解析配置

```yaml
# bilibili.yaml
basic:
  enable: true           # 解析功能开关
  cooldown: 10           # 同一群内同一视频的解析冷却（秒），私聊按人算

auth:
  cookie: ""             # 扫码登录后自动写入，不要手改
  refresh_token: ""      # 刷新令牌，同样由登录流程维护

video:
  quality: 80            # 默认画质（64=720P 80=1080P 112=1080P高码率，高画质需大会员）
  durationLimit: 3600    # 超过这个时长只发信息不下载（秒）
  fileSizeLimit: 2580    # 超过这个大小不下载（MB，0 表示不限）
  sendThreshold: 200     # 超过这个大小改为上传群文件（MB）
  smartQuality:
    enable: true         # 按文件大小自动降级画质
    threshold: 100       # 触发降级的体积（MB）
    targetSize: 80       # 降级目标体积（MB）
    priority: [80, 64, 32, 16]

multiPage:
  timeout: 300           # 分P选择等待时间（秒）
  autoFirstPage: false   # 是否自动播放第一P

display:
  showCover: true        # 显示封面
  showStats: true        # 显示播放量/弹幕/点赞
  showDesc: true         # 显示简介
  descMaxLength: 120     # 简介截断长度
  commentCount: 10       # 「展开N」显示多少条评论

push:
  enable: true           # UP主更新推送
  interval: 3            # 检查间隔（分钟），改动后需重启
```

#### Rconsole 配置

```yaml
# rconsole.yaml
features:
  cat: true       # #cat 吸猫
  cospro: true    # #累了
```

## 🎮 使用方法

### 娱乐功能

```bash
# 丁真相关
一眼丁真          # 发送丁真图片
雪豹闭嘴          # 发送丁真图片
芝士雪豹          # 发送丁真图片

# 坤坤相关  
鸡你太美          # 发送坤坤图片
坤坤             # 发送坤坤图片
小黑子           # 发送坤坤图片

# 其他功能
今天星期几        # 查询星期几
#上传坤图         # 上传自定义图片 (仅主人)
#爱坤图片列表      # 查看图片列表 (仅主人)
#删除坤图1        # 删除图片 (仅主人)
```

### 多媒体解析

```bash
# 支持解析以下链接
https://www.bilibili.com/video/BV1234567890  # B站视频
https://live.bilibili.com/123456             # B站直播
https://t.bilibili.com/123456789             # B站动态
```

## 🔧 锅巴插件集成

本插件完美支持锅巴插件 (Guoba-Plugin) 可视化配置：

1. 安装锅巴插件
2. 访问锅巴管理面板
3. 找到 "Yunzai 功能集成插件"
4. 点击进入配置页面
5. 可视化修改各项设置

### 配置项说明

- **坤坤丁真功能配置**：控制娱乐功能开关
- **Lotus解析器配置**：设置多媒体解析参数
- **Rconsole 查询与趣味**：开启/关闭 `#cat`、`#累了`

## 📁 项目结构

```
yunzai-plugin-integration/
├── 📁 app/                    # 功能模块
│   ├── 🎪 hs.js              # 娱乐功能入口
│   ├── 🌸 Lotus.js           # 多媒体解析入口
│   ├── 🤖 auto-plugin.js     # 自动化功能入口
│   ├── 🔍 cyxz.js            # 查询功能入口
│   ├── 🐾 rconsole.js        # Rconsole 查询与趣味入口
│   └── 📁 rconsole/          # Rconsole 子功能（cat/累了）
│   └── 📁 */                 # 各模块子功能
├── 📁 config/                # 配置文件
│   └── default/              # 默认配置模板（含 default-rconsole.yaml）
├── 📁 guoba/                 # 锅巴插件支持
├── 📁 model/                 # 数据模型
│   └── rconsole/             # rconsole-setting.js（YAML 读写与热更新）
├── 📁 resources/             # 静态资源
├── 📄 index.js               # 主入口文件
├── 📄 guoba.support.js       # 锅巴支持文件
└── 📄 package.json           # 依赖配置
```

## 🐾 Rconsole 使用示例

```bash
# 趣味/查询
#cat
#累了
```

## 🔗 原项目来源

本插件集成了以下优秀项目的功能：

| 模块            | 原项目            | 作者           | 链接                                                     |
| --------------- | ----------------- | -------------- | -------------------------------------------------------- |
| **HS**          | hs-qiqi-cv-plugin | kesally        | [GitHub](https://github.com/kesally/hs-qiqi-cv-plugin)   |
| **Auto-Plugin** | auto-plugin       | Nwflower       | [GitHub](https://github.com/Nwflower/auto-plugin)        |
| **Lotus**       | Lotus-Plugin      | SummerLotus520 | [GitHub](https://github.com/SummerLotus520/Lotus-Plugin) |
| **Cyxz**        | cyxz-plugin       | xiaotian2333   | [GitHub](https://github.com/xiaotian2333/cyxz-plugin)    |
| rconsole        | rconsole-plugin   | zhiyu1998      | [GitHub](https://github.com/zhiyu1998/rconsole-plugin)   |

## 🤝 贡献指南

欢迎提交 Issue 和 Pull Request！

1. Fork 本仓库
2. 创建特性分支 (`git checkout -b feature/AmazingFeature`)
3. 提交更改 (`git commit -m 'Add some AmazingFeature'`)
4. 推送到分支 (`git push origin feature/AmazingFeature`)
5. 开启 Pull Request

## 📝 更新日志

### v1.0.0 (2024-01-XX)

- 🎉 首次发布
- ✨ 集成 HS 娱乐功能模块
- ✨ 集成 Lotus 多媒体解析模块  
- ✨ 集成 Auto-Plugin 自动化模块
- ✨ 集成 Cyxz 查询功能模块
- 🔧 支持锅巴插件可视化配置
- 💡 支持配置注释保留
- 📊 新增视频文件大小限制功能，超限自动提供信息而非下载

## ⚠️ 注意事项

1. **权限要求**：某些功能需要主人权限才能使用
2. **资源占用**：多媒体解析功能可能消耗较多带宽
3. **配置备份**：建议定期备份重要配置文件
4. **更新提醒**：更新插件前请备份自定义配置

## 🆘 常见问题

<details>
<summary>Q: 安装后插件无法正常工作？</summary>


A: 请检查：

- Node.js 版本是否 >= 16
- 是否正确安装了依赖 (`pnpm install`)
- Yunzai 版本是否兼容
- 配置文件是否正确
  </details>

<details>
<summary>Q: B站解析失败？</summary>


A: 请检查：

- 网络连接是否正常
- 是否已完成扫码登录（执行 #b站登录），Cookie 过期会提示重新登录
- 机器人是否还在登录状态（执行 #b站登录 可重新扫码）
- 链接格式是否正确

## 📄 许可证

本项目采用 [MIT](LICENSE) 许可证

## 💖 致谢

感谢以下项目和开发者的贡献：

- [Yunzai-Bot](https://github.com/Le-niao/Yunzai-Bot) - 优秀的QQ机器人框架
- [Guoba-Plugin](https://github.com/guoba-yunzai/guoba-plugin) - 强大的可视化管理工具
- [hs-qiqi-cv-plugin](https://github.com/kesally/hs-qiqi-cv-plugin) by kesally - 提供娱乐功能模块
- [auto-plugin](https://github.com/Nwflower/auto-plugin) by Nwflower - 提供自动化功能模块  
- [Lotus-Plugin](https://github.com/SummerLotus520/Lotus-Plugin) by SummerLotus520 - 提供多媒体解析功能
- [cyxz-plugin](https://github.com/xiaotian2333/cyxz-plugin) by xiaotian2333 - 提供查询功能模块
- [rconsole-plugin](https://github.com/zhiyu1998/rconsole-plugin) by zhiyu1998 - 哔哩哔哩强化 #cat #累了

---

<div align="center">


**如果这个插件对您有帮助，请给一个 ⭐ Star！**



</div>
