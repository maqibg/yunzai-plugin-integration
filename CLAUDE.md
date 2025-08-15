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
```

### 主要依赖
- `axios`: HTTP客户端
- `cheerio`: HTML解析
- `yaml`: YAML配置文件解析  
- `chokidar`: 文件监控
- `lodash`: 工具库
- `node-fetch`: 网络请求
- `qrcode`: 二维码生成
- `https-proxy-agent`: HTTPS代理支持（TG模块使用）

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

- 新增功能模块需要在对应的app目录下创建
- 配置文件需要提供默认模板在`config/default/`目录
- 图片资源需要合理组织在`resources/`目录下
- 每个功能类需要正确导出以供模块系统加载
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

TG模块提供Telegram频道监听与转发功能，支持将Telegram频道的消息自动转发到QQ群或私聊。

### 核心功能
- **频道监听**：通过Telegram Bot API长轮询监听频道新消息
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
polling:                    # 轮询设置
  enable: false             # 是否启用定时轮询
  interval_ms: 5000         # 小循环间隔（毫秒）
  timeout_sec: 30           # 长轮询超时（秒）
  cycles_per_batch: 3       # 大循环包含的小循环次数
  batch_interval_ms: 20000  # 大循环结束后的间隔（毫秒）
channels:                   # 频道配置（数组）
  - id: -1001234567890      # 频道ID（优先）
    username: ""            # 或频道用户名
    types: [text, photo, video, document, audio]  # 同步类型
    target:                 # QQ转发目标
      type: group           # group/user
      id: 123456789         # 群号或QQ号
```

### 使用命令
- `#tg拉取`：智能手动拉取（停止大循环，执行短轮询，合并到当前大循环，立即发送，重置循环）

### 大循环调度机制
TG模块采用大循环批量转发机制，提高效率并减少频繁发送：

#### **循环结构**
```
大循环 = N个小循环 + 批量发送 + 大循环间隔
小循环 = 30秒长轮询 + 5秒间隔
```

#### **工作流程**
1. **小循环**：
   - 30秒长轮询收集消息（不发送）
   - 5秒间隔后进入下一个小循环
   - 重复N次（默认3次）

2. **大循环结束**：
   - 发送所有收集的消息
   - 清理临时文件
   - 20秒大循环间隔
   - 开始新的大循环

3. **手动拉取**：
   - 停止当前大循环
   - 执行2秒短轮询
   - 将结果合并到之前收集的消息
   - 立即发送所有消息
   - 重置循环计数，重启大循环

#### **配置说明**
- `cycles_per_batch: 3`：大循环包含3个小循环
- `interval_ms: 5000`：小循环间隔5秒  
- `batch_interval_ms: 20000`：大循环间隔20秒
- 总周期：3×(30s+5s) + 20s = 125秒一个完整大循环
3. **冲突防护**：
   - 全局API请求锁：确保同一时刻只有一个getUpdates请求
   - 自动取消机制：检测到并发请求时自动取消当前请求
   - 应用层锁机制：防止多个拉取实例同时运行

### 技术实现要点
- **模块入口**：`app/tg.js` 负责动态加载子模块
- **核心实现**：`app/tg/monitor.js` 实现监听、下载、转发逻辑
- **配置管理**：`model/tg/tg-setting.js` 提供配置读写与热更新
- **锅巴集成**：`guoba/schemas/tg.js` 提供可视化配置界面
- **状态持久化**：使用 `data/tg/state.json` 记录已处理消息和偏移量
- **临时存储**：媒体文件下载到 `data/temp/tg/<channel>/<YYYYMMDD>/`，转发成功后自动清理

### 安全考虑
- 所有对Telegram API的请求支持代理配置
- Bot Token通过配置文件管理，不硬编码在代码中
- 媒体文件仅临时存储，转发后自动清理
- 支持文件大小限制，防止下载过大文件
