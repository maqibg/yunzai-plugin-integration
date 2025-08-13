# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

这是一个Yunzai-Bot的集成插件，名为`yunzai-plugin-integration`，集成了多个功能模块：
- **Lotus**: 多媒体和网络服务功能（B站等）
- **cyxz**: 查询相关功能
- **hs**: 图片和娱乐功能（丁真、小黑子图片等）
- **auto-plugin**: 自动化功能和策略

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
└── auto-plugin/            # 自动插件子功能模块
model/                      # 配置和数据模型
config/                     # 配置文件
├── default/                # 默认配置模板
resources/                  # 静态资源（图片等）
guoba/                      # 锅巴插件配置界面
```

### 模块加载机制
- 项目采用模块化架构，每个主模块（Lotus、cyxz、hs、auto-plugin）都有独立的入口文件
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
