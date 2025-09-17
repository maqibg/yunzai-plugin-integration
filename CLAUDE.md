# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

这是一个Yunzai-Bot的集成插件，名为`yunzai-plugin-integration`，集成了多个功能模块：
- **Lotus**: 多媒体和网络服务功能（B站等）
- **cyxz**: 查询相关功能
- **hs**: 图片和娱乐功能（丁真、小黑子图片等）
- **auto-plugin**: 自动化功能和策略
- **tg**: Telegram频道监听与转发功能

## 项目架构

### 核心文件结构
```
index.js                    # 主入口文件，动态加载所有app模块
guoba.support.js            # 锅巴插件支持
app/                        # 主要功能模块
├── Lotus.js                # Lotus模块入口
├── Lotus/                  # Lotus子功能模块
├── cyxz.js                 # 查询功能入口  
├── cyxz/                   # 查询子功能模块
├── hs.js                   # 娱乐功能入口
├── hs/                     # 娱乐子功能模块
├── auto-plugin.js          # 自动插件入口
├── auto-plugin/            # 自动插件子功能模块
├── tg.js                   # TG模块入口
└── tg/                     # TG子功能模块
    └── monitor.js          # TG频道监听与转发核心实现
model/                      # 配置和数据模型
├── tg/                     # TG模块配置管理
│   └── tg-setting.js       # TG配置读写与热更新
config/                     # 配置文件
├── default/                # 默认配置模板
│   ├── dafult-tg-config.yaml # TG模块默认配置
resources/                  # 静态资源（图片等）
guoba/                      # 锅巴插件配置界面
├── schemas/                # 配置Schema定义
│   └── tg.js               # TG模块锅巴配置界面
data/                       # 数据存储目录
└── temp/tg/                # TG媒体文件临时下载目录
```

### 模块加载机制
- 项目采用模块化架构，每个主模块（Lotus、cyxz、hs、auto-plugin、tg）都有独立的入口文件
- 入口文件负责动态加载对应子目录下的所有.js文件
- 使用ES6模块和动态import进行模块加载
- 所有模块导出`apps`对象，包含各自的功能类

### 配置系统
- 使用YAML格式的配置文件
- 配置文件分为默认配置（default/）和用户配置
- 支持热重载配置文件
- 主要配置类型：
  - lotus配置：网络服务相关配置
  - hs配置：娱乐功能配置
  - auto-plugin配置：自动化策略配置
  - tg-config配置：Telegram频道监听与转发配置

## 常用开发命令

由于这是一个Node.js插件项目，没有构建、测试或linting脚本配置。

### 依赖管理
```bash
npm install                 # 安装依赖
pnpm install               # 推荐使用pnpm安装依赖
```

### 开发调试
```bash
# 在Yunzai根目录启动机器人进行测试
node app.js

# 查看插件加载日志
tail -f logs/command.log
```

### 主要依赖
- `axios`: HTTP客户端，用于网络请求
- `cheerio`: HTML解析，用于网页内容提取
- `yaml`: YAML配置文件解析和写入
- `chokidar`: 文件监控，用于配置热重载
- `lodash`: 工具库，提供常用函数
- `node-fetch`: 网络请求库
- `qrcode`: 二维码生成
- `https-proxy-agent`: HTTPS代理支持（TG模块使用）
- `iconv-lite`: 字符编码转换

## 锅巴插件集成

项目集成了锅巴插件系统：
- `guoba.support.js`: 锅巴插件支持入口
- `guoba/`: 锅巴配置界面相关文件
  - `pluginInfo.js`: 插件信息
  - `configInfo.js`: 配置界面定义
  - `schemas/`: 配置项Schema定义

## 资源管理

- 静态资源存放在`resources/`目录
- 主要包含娱乐功能使用的图片资源
- 按功能模块分目录存放

## 开发注意事项

### 模块开发规范
- 新增功能模块需要在对应的app目录下创建
- 每个主模块都需要有入口文件（如`app/模块名.js`）和子目录（如`app/模块名/`）
- 入口文件负责动态加载子目录下的所有.js文件
- 每个功能类需要正确导出以供模块系统加载，导出格式为`export { apps }`

### 配置文件规范
- 配置文件需要提供默认模板在`config/default/`目录
- 默认配置文件命名格式：`default-模块名-配置名.yaml`
- 用户配置文件会在首次运行时从默认配置复制生成
- 支持配置热重载，修改后无需重启

### 资源管理
- 图片资源需要合理组织在`resources/`目录下
- 按功能模块分目录存放
- 临时文件存放在`data/temp/`目录下

### 代码风格
- 使用ES6模块语法（import/export）
- 遵循现有的错误处理模式
- 日志输出使用统一的logger对象
- 异步操作使用async/await语法

## B站解析展示配置（Lotus）

已在 Lotus 模块接入可配置的展示内容，默认仅展示封面与基本信息：

配置文件：`config/default/default-lotus-parser.yaml`（首次运行会复制到 `config/lotus-parser.yaml`）

```yaml
bilibili:
  displayCover: true     # 是否显示封面
  displayInfo: true      # 是否显示播放/弹幕/点赞等信息
  displayIntro: false    # 是否显示简介
  introLenLimit: 120     # 简介最大长度
  displaySummary: false  # 是否显示B站官方总结（需Cookie，可能受限）
```

