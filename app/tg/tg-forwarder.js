import plugin from '../../../../lib/plugins/plugin.js';
import fetch from 'node-fetch';
import fs from 'node:fs';
import path from 'node:path';
import common from '../../../../lib/common/common.js';
import { fileURLToPath } from 'url';
import { HttpsProxyAgent } from 'https-proxy-agent';
import setting from '../../model/tg/tg-setting.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const pluginRoot = path.resolve(process.cwd(), 'plugins', 'yunzai-plugin-integration');
const tempDir = path.join(pluginRoot, 'temp', 'tg');

export class TgForwarder extends plugin {
  constructor() {
    super({
      name: '[TG插件] Telegram消息转发',
      dsc: '监控Telegram频道并转发到QQ群',
      event: 'message',
      priority: 500,
      rule: [
        { reg: '^#拉取tg$', fnc: 'manualFetch' },
        { reg: '^#tg状态$', fnc: 'getStatus' },
        { reg: '^#停止tg$', fnc: 'stopMonitoring' }
      ]
    });
    
    this.monitorInterval = null;
    this.isRunning = false;
    this.lastUpdateId = this.loadLastUpdateId();
    
    // 确保临时目录存在
    this.ensureTempDir();
    
    // 启动时自动开始监控
    this.startMonitoring();
  }

  async manualFetch(e) {
    if (!e.isMaster) return e.reply('❌ 权限不足，仅主人可操作');
    
    await e.reply('🔄 开始手动拉取TG消息...');
    
    try {
      const result = await this.fetchAndForward();
      if (result.count > 0) {
        await e.reply(`✅ 成功转发 ${result.count} 条消息`);
      } else {
        await e.reply('💡 暂无新消息');
      }
      
      // 重新开始定时监控
      this.restartMonitoring();
      
    } catch (error) {
      logger.error('[TG转发] 手动拉取失败:', error);
      await e.reply(`❌ 拉取失败: ${error.message}`);
    }
    
    return true;
  }

  async getStatus(e) {
    if (!e.isMaster) return e.reply('❌ 权限不足');
    
    const config = setting.getConfig('tg-forwarder');
    const status = this.isRunning ? '🟢 运行中' : '🔴 已停止';
    const nextCheck = this.monitorInterval ? 
      new Date(Date.now() + config.monitor.interval).toLocaleString() : '未设置';
    
    const statusMsg = [
      '📊 TG转发状态',
      `状态: ${status}`,
      `监控频道: ${config.telegram.channels.join(', ')}`,
      `目标群: ${config.qq.targetGroups.join(', ')}`,
      `检查间隔: ${config.monitor.interval / 1000}秒`,
      `下次检查: ${nextCheck}`,
      `上次消息ID: ${this.lastUpdateId || '无'}`
    ].join('\n');
    
    return e.reply(statusMsg);
  }

  async stopMonitoring(e) {
    if (!e.isMaster) return e.reply('❌ 权限不足');
    
    if (this.monitorInterval) {
      clearInterval(this.monitorInterval);
      this.monitorInterval = null;
      this.isRunning = false;
      return e.reply('⏹️ TG监控已停止');
    } else {
      return e.reply('💡 监控未运行');
    }
  }

  startMonitoring() {
    const config = setting.getConfig('tg-forwarder');
    
    if (!config.monitor.enabled) {
      logger.info('[TG转发] 监控功能已禁用');
      return;
    }
    
    if (this.monitorInterval) {
      clearInterval(this.monitorInterval);
    }
    
    this.monitorInterval = setInterval(async () => {
      try {
        await this.fetchAndForward();
      } catch (error) {
        logger.error('[TG转发] 定时监控失败:', error);
      }
    }, config.monitor.interval);
    
    this.isRunning = true;
    logger.info(`[TG转发] 已启动监控，间隔 ${config.monitor.interval / 1000} 秒`);
  }

  restartMonitoring() {
    if (this.monitorInterval) {
      clearInterval(this.monitorInterval);
    }
    this.startMonitoring();
  }

