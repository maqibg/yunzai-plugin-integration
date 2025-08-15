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
    this.isLocked = false;
    this.lastUpdateId = this.loadLastUpdateId();
    this.abortController = null;
    this.lastFetchTime = null;
    this.lastFetchDuration = 0;
    this.successCount = 0;
    this.errorCount = 0;
    
    // 去重窗口
    this.dedupWindow = new Map(); // messageId -> timestamp
    this.maxDedupSize = 1000; // 最大去重窗口大小
    this.dedupTtl = 30 * 60 * 1000; // TTL 30分钟
    
    // 确保临时目录存在
    this.ensureTempDir();
    
    // 启动去重窗口清理定时器
    this.startDedupCleanup();
    
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

  // 去重窗口管理
  startDedupCleanup() {
    // 每5分钟清理一次过期的去重记录
    this.dedupCleanupInterval = setInterval(() => {
      this.cleanupDedupWindow();
    }, 5 * 60 * 1000);
  }

  cleanupDedupWindow() {
    const now = Date.now();
    let cleanedCount = 0;
    
    for (const [messageId, timestamp] of this.dedupWindow.entries()) {
      if (now - timestamp > this.dedupTtl) {
        this.dedupWindow.delete(messageId);
        cleanedCount++;
      }
    }
    
    // 如果还是太大，删除最老的记录
    if (this.dedupWindow.size > this.maxDedupSize) {
      const entries = Array.from(this.dedupWindow.entries())
        .sort((a, b) => a[1] - b[1]); // 按时间戳排序
      
      const toDelete = entries.slice(0, this.dedupWindow.size - this.maxDedupSize);
      toDelete.forEach(([messageId]) => {
        this.dedupWindow.delete(messageId);
        cleanedCount++;
      });
    }
    
    if (cleanedCount > 0) {
      logger.debug(`[TG转发] 清理去重窗口: 删除 ${cleanedCount} 条记录，当前大小: ${this.dedupWindow.size}`);
    }
  }

  isDuplicateMessage(messageId, chatId) {
    const key = `${chatId}_${messageId}`;
    
    if (this.dedupWindow.has(key)) {
      logger.debug(`[TG转发] 发现重复消息: ${key}`);
      return true;
    }
    
    // 添加到去重窗口
    this.dedupWindow.set(key, Date.now());
    return false;
  }

  async getStatus(e) {
    if (!e.isMaster) return e.reply('❌ 权限不足');
    
    const config = setting.getConfig('tg-forwarder');
    const status = this.isRunning ? '🟢 运行中' : '🔴 已停止';
    const lockStatus = this.isLocked ? '🔒 拉取中' : '🔓 空闲';
    const nextCheck = this.monitorInterval ? 
      new Date(Date.now() + config.monitor.interval).toLocaleString() : '未设置';
    
    const statusInfo = [
      '📊 TG转发状态',
      `运行状态: ${status}`,
      `锁状态: ${lockStatus}`,
      `监控频道: ${config.telegram.channels.join(', ')}`,
      `目标群: ${config.qq.targetGroups.join(', ')}`,
      `检查间隔: ${config.monitor.interval / 1000}秒`,
      `下次检查: ${nextCheck}`,
      '',
      '📈 统计信息',
      `上次消息ID: ${this.lastUpdateId || '无'}`,
      `最近拉取: ${this.lastFetchTime ? this.lastFetchTime.toLocaleString() : '未拉取'}`,
      `耗时: ${this.lastFetchDuration}ms`,
      `成功次数: ${this.successCount}`,
      `失败次数: ${this.errorCount}`,
      `去重窗口: ${this.dedupWindow.size}/${this.maxDedupSize}`
    ].join('\n');
    
    return e.reply(statusInfo);
  }

  async stopMonitoring(e) {
    if (!e.isMaster) return e.reply('❌ 权限不足');
    
    if (this.monitorInterval) {
      clearTimeout(this.monitorInterval);
      this.monitorInterval = null;
    }
    
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
    
    this.isRunning = false;
    this.isLocked = false;
    return e.reply('⏹️ TG监控已停止');
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
    
    // 使用新的长轮询调度机制
    this.scheduleNextFetch(config.monitor.interval);
    
    this.isRunning = true;
    logger.info(`[TG转发] 已启动监控，间隔 ${config.monitor.interval / 1000} 秒`);
  }

  restartMonitoring() {
    if (this.monitorInterval) {
      clearTimeout(this.monitorInterval);
    }
    if (this.abortController) {
      this.abortController.abort();
    }
    this.isLocked = false;
    this.startMonitoring();
  }

  // 新的调度机制 - 避免重入
  scheduleNextFetch(interval) {
    this.monitorInterval = setTimeout(async () => {
      await this.fetchAndForwardLoop();
      if (this.isRunning) {
        this.scheduleNextFetch(interval);
      }
    }, interval);
  }

  async fetchAndForwardLoop() {
    if (this.isLocked) {
      logger.warn('[TG转发] 上一次拉取尚未完成，跳过本轮');
      return { count: 0 };
    }

    this.isLocked = true;
    const startTime = Date.now();
    this.lastFetchTime = new Date();

    try {
      const result = await this.fetchAndForward();
      this.lastFetchDuration = Date.now() - startTime;
      this.successCount++;
      return result;
    } catch (error) {
      this.errorCount++;
      this.lastFetchDuration = Date.now() - startTime;
      logger.error('[TG转发] 拉取失败:', error);
      return { count: 0 };
    } finally {
      this.isLocked = false;
    }
  }

  async fetchAndForward() {
    const config = setting.getConfig('tg-forwarder');
    
    try {
      // 使用单次长轮询获取所有更新
      const updates = await this.getAllTelegramUpdates();
      
      if (updates.length === 0) {
        logger.debug('[TG转发] 暂无新消息');
        return { count: 0 };
      }
      
      // 按频道过滤消息
      const allChannels = [
        ...(config.telegram.channels || []),
        ...(config.telegram.channelsId || [])
      ];
      const filteredUpdates = this.filterUpdatesByChannels(updates, allChannels);
      
      if (filteredUpdates.length === 0) {
        logger.debug('[TG转发] 无匹配频道的消息');
        // 仍需更新lastUpdateId以避免重复处理
        const maxUpdateId = Math.max(...updates.map(u => u.update_id));
        this.saveLastUpdateId(maxUpdateId);
        return { count: 0 };
      }
      
      const messages = await this.processMessages(filteredUpdates);
      
      if (messages.length > 0) {
        await this.forwardToQQGroups(messages);
        logger.info(`[TG转发] 成功转发 ${messages.length} 条消息`);
      }
      
      // 更新最后处理的消息ID
      const maxUpdateId = Math.max(...updates.map(u => u.update_id));
      this.saveLastUpdateId(maxUpdateId);
      
      return { count: messages.length };
      
    } catch (error) {
      logger.error('[TG转发] 拉取转发失败:', error);
      throw error;
    }
  }

  // 新的统一长轮询方法
  async getAllTelegramUpdates() {
    const config = setting.getConfig('tg-forwarder');
    const botToken = config.telegram.botToken;
    
    if (!botToken) {
      throw new Error('未配置Bot Token');
    }
    
    const url = `https://api.telegram.org/bot${botToken}/getUpdates`;
    const params = new URLSearchParams({
      offset: this.lastUpdateId + 1,
      limit: 100,
      timeout: Math.floor((config.advanced?.pollTimeout || 30) * 0.9), // 略小于配置超时时间
      allowed_updates: JSON.stringify(['channel_post'])
    });
    
    const response = await this.tgApiRequest(`${url}?${params}`, {
      method: 'GET',
      timeout: (config.advanced?.requestTimeout || 30) * 1000
    });
    
    const data = await response.json();
    
    if (!data.ok) {
      throw new Error(`Telegram API 错误: ${data.description || '未知错误'}`);
    }
    
    logger.debug(`[TG转发] 获取到 ${data.result.length} 条更新`);
    return data.result || [];
  }

  // 频道过滤方法
  filterUpdatesByChannels(updates, channels) {
    if (!channels || channels.length === 0) return [];
    
    return updates.filter(update => {
      if (!update.channel_post?.chat) return false;
      
      const chat = update.channel_post.chat;
      const chatUsername = chat.username ? `@${chat.username}` : null;
      const chatId = chat.id?.toString();
      
      // 支持用户名(@channel)和chat_id匹配
      return channels.some(channel => {
        const cleanChannel = channel.replace('@', '');
        return (chatUsername && chatUsername.includes(cleanChannel)) ||
               (chatId && (chatId === channel || channel === chatId));
      });
    });
  }

  // TG API 请求抽象层，支持重试和超时
  async tgApiRequest(url, options = {}) {
    const config = setting.getConfig('tg-forwarder');
    const maxRetries = config.advanced?.retryCount || 3;
    const baseDelay = config.advanced?.retryDelay || 5000;
    
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        // 创建 AbortController 用于超时控制
        this.abortController = new AbortController();
        const timeoutId = setTimeout(() => {
          this.abortController.abort();
        }, options.timeout || 30000);
        
        const fetchOptions = {
          ...options,
          signal: this.abortController.signal
        };
        
        // 添加代理支持
        if (config.proxy.enabled && config.proxy.url) {
          fetchOptions.agent = new HttpsProxyAgent(config.proxy.url);
          logger.debug(`[TG转发] 使用代理: ${config.proxy.url}`);
        }
        
        const response = await fetch(url, fetchOptions);
        clearTimeout(timeoutId);
        
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
        return response;
        
      } catch (error) {
        clearTimeout(timeoutId);
        
        if (attempt === maxRetries) {
          throw new Error(`TG API 请求失败 (${attempt + 1}/${maxRetries + 1}): ${error.message}`);
        }
        
        // 指数退避 + 抖动
        const delay = baseDelay * Math.pow(2, attempt) + Math.random() * 1000;
        logger.warn(`[TG转发] 请求失败，${delay}ms后重试 (${attempt + 1}/${maxRetries + 1}): ${error.message}`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  async processMessages(updates) {
    const messages = [];
    
    for (const update of updates) {
      try {
        const post = update.channel_post;
        
        // 去重检查
        if (this.isDuplicateMessage(post.message_id, post.chat.id)) {
          continue; // 跳过重复消息
        }
        
        const messageContent = [];
        
        // 处理文本
        if (post.text || post.caption) {
          const text = post.text || post.caption || '';
          if (text.trim()) {
            const config = setting.getConfig('tg-forwarder');
            
            // 根据配置决定是否过滤链接
            let processedText = text;
            if (config.message?.filterLinks) {
              processedText = this.filterLinks(text);
              logger.debug(`[TG转发] 原文本: ${text.substring(0, 50)}...`);
              logger.debug(`[TG转发] 过滤后: ${processedText.substring(0, 50)}...`);
            }
            
            if (processedText.trim()) {
              messageContent.push(processedText);
            }
          }
        }
        
        // 处理图片
        if (post.photo && post.photo.length > 0) {
          const photo = post.photo[post.photo.length - 1]; // 最高质量
          const downloadResult = await this.downloadMedia(photo.file_id, 'photo');
          
          if (downloadResult) {
            if (typeof downloadResult === 'string') {
              // 普通文件路径
              messageContent.push(segment.image(downloadResult));
            } else if (downloadResult.type === 'link') {
              // 大文件链接模式
              messageContent.push(`🖼️ 图片文件过大: ${downloadResult.fileName} (${Math.round(downloadResult.size/1024/1024)}MB)`);
              messageContent.push(downloadResult.url);
            }
          }
        }
        
        // 处理视频
        if (post.video) {
          const downloadResult = await this.downloadMedia(post.video.file_id, 'video');
          
          if (downloadResult) {
            if (typeof downloadResult === 'string') {
              // 普通文件路径
              messageContent.push(segment.video(downloadResult));
            } else if (downloadResult.type === 'link') {
              // 大文件链接模式
              messageContent.push(`🎥 视频文件过大: ${downloadResult.fileName} (${Math.round(downloadResult.size/1024/1024)}MB)`);
              messageContent.push(downloadResult.url);
            }
          } else {
            logger.info(`[TG转发] 视频文件处理失败，跳过`);
          }
        }
        
        // 处理文档
        if (post.document) {
          const downloadResult = await this.downloadMedia(post.document.file_id, 'document');
          
          if (downloadResult) {
            if (typeof downloadResult === 'string') {
              // 普通文件
              const fileName = post.document.file_name || `document_${Date.now()}`;
              messageContent.push(`📄 文档: ${fileName}`);
              // 注意：QQ可能不支持直接发送文档，这里只是示例
            } else if (downloadResult.type === 'link') {
              // 大文件链接模式
              const fileName = post.document.file_name || downloadResult.fileName;
              messageContent.push(`📄 文档文件过大: ${fileName} (${Math.round(downloadResult.size/1024/1024)}MB)`);
              messageContent.push(downloadResult.url);
            }
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
      const fileInfo = await this.getFileInfo(fileId);
      if (!fileInfo) return null;
      
      const config = setting.getConfig('tg-forwarder');
      const maxSize = config.files?.maxSize || 52428800; // 50MB
      
      // 检查文件大小
      if (fileInfo.file_size > maxSize) {
        logger.info(`[TG转发] 文件过大 (${fileInfo.file_size}B > ${maxSize}B)，跳过下载`);
        
        // 如果配置了大文件链接模式，返回链接
        if (config.files?.sendLargeAsLink) {
          const botToken = config.telegram.botToken;
          const originalUrl = `https://api.telegram.org/file/bot${botToken}/${fileInfo.file_path}`;
          return {
            type: 'link',
            url: this.sanitizeTelegramUrl(originalUrl),
            originalUrl: originalUrl, // 保留原始链接以备需要
            size: fileInfo.file_size,
            fileName: this.getFileName(fileInfo, type)
          };
        }
        
        return null;
      }
      
      const fileUrl = `https://api.telegram.org/bot${config.telegram.botToken}/${fileInfo.file_path}`;
      const fileName = this.generateFileName(fileInfo, type);
      const tempDir = config.files?.tempDir || 'temp/tg';
      const fullTempDir = path.join(pluginRoot, tempDir);
      
      // 确保目录存在
      if (!fs.existsSync(fullTempDir)) {
        fs.mkdirSync(fullTempDir, { recursive: true });
      }
      
      const filePath = path.join(fullTempDir, fileName);
      
      // 流式下载
      await this.streamDownload(fileUrl, filePath, maxSize, config);
      
      return filePath;
      
    } catch (error) {
      logger.error(`[TG转发] 下载媒体失败 (${type}):`, error);
      return null;
    }
  }

  async getFileInfo(fileId) {
    try {
      const config = setting.getConfig('tg-forwarder');
      const botToken = config.telegram.botToken;
      
      const url = `https://api.telegram.org/bot${botToken}/getFile`;
      const params = new URLSearchParams({ file_id: fileId });
      
      const response = await this.tgApiRequest(`${url}?${params}`, {
        method: 'GET',
        timeout: 10000
      });
      
      const data = await response.json();
      
      if (data.ok && data.result.file_path) {
        return data.result;
      }
      
      return null;
    } catch (error) {
      logger.error('[TG转发] 获取文件信息失败:', error);
      return null;
    }
  }

  async streamDownload(url, filePath, maxSize, config) {
    return new Promise((resolve, reject) => {
      const fetchOptions = {};
      
      // 添加代理支持
      if (config.proxy.enabled && config.proxy.url) {
        fetchOptions.agent = new HttpsProxyAgent(config.proxy.url);
      }
      
      fetch(url, fetchOptions)
        .then(response => {
          if (!response.ok) {
            throw new Error(`下载失败: ${response.status}`);
          }
          
          // 检查Content-Length
          const contentLength = parseInt(response.headers.get('content-length'));
          if (contentLength > maxSize) {
            throw new Error(`文件大小超限: ${contentLength}B > ${maxSize}B`);
          }
          
          const writeStream = fs.createWriteStream(filePath);
          let downloadedSize = 0;
          
          response.body.on('data', (chunk) => {
            downloadedSize += chunk.length;
            
            // 实时检查下载大小
            if (downloadedSize > maxSize) {
              writeStream.destroy();
              try {
                fs.unlinkSync(filePath);
              } catch (e) {
                // 忽略清理错误
              }
              reject(new Error(`下载中断: 文件大小超限 ${downloadedSize}B > ${maxSize}B`));
              return;
            }
          });
          
          response.body.pipe(writeStream);
          
          writeStream.on('finish', () => {
            logger.debug(`[TG转发] 下载完成: ${filePath} (${downloadedSize}B)`);
            resolve();
          });
          
          writeStream.on('error', (error) => {
            fs.unlink(filePath, () => {}); // 清理失败的文件
            reject(error);
          });
          
        })
        .catch(reject);
    });
  }

  generateFileName(fileInfo, type) {
    const timestamp = Date.now();
    const randomStr = Math.random().toString(36).substr(2, 9);
    
    // 优先使用file_path推断扩展名
    if (fileInfo.file_path) {
      const pathExt = path.extname(fileInfo.file_path);
      if (pathExt) {
        return `${type}_${timestamp}_${randomStr}${pathExt}`;
      }
    }
    
    // 回退到默认扩展名
    const ext = this.getFileExtension(type);
    return `${type}_${timestamp}_${randomStr}.${ext}`;
  }

  getFileName(fileInfo, type) {
    if (fileInfo.file_path) {
      const pathBasename = path.basename(fileInfo.file_path);
      if (pathBasename !== fileInfo.file_path) {
        return pathBasename;
      }
    }
    
    return `${type}_${Date.now()}.${this.getFileExtension(type)}`;
  }

  // 清理Telegram链接，删除敏感域名和token信息
  sanitizeTelegramUrl(url) {
    if (!url) return '';
    
    // 删除 t.me 域名相关的部分
    let cleanUrl = url
      // 移除 api.telegram.org 域名，只保留路径
      .replace(/https?:\/\/api\.telegram\.org/gi, '')
      // 移除 t.me 域名
      .replace(/https?:\/\/t\.me\//gi, '')
      // 移除其他常见的telegram域名
      .replace(/https?:\/\/web\.telegram\.org/gi, '')
      // 清理多余的斜杠
      .replace(/^\/+/, '');
    
    // 进一步清理bot token（格式：botTOKEN:HASH）
    cleanUrl = cleanUrl.replace(/bot\d+:[A-Za-z0-9_-]+/gi, 'bot***');
    
    // 如果清理后的链接太短或无效，返回提示文本
    if (cleanUrl.length < 5) {
      return '[ Telegram链接已清理 ]';
    }
    
    // 返回清理后的路径，不包含敏感信息
    return cleanUrl;
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
      const minInterval = (config.message?.sendInterval || 1) * 1000; // 最小发送间隔
      
      for (let i = 0; i < config.qq.targetGroups.length; i++) {
        const groupId = config.qq.targetGroups[i];
        
        try {
          await Bot.sendGroupMsg(groupId, forwardMsg);
          logger.info(`[TG转发] 成功转发到群 ${groupId}`);
          
          // 发送间隔控制
          if (i < config.qq.targetGroups.length - 1) {
            await new Promise(resolve => setTimeout(resolve, minInterval));
          }
          
        } catch (error) {
          logger.error(`[TG转发] 发送到群 ${groupId} 失败:`, error);
          
          // 发送失败时重试一次
          if (config.message?.retryOnFailure !== false) {
            try {
              await new Promise(resolve => setTimeout(resolve, 2000));
              await Bot.sendGroupMsg(groupId, forwardMsg);
              logger.info(`[TG转发] 重试成功转发到群 ${groupId}`);
            } catch (retryError) {
              logger.error(`[TG转发] 重试失败，群 ${groupId}:`, retryError);
            }
          }
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
        
        // 加载计数器状态
        this.successCount = data.successCount || 0;
        this.errorCount = data.errorCount || 0;
        
        logger.info(`[TG转发] 加载状态: 上次更新=${data.lastUpdateAt || '未知'}, 成功=${this.successCount}, 失败=${this.errorCount}`);
        
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
        lastUpdateAt: new Date().toISOString(),
        successCount: this.successCount,
        errorCount: this.errorCount,
        version: '2.0' // 配置版本标识
      };
      
      fs.writeFileSync(dataFile, JSON.stringify(data, null, 2));
      this.lastUpdateId = updateId;
      
      logger.debug(`[TG转发] 更新状态: ID=${updateId}, 成功=${this.successCount}, 失败=${this.errorCount}`);
      
    } catch (error) {
      logger.error('[TG转发] 保存更新ID失败:', error);
    }
  }

  ensureTempDir() {
    try {
      const config = setting.getConfig('tg-forwarder');
      const tempDir = path.join(pluginRoot, config.files?.tempDir || 'temp/tg');
      
      if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
        logger.info(`[TG转发] 创建临时目录: ${tempDir}`);
      }
    } catch (error) {
      logger.error('[TG转发] 创建临时目录失败:', error);
    }
  }

  // 过滤文本中的链接
  filterLinks(text) {
    if (!text) return '';
    
    // 定义各种链接的正则表达式
    const linkPatterns = [
      // HTTP/HTTPS 链接
      /https?:\/\/[^\s<>"{}|\\^`\[\]]+/gi,
      
      // FTP 链接
      /ftp:\/\/[^\s<>"{}|\\^`\[\]]+/gi,
      
      // 邮箱链接
      /mailto:[^\s<>"{}|\\^`\[\]]+/gi,
      
      // Telegram 链接 (重点处理)
      /https?:\/\/(?:t\.me|api\.telegram\.org|web\.telegram\.org)\/[^\s<>"{}|\\^`\[\]]+/gi,
      /t\.me\/[^\s<>"{}|\\^`\[\]]+/gi,
      
      // 简化的 www 链接
      /www\.[^\s<>"{}|\\^`\[\]]+/gi,
      
      // 其他协议链接
      /[a-zA-Z][a-zA-Z0-9+.-]*:\/\/[^\s<>"{}|\\^`\[\]]+/gi,
      
      // 纯域名形式 (包含至少一个点)
      /(?:^|[\s\n])([a-zA-Z0-9][a-zA-Z0-9-]*[a-zA-Z0-9]*\.)+[a-zA-Z]{2,}(?:\/[^\s]*)?(?=[\s\n]|$)/gi
    ];
    
    let filteredText = text;
    
    // 逐个应用过滤规则
    linkPatterns.forEach(pattern => {
      filteredText = filteredText.replace(pattern, '');
    });
    
    // 清理多余的空白字符
    filteredText = filteredText
      .replace(/\s+/g, ' ')  // 多个空格合并为一个
      .replace(/\n\s*\n/g, '\n')  // 多个换行合并
      .trim();
    
    return filteredText;
  }

  // 插件销毁时清理
  destroy() {
    if (this.monitorInterval) {
      clearTimeout(this.monitorInterval);
      this.monitorInterval = null;
    }
    if (this.dedupCleanupInterval) {
      clearInterval(this.dedupCleanupInterval);
      this.dedupCleanupInterval = null;
    }
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
    this.isRunning = false;
    this.isLocked = false;
    this.dedupWindow.clear();
    logger.info('[TG转发] 插件已停止');
  }
}