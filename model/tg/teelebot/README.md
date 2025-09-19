# Teelebot Docker持久化目录

这个目录用于存放teelebot的Docker容器持久化文件，实现与yunzai-plugin-integration的集成。

## 目录结构

```
teelebot/
├── config/          # teelebot配置文件映射
│   └── config.cfg   # teelebot主配置文件
└── plugins/         # teelebot插件目录映射
    └── TgChannel/   # TG频道拉取插件
        ├── TgChannel.py
        ├── api_server.py
        ├── downloader.py
        ├── file_manager.py
        ├── config.json
        └── download/    # 媒体文件下载目录
            └── 2024-01-01/
                └── channel_-1001234567890/
                    ├── msg_123_text.txt
                    ├── msg_124_photo.jpg
                    └── msg_125_video.mp4
```

## 下载文件路径说明

文件将下载到以下位置：
- **完整路径**: `Yunzai\plugins\yunzai-plugin-integration\model\tg\teelebot\plugins\TgChannel\download`
- **组织方式**: 按日期和频道分组
- **文件命名**: `msg_{消息ID}_{类型}.{扩展名}`

## 使用方式

### Docker映射配置

在teelebot的Docker配置中，将这些目录映射到容器内：

```yaml
# docker-compose.yml
services:
  teelebot:
    image: ghcr.io/plutobell/teelebot:latest
    volumes:
      - "./yunzai-plugin-integration/model/tg/teelebot/config:/config"
      - "./yunzai-plugin-integration/model/tg/teelebot/plugins:/plugins"
```

### 配置文件

1. **config.cfg**: teelebot主配置文件
   - 包含Bot Token、管理员ID等基础配置
   - 插件目录指向 `/plugins`

2. **plugins/TgChannel/**: TG频道拉取插件
   - 下载目录: `./download` (相对于插件目录)
   - 实际路径: `/plugins/TgChannel/download/`

### 集成流程

1. yunzai收到#tg指令
2. 调用teelebot的HTTP API (localhost:8089)
3. teelebot插件拉取TG消息并下载到 `./download`
4. yunzai读取下载的文件并转发到QQ
5. 转发完成后清理临时文件

### 状态同步

- 去重状态文件：`yunzai-plugin-integration/data/tg/state.json`
- 两个系统共享同一个状态文件
- 确保消息不会重复处理

## 注意事项

- 确保目录权限正确，Docker容器能够读写
- 定期备份配置文件
- 监控API服务器状态 (localhost:8089)
- 查看teelebot日志排查问题
- 下载目录会按日期自动清理，可通过配置调整保留天数