  async fetchAndForward() {
    const config = setting.getConfig('tg-forwarder');
    let totalCount = 0;
    
    for (const channel of config.telegram.channels) {
      try {
        const updates = await this.getTelegramUpdates(channel);
        
        if (updates.length === 0) continue;
        
        const messages = await this.processMessages(updates);
        
        if (messages.length > 0) {
          await this.forwardToQQGroups(messages);
          totalCount += messages.length;
          
          // 更新最后处理的消息ID
          const lastUpdate = updates[updates.length - 1];
          this.saveLastUpdateId(lastUpdate.update_id);
          
          logger.info(`[TG转发] 从频道 ${channel} 转发了 ${messages.length} 条消息`);
        }
        
      } catch (error) {
        logger.error(`[TG转发] 处理频道 ${channel} 失败:`, error);
      }
    }
    
    return { count: totalCount };
  }

  async getTelegramUpdates(channel) {
    const config = setting.getConfig('tg-forwarder');
    const botToken = config.telegram.botToken;
    
    if (!botToken) {
      throw new Error('未配置Bot Token');
    }
    
    const url = `https://api.telegram.org/bot${botToken}/getUpdates`;
    const params = new URLSearchParams({
      offset: this.lastUpdateId + 1,
      limit: 100,
      allowed_updates: JSON.stringify(['channel_post'])
    });
    
    const fetchOptions = {
      method: 'GET',
      timeout: 30000
    };
    
    // 添加代理支持
    if (config.proxy.enabled && config.proxy.url) {
      fetchOptions.agent = new HttpsProxyAgent(config.proxy.url);
      logger.debug(`[TG转发] 使用代理: ${config.proxy.url}`);
    }
    
    const response = await fetch(`${url}?${params}`, fetchOptions);
    
    if (!response.ok) {
      throw new Error(`Telegram API 请求失败: ${response.status} ${response.statusText}`);
    }
    
    const data = await response.json();
    
    if (!data.ok) {
      throw new Error(`Telegram API 错误: ${data.description || '未知错误'}`);
    }
    
    // 过滤指定频道的消息
    const channelUsername = channel.replace('@', '');
    return data.result.filter(update => 
      update.channel_post?.chat?.username === channelUsername
    );
  }

  async processMessages(updates) {
    const messages = [];
    
    for (const update of updates) {
      try {
        const post = update.channel_post;
        const messageContent = [];
        
        // 处理文本
        if (post.text || post.caption) {
          const text = post.text || post.caption || '';
          if (text.trim()) {
            messageContent.push(text);
          }
        }
        
        // 处理图片
        if (post.photo && post.photo.length > 0) {
          const photo = post.photo[post.photo.length - 1]; // 最高质量
          if (photo.file_size <= 50 * 1024 * 1024) { // 50MB限制
            const imagePath = await this.downloadMedia(photo.file_id, 'photo');
            if (imagePath) {
              messageContent.push(segment.image(imagePath));
            }
          }
        }
        
        // 处理视频
        if (post.video) {
          if (post.video.file_size <= 50 * 1024 * 1024) { // 50MB限制
            const videoPath = await this.downloadMedia(post.video.file_id, 'video');
            if (videoPath) {
              messageContent.push(segment.video(videoPath));
            }
          } else {
            logger.info(`[TG转发] 视频文件过大 (${post.video.file_size}B)，跳过处理`);
          }
        }
        
        // 处理文档
        if (post.document && post.document.file_size <= 50 * 1024 * 1024) {
          const docPath = await this.downloadMedia(post.document.file_id, 'document');
          if (docPath) {
            const fileName = post.document.file_name || `document_${Date.now()}`;
            messageContent.push(`📄 文档: ${fileName}`);
            // 注意：QQ可能不支持直接发送文档，这里只是示例
          }
        }
        
        if (messageContent.length > 0) {
          messages.push({
            content: messageContent,
            date: new Date(post.date * 1000),
            messageId: post.message_id,
            channelTitle: post.chat.title || post.chat.username
          });
        }
        
      } catch (error) {
        logger.error('[TG转发] 处理单条消息失败:', error);
      }
    }
    
    return messages;
  }

  async downloadMedia(fileId, type) {
    try {
      const fileUrl = await this.getFileUrl(fileId);
      if (!fileUrl) return null;
      
      const config = setting.getConfig('tg-forwarder');
      const fetchOptions = { timeout: 60000 };
      
      if (config.proxy.enabled && config.proxy.url) {
        fetchOptions.agent = new HttpsProxyAgent(config.proxy.url);
      }
      
      const response = await fetch(fileUrl, fetchOptions);
      
      if (!response.ok) {
        throw new Error(`下载失败: ${response.status}`);
      }
      
      const buffer = await response.buffer();
      const fileName = `${type}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}.${this.getFileExtension(type)}`;
      const filePath = path.join(tempDir, fileName);
      
      fs.writeFileSync(filePath, buffer);
      return filePath;
      
    } catch (error) {
      logger.error(`[TG转发] 下载媒体失败 (${type}):`, error);
      return null;
    }
  }