锅巴界面：在「Lotus解析器配置 -> B站解析配置」下可视化切换以上开关与长度。

注意：开启 `displaySummary` 需要有效的 `SESSDATA`（可在配置 `sessData` 或通过 BBDown 登录生成）。

## Telegram模块（TG）

TG模块提供Telegram频道监听与转发功能，通过#tg指令手动触发拉取并转发消息到QQ群或私聊。

### 核心功能
- **指令触发**：通过#tg指令手动触发获取频道新消息
- **媒体下载**：自动下载文本、图片、视频、文档、音频等内容到本地
- **智能转发**：根据媒体类型选择最佳QQ消息格式（图片段、视频段、音频段、文件段）
- **合并转发**：将TG消息整合为QQ合并转发消息
- **去重机制**：避免重复转发已处理的消息
- **代理支持**：支持HTTP/HTTPS代理访问Telegram API

### 配置文件结构
配置文件：`config/tg-config.yaml`（首次运行从 `config/default/dafult-tg-config.yaml` 自动复制）

```yaml
token: ""                    # Telegram Bot Token（必填）
proxy:                       # 代理设置
  enable: false
  protocol: http            # http/https
  host: 127.0.0.1
  port: 7890
batch:                       # 批量转发设置
  size: 8                   # 每批转发消息数量
dedup:                       # 去重设置
  ttl_days: 7               # 去重数据保留天数
download:                    # 下载设置
  dir: plugins/yunzai-plugin-integration/data/temp/tg
  max_file_mb: 20           # 单文件大小限制(MB)
channels:                   # 频道配置（数组）
  - id: -1001234567890      # 频道ID（优先）
    username: ""            # 或频道用户名
    types: [text, photo, video, document, audio]  # 同步类型
    target:                 # QQ转发目标
      type: group           # group/user
      id: 123456789         # 群号或QQ号
```

### 使用命令
- `#tg`：手动拉取TG频道新消息并转发到配置的QQ目标
- `#tg拉取`：同上（兼容指令）
- `#拉取tg`：同上（兼容指令）

### 工作原理
TG模块采用指令触发模式，不再使用自动轮询：

1. **触发拉取**：用户发送#tg指令
2. **获取消息**：使用短轮询（5秒超时）快速获取新消息
3. **处理转发**：立即下载媒体并转发到配置的QQ目标
4. **清理资源**：转发完成后自动清理临时文件

### 技术实现要点
- **模块入口**：`app/tg.js` 负责动态加载子模块
- **核心实现**：`app/tg/monitor.js` 实现指令触发、下载、转发逻辑
- **配置管理**：`model/tg/tg-setting.js` 提供配置读写与热更新
- **锅巴集成**：`guoba/schemas/tg.js` 提供可视化配置界面
- **状态持久化**：使用 `data/tg/state.json` 记录已处理消息和偏移量
- **临时存储**：媒体文件下载到 `data/temp/tg/<channel>/<YYYYMMDD>/`，转发成功后自动清理
- **请求管理**：全局API请求锁确保同一时刻只有一个getUpdates请求

### 安全考虑
- 所有对Telegram API的请求支持代理配置
- Bot Token通过配置文件管理，不硬编码在代码中
- 媒体文件仅临时存储，转发后自动清理
- 支持文件大小限制，防止下载过大文件

### 调试和故障排除
- TG模块支持详细日志输出，可在配置中开启`logging.detailed`
- 使用全局API请求锁避免并发冲突
- 支持请求超时和错误重试机制
- 媒体文件按频道和日期分层存储，便于管理和清理

## 项目专家AI团队

该项目已配置了8个专业AI智能体，专门针对不同模块和功能领域提供专家级支持：

### 🚀 核心架构专家
- **yunzai-plugin-architect** (sonnet): 插件模块化架构设计与优化专家
- **yunzai-yaml-config-manager** (haiku): YAML配置管理与热重载专家

### 📡 功能模块专家
- **yunzai-telegram-integration-specialist** (sonnet): Telegram Bot API集成与转发专家
- **yunzai-bilibili-parser-expert** (sonnet): B站内容解析与展示专家
- **yunzai-entertainment-module-developer** (haiku): 娱乐功能与图片处理专家
- **yunzai-automation-strategy-expert** (sonnet): 自动化策略与智能指令专家

### 🛠️ 系统支持专家
- **yunzai-media-processing-expert** (sonnet): 多媒体下载、转换与处理专家
- **yunzai-guoba-configuration-specialist** (haiku): 锅巴配置界面与Schema专家

### 团队协作模式
每个智能体都有明确的职责边界和协作模式：
- **专业分工**: 每个智能体专注特定领域，避免职责重叠
- **智能协作**: 智能体间通过定义的输入输出关系进行协作
- **模型优化**: 根据任务复杂度选择最适合的模型（sonnet/haiku）

### 使用方式
使用 `/ai "任务描述"` 命令可自动调用相应的专家智能体，例如：
- `/ai "优化TG频道监听性能"` → yunzai-telegram-integration-specialist
- `/ai "添加B站解析新功能"` → yunzai-bilibili-parser-expert  
- `/ai "设计新的配置界面"` → yunzai-guoba-configuration-specialist