  async getFileUrl(fileId) {
    try {
      const config = setting.getConfig('tg-forwarder');
      const botToken = config.telegram.botToken;
      
      const url = `https://api.telegram.org/bot${botToken}/getFile?file_id=${fileId}`;
      const fetchOptions = { timeout: 10000 };
      
      if (config.proxy.enabled && config.proxy.url) {
        fetchOptions.agent = new HttpsProxyAgent(config.proxy.url);
      }
      
      const response = await fetch(url, fetchOptions);
      const data = await response.json();
      
      if (data.ok && data.result.file_path) {
        return `https://api.telegram.org/file/bot${botToken}/${data.result.file_path}`;
      }
      
      return null;
    } catch (error) {
      logger.error('[TG转发] 获取文件URL失败:', error);
      return null;
    }
  }

  async forwardToQQGroups(messages) {
    const config = setting.getConfig('tg-forwarder');
    
    if (messages.length === 0) return;
    
    // 构建合并转发消息
    const forwardMsgs = messages.map(msg => ({
      message: Array.isArray(msg.content) ? msg.content : [msg.content],
      nickname: `📡 ${msg.channelTitle || 'TG频道'}`,
      user_id: Bot.uin
    }));
    
    try {
      const forwardMsg = await Bot.makeForwardMsg(forwardMsgs);
      
      for (const groupId of config.qq.targetGroups) {
        try {
          await Bot.sendGroupMsg(groupId, forwardMsg);
          logger.info(`[TG转发] 成功转发到群 ${groupId}`);
          
          // 等待一下避免发送过快
          await new Promise(resolve => setTimeout(resolve, 1000));
          
        } catch (error) {
          logger.error(`[TG转发] 发送到群 ${groupId} 失败:`, error);
        }
      }
      
    } catch (error) {
      logger.error('[TG转发] 创建合并转发消息失败:', error);
    }
    
    // 转发完成后清理文件
    await this.cleanupFiles(messages);
  }

  async cleanupFiles(messages) {
    for (const msg of messages) {
      if (Array.isArray(msg.content)) {
        for (const item of msg.content) {
          if (typeof item === 'object' && item.file) {
            try {
              if (fs.existsSync(item.file)) {
                fs.unlinkSync(item.file);
                logger.debug(`[TG转发] 清理文件: ${item.file}`);
              }
            } catch (error) {
              logger.warn(`[TG转发] 清理文件失败: ${error.message}`);
            }
          }
        }
      }
    }
  }

  getFileExtension(type) {
    const extensions = {
      photo: 'jpg',
      video: 'mp4',
      document: 'bin',
      audio: 'mp3'
    };
    return extensions[type] || 'bin';
  }

  loadLastUpdateId() {
    const dataFile = path.join(pluginRoot, 'data', 'tg-last-update.json');
    
    try {
      if (fs.existsSync(dataFile)) {
        const data = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
        return data.lastUpdateId || 0;
      }
    } catch (error) {
      logger.warn('[TG转发] 读取上次更新ID失败:', error);
    }
    
    return 0;
  }

  saveLastUpdateId(updateId) {
    const dataDir = path.join(pluginRoot, 'data');
    const dataFile = path.join(dataDir, 'tg-last-update.json');
    
    try {
      if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
      }
      
      const data = { 
        lastUpdateId: updateId, 
        lastUpdate: new Date().toISOString() 
      };
      
      fs.writeFileSync(dataFile, JSON.stringify(data, null, 2));
      this.lastUpdateId = updateId;
      
    } catch (error) {
      logger.error('[TG转发] 保存更新ID失败:', error);
    }
  }

  ensureTempDir() {
    try {
      if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
        logger.info(`[TG转发] 创建临时目录: ${tempDir}`);
      }
    } catch (error) {
      logger.error('[TG转发] 创建临时目录失败:', error);
    }
  }

  // 插件销毁时清理
  destroy() {
    if (this.monitorInterval) {
      clearInterval(this.monitorInterval);
      this.monitorInterval = null;
    }
    this.isRunning = false;
    logger.info('[TG转发] 插件已停止');
  }
}