import plugin from '../../../../lib/plugins/plugin.js';
import fetch from 'node-fetch';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import setting from '../../model/lotus/lotus-setting.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const pluginRoot = path.resolve(process.cwd(), 'plugins', 'yunzai-plugin-integration');
const dataDir = path.join(pluginRoot, 'data', 'bilibili');
const BILI_VIDEO_INFO_API = "http://api.bilibili.com/x/web-interface/view";
const BILI_PLAY_STREAM_API = "https://api.bilibili.com/x/player/playurl";
const BILI_STREAM_INFO_API = "https://api.live.bilibili.com/room/v1/Room/get_info";
const BILI_SUMMARY_API = "https://api.bilibili.com/x/web-interface/view/conclusion/get";
const COMMON_HEADER = {
    'User-Agent': 'Mozilla.5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.0.0 Safari/537.36',
    'Referer': 'https://www.bilibili.com/',
};
const redisBiliKey = "lotus:parser:bilibili_multi_page:";

export class LotusBilibiliParser extends plugin {
    constructor() {
        super({
            name: '[Lotus插件] B站解析',
            dsc: '处理B站视频、直播链接',
            event: 'message',
            priority: 0,
            rule: [
                {
                    reg: '(bilibili.com|b23.tv|bili2233.cn|t.bilibili.com|^BV[1-9a-zA-Z]{10}$)',
                    fnc: 'parse'
                },
                { reg: '^#B站登录$', fnc: 'login', permission: 'master' },
                { reg: '^#p\\s*(\\d+)$', fnc: 'handlePageSelection' }
            ]
        });
        // 移除构造函数中的立即清理，改为发送完成后清理
    }

    cleanupDataDir() {
        if (!fs.existsSync(dataDir)) {
            fs.mkdirSync(dataDir, { recursive: true });
            return;
        }
        try {
            const files = fs.readdirSync(dataDir);
            for (const file of files) {
                const fullPath = path.join(dataDir, file);
                if (fs.statSync(fullPath).isDirectory()) {
                    fs.rmSync(fullPath, { recursive: true, force: true });
                }
            }
        } catch (err) {
            logger.error(`[Lotus插件][B站] 自动清理临时文件失败: ${err.message}`);
        }
    }

    async parse(e) {
        const rawMsg = e.raw_message || e.msg || "";
        const cleanMsg = rawMsg.replace(/\\\//g, '/');
        const surgicalRegex = /(https?:\/\/(?:www\.bilibili\.com\/video\/[^"'\s,\]}]+|b23\.tv\/[^"'\s,\]}]+|live\.bilibili\.com\/[^"'\s,\]}]+))|(BV[1-9a-zA-Z]{10})/i;
        const match = cleanMsg.match(surgicalRegex);
        if (!match) return false;

        const contentToParse = match[1] || match[2];

        try {
            const normalizedUrl = await this.normalizeUrl(contentToParse);
            if (normalizedUrl.includes("live.bilibili.com")) {
                await this.handleLive(e, normalizedUrl);
                return true;
            }

            const videoInfo = await this.getVideoInfo(normalizedUrl);
            if (!videoInfo) throw new Error("未能获取到视频信息");

            if (videoInfo.pages.length > 1) {
                const redisKey = `${redisBiliKey}${e.group_id}:${e.user_id}`;
                await redis.set(redisKey, JSON.stringify({ url: normalizedUrl, videoInfo }), { EX: 300 });

                await e.reply(this.constructInfoMessage(videoInfo, null, true));
                await e.reply("这是一个视频合集，请在5分钟内回复 `#p[序号]` 进行下载。");

            } else {
                await this.handleSinglePageVideo(e, normalizedUrl, videoInfo);
            }
        } catch (error) {
            logger.error(`[Lotus插件][B站解析] 处理失败:`, error);
            await e.reply('B站解析失败，请稍后重试');
            return false;
        }
        return true;
    }

    async handlePageSelection(e) {
        const redisKey = `${redisBiliKey}${e.group_id}:${e.user_id}`;
        const dataJson = await redis.get(redisKey);
        if (!dataJson) {
            return e.reply("分P选择已超时，请重新发送视频链接。");
        }
        await redis.del(redisKey);

        const { url, videoInfo } = JSON.parse(dataJson);
        const selection = e.msg.replace(/^#p\s*/, '').trim().toLowerCase();

        const tempPath = path.join(dataDir, `${e.group_id || e.user_id}_${Date.now()}`);

        try {
            const pageNum = parseInt(selection);
            if (isNaN(pageNum)) return;

        const cfg = setting.getConfig('lotus-parser');
        if (!cfg || !cfg.bilibili) {
            logger.error('[Lotus插件] 配置文件加载失败，请检查 lotus-parser.yaml');
            return e.reply('配置文件加载失败，请联系管理员');
        }
            const pageInfo = videoInfo.pages[pageNum - 1];
            if (!pageInfo) {
                return e.reply(`指定的P${pageNum}不存在，该合集共有${videoInfo.pages.length}P。`);
            }
            if (pageInfo.duration > cfg.bilibili.durationLimit) {
                return e.reply(`P${pageNum}时长超过 ${(cfg.bilibili.durationLimit / 60).toFixed(0)} 分钟限制，不发送文件。`);
            }

            await fs.promises.mkdir(tempPath, { recursive: true });
            if (cfg.bilibili.useBBDown) {
                await this.downloadSingleWithBBDown(e, url, tempPath, videoInfo, pageNum);
            } else {
                await this.downloadWithApi(e, `${url}?p=${pageNum}`, videoInfo, tempPath);
            }
        } catch (error) {
            logger.error(`[Lotus插件][B站][分P选择] 失败:`, error);
            await e.reply(`处理分P #${selection} 失败: ${error.message.split('\n')[0]}`);
        } finally {
            if (fs.existsSync(tempPath)) {
                try { await fs.promises.rm(tempPath, { recursive: true, force: true }); }
                catch (err) { logger.warn(`[Lotus插件] 清理临时文件夹(分P) ${tempPath} 失败: ${err.message}`); }
            }
        }
    }
    
    async handleSinglePageVideo(e, url, videoInfo) {
        await e.reply(this.constructInfoMessage(videoInfo));
        await this.trySendSummary(e, url, videoInfo);
        const cfg = setting.getConfig('lotus-parser');
        if (!cfg || !cfg.bilibili) {
            logger.error('[Lotus插件] 配置文件加载失败，请检查 lotus-parser.yaml');
            return e.reply('配置文件加载失败，请联系管理员');
        }
        if (videoInfo.duration > cfg.bilibili.durationLimit) {
            return e.reply(`视频时长超过 ${(cfg.bilibili.durationLimit / 60).toFixed(0)} 分钟限制，不发送文件。`);
        }

        // 检查文件大小限制
        if (cfg.bilibili.fileSizeLimit && cfg.bilibili.fileSizeLimit > 0) {
            const estimatedSize = await this.checkVideoSize(videoInfo, cfg);
            if (estimatedSize > cfg.bilibili.fileSizeLimit) {
                const sizeText = `预估大小: ${estimatedSize}MB，超过 ${cfg.bilibili.fileSizeLimit}MB 限制`;
                const config = setting.getConfig('lotus-parser');
                return e.reply([
                    `${config?.general?.identifyPrefix || '[Lotus解析]'} ${videoInfo.title}`,
                    `\n📺 UP主: ${videoInfo.owner.name}`,
                    `\n⏰ 时长: ${Math.floor(videoInfo.duration / 60)}:${(videoInfo.duration % 60).toString().padStart(2, '0')}`,
                    `\n👀 播放: ${this.formatNumber(videoInfo.stat.view)} | 👍 点赞: ${this.formatNumber(videoInfo.stat.like)}`,
                    `\n💬 ${videoInfo.desc.substring(0, 100)}${videoInfo.desc.length > 100 ? '...' : ''}`,
                    `\n🔗 链接: https://www.bilibili.com/video/${videoInfo.bvid}`,
                    `\n⚠️ ${sizeText}，仅提供视频信息`
                ]);
            }
        }

        const tempPath = path.join(dataDir, `${e.group_id || e.user_id}_${Date.now()}`);
        try {
            await fs.promises.mkdir(tempPath, { recursive: true });
            if (cfg.bilibili.useBBDown) {
                await this.downloadSingleWithBBDown(e, url, tempPath, videoInfo);
            } else {
                await this.downloadWithApi(e, url, videoInfo, tempPath);
            }
        } catch (error) {
            logger.error(`[Lotus插件][B站][单P] 失败:`, error);
            await e.reply(`解析失败: ${error.message.split('\n')[0]}`);
        } finally {
            if (fs.existsSync(tempPath)) {
                try { await fs.promises.rm(tempPath, { recursive: true, force: true }); }
                catch (err) { logger.warn(`[Lotus插件] 清理临时文件夹(单P) ${tempPath} 失败: ${err.message}`); }
            }
        }
    }
    

    async downloadSingleWithBBDown(e, url, tempPath, videoInfo, pageNum = null) {
        await this.runBBDown(url, tempPath, pageNum, `-F ${videoInfo.bvid}`);
        // 递归查找 BBDown 输出（可能位于以数字或标题命名的子目录，文件名通常为“标题+后缀”，多P时含【P*】）
        const candidates = [];
        const walk = (dir) => {
            let list = [];
            try { list = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
            for (const ent of list) {
                const p = path.join(dir, ent.name);
                if (ent.isDirectory()) walk(p);
                else if (/\.(mp4|mkv)$/i.test(ent.name)) candidates.push(p);
            }
        };
        walk(tempPath);
        if (candidates.length === 0) {
            throw new Error(`BBDown执行完毕，但未找到输出视频文件: 目录 ${tempPath}`);
        }
        // 如果指定了分P，优先匹配 [P{n}] 或 【P{n}】
        const pTag = pageNum ? new RegExp(`(?:\\\\[|【)\\s*P\\s*${pageNum}(?:\\\\]|】)`, 'i') : null;
        let pickList = candidates;
        if (pTag) {
            const filtered = candidates.filter(f => pTag.test(path.basename(f)));
            if (filtered.length > 0) pickList = filtered;
        }
        // 选择体积最大的一个作为最优输出
        const pick = pickList.sort((a, b) => {
            try { return fs.statSync(b).size - fs.statSync(a).size; } catch { return 0; }
        })[0];
        const finalName = path.basename(pick);
        await this.sendVideo(e, pick, finalName);
    }
    
    async handleLive(e, url) {
        const roomId = url.match(/live\.bilibili\.com\/(\d+)/)?.[1];
        if (!roomId) throw new Error("无法获取直播间ID");
        const infoResp = await fetch(`${BILI_STREAM_INFO_API}?id=${roomId}`, { headers: COMMON_HEADER });
        const infoJson = await infoResp.json();
        if (infoJson.code !== 0) throw new Error(`获取直播间信息失败: ${infoJson.message}`);
        const { title, user_cover } = infoJson.data;
        const config = setting.getConfig('lotus-parser');
        const liveMessage = [
            segment.image(user_cover),
            `${config?.general?.identifyPrefix || '[Lotus插件]'} B站直播: ${title}\n📺 独立播放器: https://www.bilibili.com/blackboard/live/live-activity-player.html?enterTheRoom=0&cid=${roomId}`
        ];
        await e.reply(liveMessage);
    }

    async login(e) {
        const bbdownPath = await this.findCommandPath('BBDown');
        if (!bbdownPath) {
            return e.reply("未找到BBDown.exe，请主人安装并配置好环境变量，或在parser.yaml中配置toolsPath后重试。");
        }
        
        const configDirForLogin = path.join(pluginRoot, 'config');
        const qrcodePath = path.join(configDirForLogin, 'qrcode.png');
        const logPath = path.join(configDirForLogin, 'login-temp.log');

        if (fs.existsSync(qrcodePath)) try { fs.unlinkSync(qrcodePath); } catch {}
        if (fs.existsSync(logPath)) try { fs.unlinkSync(logPath); } catch {}
        
        await e.reply("正在启动BBDown登录进程，请稍候...");

        const command = `"${bbdownPath}" login > "${logPath}" 2>&1`;
        const bbdown = spawn(command, { cwd: configDirForLogin, shell: true });

        let sent = false;
        const checkQRCode = setInterval(async () => {
            if (sent) {
                clearInterval(checkQRCode);
                return;
            }
            if (fs.existsSync(qrcodePath)) {
                sent = true;
                clearInterval(checkQRCode);
                try {
                    await new Promise(resolve => setTimeout(resolve, 1000));
                    await e.reply([segment.image(qrcodePath), "请使用Bilibili APP扫描二维码进行登录。"]);
                } catch (err) {
                    logger.error(`[Lotus插件][B站登录] 发送二维码失败:`, err);
                    e.reply("生成二维码成功，但发送失败，请检查后台日志。");
                }
            }
        }, 1000);

        bbdown.on('close', async (code) => {
            sent = true;
            clearInterval(checkQRCode);
            
            let logContent = '';
            if (fs.existsSync(logPath)) {
                logContent = fs.readFileSync(logPath, 'utf8');
            }

            if (logContent.includes("登录成功")) {
                await e.reply("BBDown登录成功！Cookie已保存至BBDown.data。");
            } else {
                await e.reply("BBDown登录进程已结束，但未检测到明确的成功标识。\n如果已扫码，可能已经成功，请尝试解析一个会员视频以验证。");
            }

            setTimeout(() => {
                if (fs.existsSync(qrcodePath)) try { fs.unlinkSync(qrcodePath); } catch {}
                if (fs.existsSync(logPath)) try { fs.unlinkSync(logPath); } catch {}
            }, 2000);
        });

        bbdown.on('error', err => {
            sent = true;
            clearInterval(checkQRCode);
            logger.error(`[Lotus插件][B站登录] 启动进程失败:`, err);
            e.reply(`启动BBDown登录进程失败: ${err.message}`);
        });
        return true;
    }

    async downloadWithApi(e, url, videoInfo, tempPath) {
         try {
            await e.reply("(小提示：启用BBDown并登录，可解析更高画质和会员视频哦！)");
            const pParam = this.getPParam(url);
            let targetCid = videoInfo.cid;
            if (pParam && videoInfo.pages && videoInfo.pages.length >= pParam) {
                targetCid = videoInfo.pages[pParam - 1].cid;
            }
            const { videoUrl, audioUrl } = await this.getDownloadUrl(videoInfo.bvid, targetCid);
            if (!videoUrl) throw new Error("未能获取到视频流链接");
            const videoFile = path.join(tempPath, 'video.m4s');
            const audioFile = path.join(tempPath, 'audio.m4s');
            const outputFile = path.join(tempPath, 'output.mp4');
            await this.downloadFile(videoFile, videoUrl);
            if (audioUrl) {
                await this.downloadFile(audioFile, audioUrl);
                await this.mergeFilesWithFfmpeg(null, outputFile, videoFile, audioFile);
            } else {
                fs.renameSync(videoFile, outputFile);
            }
            const finalFileName = `av${videoInfo.aid}.mp4`;
            await this.sendVideo(e, outputFile, finalFileName);
         } catch(error) {
            logger.error(`[Lotus插件][API下载] 失败:`, error);
            await e.reply(`视频下载失败: ${error.message}`);
        }
    }
    
    async normalizeUrl(input) {
        if (input.startsWith('https://www.bilibili.com/video/') || input.startsWith('https://live.bilibili.com/')) {
            return input;
        }
        const idMatch = input.match(/(BV[1-9a-zA-Z]{10})/i) || input.match(/(av[0-9]+)/i);
        if (idMatch) {
            return `https://www.bilibili.com/video/${idMatch[0]}`;
        }
        const shortUrlMatch = input.match(/https?:\/\/b23\.tv\/[a-zA-Z0-9]+/);
        if (shortUrlMatch) {
            try {
                const resp = await fetch(shortUrlMatch[0], { method: 'HEAD', redirect: 'follow' });
                return resp.url;
            } catch (err) {
                logger.error(`[Lotus插件][B站] 短链展开失败: ${err.message}`);
                throw new Error("展开B站短链失败");
            }
        }
        throw new Error("无法规范化链接格式");
    }
    
    async getVideoInfo(url) {
        const idMatch = url.match(/video\/([a-zA-Z0-9]+)/);
        if (!idMatch) throw new Error("无法从URL中提取视频ID");
        const videoId = idMatch[1];
        let apiUrl = videoId.toLowerCase().startsWith('av') ? `${BILI_VIDEO_INFO_API}?aid=${videoId.substring(2)}` : `${BILI_VIDEO_INFO_API}?bvid=${videoId}`;
        const resp = await fetch(apiUrl, { headers: COMMON_HEADER });
        const respJson = await resp.json();
        if (respJson.code !== 0) throw new Error(respJson.message || '请求错误');
        return respJson.data;
    }

    async getDownloadUrl(bvid, cid) {
        const { sessdata } = await this.getSessData();
        const cfg = setting.getConfig('lotus-parser');
        if (!cfg || !cfg.bilibili) {
            logger.error('[Lotus插件] 配置文件加载失败，请检查 lotus-parser.yaml');
            return e.reply('配置文件加载失败，请联系管理员');
        }
        const params = new URLSearchParams({ bvid, cid, qn: cfg.bilibili.resolution, fnval: 16, fourk: 1 }).toString();
        const url = `${BILI_PLAY_STREAM_API}?${params}`;
        const headers = { ...COMMON_HEADER, Cookie: `SESSDATA=${sessdata}` };
        const resp = await fetch(url, { headers });
        const respJson = await resp.json();
        if (respJson.code !== 0) throw new Error(`获取播放地址失败: ${respJson.message}`);
        const dash = respJson.data.dash;
        return { videoUrl: dash.video[0]?.baseUrl, audioUrl: dash.audio[0]?.baseUrl };
    }
    
    constructInfoMessage(videoInfo, partTitle = null, isMultiPage = false) {
        const { pic, stat, owner, title, desc, pages } = videoInfo;
        const cfg = setting.getConfig('lotus-parser');
        const b = cfg?.bilibili || {};
        const lines = [];
        // 标题
        lines.push(`${cfg?.general?.identifyPrefix || '[Lotus解析]'} ${title}`);
        if (partTitle) lines.push(`P: ${partTitle}`);
        // 基本信息
        if (b.displayInfo !== false) {
            lines.push(`UP: ${owner.name}`);
            lines.push(`播放: ${stat.view} | 弹幕: ${stat.danmaku} | 点赞: ${stat.like}`);
        } else {
            lines.push(`UP: ${owner.name}`);
        }
        // 简介
        if (b.displayIntro) {
            const limit = Number(b.introLenLimit) || 120;
            const text = desc || '';
            const intro = text.length > limit ? `${text.slice(0, limit)}...` : text;
            if (intro) lines.push(`简介: ${intro}`);
        }
        if (isMultiPage && !partTitle && pages?.length) {
            lines.push(`(共${pages.length}P)`);
        }
        const parts = [];
        if (b.displayCover !== false && pic) parts.push(segment.image(pic));
        parts.push(lines.filter(Boolean).join('\n'));
        return parts;
    }
    
    async trySendSummary(e, url, videoInfo) {
        try {
            const cfg = setting.getConfig('lotus-parser');
            const b = cfg?.bilibili || {};
            if (!b.displaySummary) return;
            const pParam = this.getPParam(url);
            let targetCid = videoInfo.cid;
            if (pParam && videoInfo.pages && videoInfo.pages.length >= pParam) {
                targetCid = videoInfo.pages[pParam - 1].cid;
            }
            const summaryText = await this.getBiliSummary(videoInfo.bvid, targetCid, videoInfo.owner.mid);
            if (summaryText) {
                await e.reply(`「Lotus x bilibili」摘要\n${summaryText}`);
            }
        } catch (err) {
            logger.debug('[Lotus插件][B站] 摘要生成失败或不支持，已忽略');
        }
    }

    async getBiliSummary(bvid, cid, up_mid) {
        try {
            const { sessdata } = await this.getSessData();
            const query = new URLSearchParams({ bvid, cid: String(cid), up_mid: String(up_mid) }).toString();
            const resp = await fetch(`${BILI_SUMMARY_API}?${query}`, {
                headers: {
                    ...COMMON_HEADER,
                    ...(sessdata ? { Cookie: `SESSDATA=${sessdata}` } : {})
                }
            });
            const json = await resp.json();
            const data = json?.data?.model_result;
            const summary = data?.summary;
            const outline = data?.outline;
            if (!summary && !outline) return '';
            let text = '';
            if (summary) text += `摘要：${summary}\n`;
            if (Array.isArray(outline)) {
                for (const item of outline) {
                    const title = item?.title;
                    const parts = item?.part_outline || [];
                    if (title) text += `- ${title}\n`;
                    for (const pt of parts) {
                        const ts = this.formatTime(pt?.timestamp || 0);
                        const ct = pt?.content || '';
                        text += `${ts}  ${ct}\n`;
                    }
                }
            }
            return text.trim();
        } catch (err) {
            return '';
        }
    }

    formatTime(totalSeconds) {
        totalSeconds = Math.max(0, Math.floor(totalSeconds));
        const h = Math.floor(totalSeconds / 3600);
        const m = Math.floor((totalSeconds % 3600) / 60);
        const s = totalSeconds % 60;
        const pad = (n) => String(n).padStart(2, '0');
        return h > 0 ? `${pad(h)}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
    }

    /**
     * 检查视频预估大小
     * @param {Object} videoInfo 视频信息
     * @param {Object} cfg 配置信息
     * @returns {Promise<number>} 预估大小(MB)
     */
    async checkVideoSize(videoInfo, cfg) {
        try {
            // 如果启用了BBDown，优先使用BBDown获取精确文件大小
            if (cfg.bilibili.useBBDown) {
                const bbdownSize = await this.getBBDownVideoInfo(videoInfo.bvid);
                if (bbdownSize > 0) {
                    logger.debug(`[Lotus插件] BBDown获取到精确大小: ${bbdownSize}MB`);
                    return bbdownSize;
                }
            }

            // 备用方案：尝试通过API获取文件大小
            const pParam = 1;
            let targetCid = videoInfo.cid;
            if (videoInfo.pages && videoInfo.pages.length >= pParam) {
                targetCid = videoInfo.pages[pParam - 1].cid;
            }

            const { videoUrl, audioUrl } = await this.getDownloadUrl(videoInfo.bvid, targetCid);
            if (videoUrl) {
                const videoSize = await this.getFileSizeFromUrl(videoUrl);
                const audioSize = audioUrl ? await this.getFileSizeFromUrl(audioUrl) : 0;
                if (videoSize > 0) {
                    const totalSize = Math.ceil((videoSize + audioSize) / (1024 * 1024));
                    logger.debug(`[Lotus插件] API获取到文件大小: ${totalSize}MB`);
                    return totalSize;
                }
            }
        } catch (error) {
            logger.debug(`[Lotus插件] 无法获取实际文件大小，使用估算: ${error.message}`);
        }

        // 如果无法获取实际大小，使用时长和分辨率估算
        return this.estimateVideoSize(videoInfo, cfg);
    }

    /**
     * 使用BBDown获取视频信息和大小
     * @param {string} bvid 视频BVID
     * @returns {Promise<number>} 文件大小(MB)
     */
    async getBBDownVideoInfo(bvid) {
        return new Promise((resolve) => {
            try {
                const cfg = setting.getConfig('lotus-parser');
                const toolsPath = cfg?.external_tools?.toolsPath;
                let bbdownPath = 'BBDown';
                
                if (toolsPath) {
                    // 如果配置了工具路径，使用配置的路径
                    bbdownPath = path.join(toolsPath, 'BBDown.exe');
                } else {
                    // 否则尝试使用系统PATH中的BBDown
                    bbdownPath = 'BBDown';
                }
                
                // 使用BBDown的 --only-show-info 参数获取视频信息
                const command = `"${bbdownPath}" --only-show-info "https://www.bilibili.com/video/${bvid}"`;
                
                const { exec } = require('child_process');
                const timeout = setTimeout(() => {
                    logger.debug(`[Lotus插件] BBDown信息查询超时`);
                    resolve(0);
                }, 15000); // 15秒超时

                exec(command, { encoding: 'utf8', maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
                    clearTimeout(timeout);
                    
                    if (error) {
                        logger.debug(`[Lotus插件] BBDown信息查询失败: ${error.message}`);
                        resolve(0);
                        return;
                    }

                    try {
                        // 解析BBDown输出，查找文件大小信息
                        // BBDown --only-show-info 会输出详细的视频信息包括大小
                        const output = stdout + stderr; // BBDown有时会把信息输出到stderr
                        
                        // 匹配各种可能的大小格式
                        const sizePatterns = [
                            /大小[:\s]*(\d+(?:\.\d+)?)\s*(MB|GB|KB)/i,
                            /size[:\s]*(\d+(?:\.\d+)?)\s*(MB|GB|KB)/i,
                            /文件大小[:\s]*(\d+(?:\.\d+)?)\s*(MB|GB|KB)/i,
                            /预计大小[:\s]*(\d+(?:\.\d+)?)\s*(MB|GB|KB)/i,
                            /(\d+(?:\.\d+)?)\s*(MB|GB|KB)(?=\s|$)/i
                        ];
                        
                        for (const pattern of sizePatterns) {
                            const match = output.match(pattern);
                            if (match) {
                                const size = parseFloat(match[1]);
                                const unit = match[2].toUpperCase();
                                
                                let sizeInMB = 0;
                                switch (unit) {
                                    case 'GB': sizeInMB = Math.ceil(size * 1024); break;
                                    case 'MB': sizeInMB = Math.ceil(size); break;
                                    case 'KB': sizeInMB = Math.ceil(size / 1024); break;
                                    default: sizeInMB = Math.ceil(size / (1024 * 1024)); break;
                                }
                                
                                logger.debug(`[Lotus插件] BBDown解析到视频大小: ${size} ${unit} (${sizeInMB}MB)`);
                                resolve(sizeInMB);
                                return;
                            }
                        }
                        
                        logger.debug(`[Lotus插件] BBDown输出中未找到大小信息`);
                        resolve(0);
                    } catch (parseError) {
                        logger.debug(`[Lotus插件] 解析BBDown输出失败: ${parseError.message}`);
                        resolve(0);
                    }
                });
            } catch (error) {
                logger.debug(`[Lotus插件] BBDown大小查询异常: ${error.message}`);
                resolve(0);
            }
        });
    }

    /**
     * 通过URL获取文件大小
     * @param {string} url 文件URL
     * @returns {Promise<number>} 文件大小(字节)
     */
    async getFileSizeFromUrl(url) {
        try {
            const response = await fetch(url, { 
                method: 'HEAD',
                headers: COMMON_HEADER,
                timeout: 5000 
            });
            const contentLength = response.headers.get('content-length');
            return contentLength ? parseInt(contentLength, 10) : 0;
        } catch (error) {
            logger.debug(`[Lotus插件] 获取文件大小失败: ${error.message}`);
            return 0;
        }
    }

    /**
     * 估算视频大小(基于时长和分辨率)
     * @param {Object} videoInfo 视频信息
     * @param {Object} cfg 配置信息
     * @returns {number} 预估大小(MB)
     */
    estimateVideoSize(videoInfo, cfg) {
        const duration = videoInfo.duration; // 秒
        const resolution = cfg.bilibili.resolution || 64; // 默认720P

        // 根据分辨率设置基础码率 (kbps)
        let baseBitrate;
        switch (resolution) {
            case 120: baseBitrate = 6000; break; // 4K
            case 116: baseBitrate = 4000; break; // 1080P60
            case 112: baseBitrate = 3500; break; // 1080P高码率
            case 80:  baseBitrate = 2500; break; // 1080P
            case 74:  baseBitrate = 2000; break; // 720P60
            case 64:  baseBitrate = 1500; break; // 720P
            case 32:  baseBitrate = 800;  break; // 480P
            case 16:  baseBitrate = 400;  break; // 360P
            default:  baseBitrate = 1500; break; // 默认720P
        }

        // 音频码率估算 (约128kbps)
        const audioBitrate = 128;
        
        // 总码率
        const totalBitrate = baseBitrate + audioBitrate;
        
        // 计算文件大小：码率(kbps) * 时长(s) / 8 / 1024 = MB
        const estimatedSize = Math.ceil((totalBitrate * duration) / 8192);
        
        logger.debug(`[Lotus插件] 视频大小估算: 时长${duration}s, 分辨率${resolution}, 预估${estimatedSize}MB`);
        
        return estimatedSize;
    }

    getPParam(url) {
        try { return new URL(url).searchParams.get('p'); } 
        catch (e) { const pMatch = url.match(/[?&]p=([^&]+)/); return pMatch ? pMatch[1] : null; }
    }

    async mergeFilesWithFfmpeg(filelistPath, outputFile, videoFile = null, audioFile = null) {
        const ffmpegPath = await this.findCommandPath('ffmpeg');
        if (!ffmpegPath) throw new Error("未找到ffmpeg");

        let args;
        if (filelistPath) {
            args = ['-f', 'concat', '-safe', '0', '-i', filelistPath, '-c', 'copy', outputFile];
        } else if (videoFile && audioFile) {
            args = ['-i', videoFile, '-i', audioFile, '-c', 'copy', outputFile];
        } else {
            throw new Error("无效的合并参数");
        }
        
        return new Promise((resolve, reject) => {
            const ffmpeg = spawn(ffmpegPath, args);
            ffmpeg.on('close', code => code === 0 ? resolve() : reject(new Error("FFmpeg合并失败")));
            ffmpeg.on('error', reject);
        });
    }
    
    downloadFile(dest, url, headers = COMMON_HEADER) {
        return new Promise((resolve, reject) => {
            fetch(url, { headers }).then(res => {
                if (!res.ok) return reject(new Error(`下载失败: ${res.statusText}`));
                const fileStream = fs.createWriteStream(dest);
                res.body.pipe(fileStream);
                fileStream.on('finish', resolve);
                fileStream.on('error', reject);
            }).catch(reject);
        });
    }

    async uploadFile(e, filePath, fileName) {
        try {
            if (e.isGroup && e.group.upload) {
                await e.group.upload(filePath, fileName);
            } else if (e.group.fs?.upload) {
                await e.group.fs.upload(filePath, "/", fileName); 
            } else {
                 await e.reply("当前环境无法上传群文件。");
            }
        } finally {}
    }

    async sendVideo(e, filePath, fileName) {
        let tempDir = null;
        try {
            const stats = fs.statSync(filePath);
            const videoSize = Math.floor(stats.size / (1024 * 1024));
            // 记录临时目录路径，用于后续清理
            tempDir = path.dirname(filePath);
            
            const cfg = setting.getConfig('lotus-parser');
            if (!cfg || !cfg.bilibili) {
                logger.error('[Lotus插件] 配置文件加载失败，请检查 lotus-parser.yaml');
                return e.reply('配置文件加载失败，请联系管理员');
            }
            
            if (videoSize > cfg.general.videoSizeLimit) {
                await e.reply(`视频大小(${videoSize}MB)超过${cfg.general.videoSizeLimit}MB限制，转为上传群文件。`);
                await this.uploadFile(e, filePath, fileName);
            } else {
                // 参考BBDown插件，读取文件内容而不是传递文件路径
                const videoBuffer = fs.readFileSync(filePath);
                await e.reply(segment.video(videoBuffer));
            }
            
            // 发送成功后延迟清理，给QQ上传时间
            setTimeout(() => {
                if (tempDir && fs.existsSync(tempDir)) {
                    try {
                        fs.rmSync(tempDir, { recursive: true, force: true });
                        logger.info(`[Lotus插件] 已清理临时目录: ${tempDir}`);
                    } catch (cleanupErr) {
                        logger.warn(`[Lotus插件] 清理临时目录失败: ${cleanupErr.message}`);
                    }
                }
            }, 60000); // 60秒后删除，给QQ足够时间上传
            
        } catch (err) {
            logger.error(`[Lotus插件] 视频发送失败: ${err.message}`);
            // 发送失败时立即清理
            if (tempDir && fs.existsSync(tempDir)) {
                try {
                    fs.rmSync(tempDir, { recursive: true, force: true });
                    logger.info(`[Lotus插件] 发送失败，已立即清理临时目录: ${tempDir}`);
                } catch (cleanupErr) {
                    logger.warn(`[Lotus插件] 清理临时目录失败: ${cleanupErr.message}`);
                }
            }
            throw err;
        }
    }
    
    async findCommandPath(command) {
        const cfg = setting.getConfig('lotus-parser');
        if (!cfg || !cfg.bilibili) {
            logger.error('[Lotus插件] 配置文件加载失败，请检查 lotus-parser.yaml');
            return e.reply('配置文件加载失败，请联系管理员');
        }
        const exe = process.platform === 'win32' ? `${command}.exe` : command;
        if (cfg.external_tools.toolsPath) {
            const cmdPath = path.join(cfg.external_tools.toolsPath, exe);
            if (fs.existsSync(cmdPath)) return cmdPath;
        }
        return new Promise((resolve) => {
            const checkCmd = process.platform === 'win32' ? 'where' : 'which';
            const child = spawn(checkCmd, [command]);
            let output = '';
            child.stdout.on('data', (data) => { output += data.toString(); });
            child.on('close', (code) => {
                if (code === 0 && output) { resolve(output.trim().split('\n')[0]); }
                else { resolve(null); }
            });
            child.on('error', (err) => {
                logger.warn(`[Lotus插件][环境检查] 执行 ${checkCmd} 失败: ${err.message}`);
                resolve(null);
            });
        });
    }

    async getSessData(forceCheckLogin = false) {
        const cfg = setting.getConfig('lotus-parser');
        if (!cfg || !cfg.bilibili) {
            logger.error('[Lotus插件] 配置文件加载失败，请检查 lotus-parser.yaml');
            return e.reply('配置文件加载失败，请联系管理员');
        }
        if (cfg.bilibili.sessData) {
            return { sessdata: cfg.bilibili.sessData, source: 'config' };
        }
        const bbdownPath = await this.findCommandPath('BBDown');
        if (bbdownPath) {
            const bbdownDir = path.dirname(bbdownPath);
            const bbdownDataPath = path.join(bbdownDir, 'BBDown.data');
            if (fs.existsSync(bbdownDataPath)) {
                try {
                    const cookieData = fs.readFileSync(bbdownDataPath, 'utf8');
                    const sessdataMatch = cookieData.match(/SESSDATA=([^;]+)/);
                    if (sessdataMatch && sessdataMatch[1]) {
                        logger.info('[Lotus插件][B站] 已自动从BBDown.data中加载Cookie。');
                        return { sessdata: sessdataMatch[1], source: 'bbdown_data' };
                    }
                } catch (error) {
                    logger.warn(`[Lotus插件][B站] 读取BBDown.data失败: ${error.message}`);
                }
            }
        }
        if (forceCheckLogin) {
            throw new Error("BBDown已启用但未找到有效登录凭据，请联系机器人管理员使用 #B站登录 指令进行登录。");
        }
        return { sessdata: "", source: 'none' };
    }

    async runBBDown(url, cwd, pageNum = null, extraArgsStr = '') {
        const cfg = setting.getConfig('lotus-parser');
        if (!cfg || !cfg.bilibili) {
            logger.error('[Lotus插件] 配置文件加载失败，请检查 lotus-parser.yaml');
            return e.reply('配置文件加载失败，请联系管理员');
        }
        const bbdownPath = await this.findCommandPath('BBDown');
        if (!bbdownPath) throw new Error("未找到BBDown，请检查环境配置");
        const resolutionMap = {
            120: '8K 超高清',
            116: '1080P 60帧',
            112: '1080P 高码率',
            80: '1080P 高清',
            74: '720P 60帧',
            64: '720P 高清', 
            32: '480P 清晰',
            16: '360P 流畅',
        };
        const dfnPriority = resolutionMap[cfg.bilibili.resolution] || String(cfg.bilibili.resolution);
        const args = [url];
        
        const { sessdata, source } = await this.getSessData();
        if (source === 'config' && sessdata) {
             args.push('-c', `SESSDATA=${sessdata}`);
        }
        if (pageNum) args.push('-p', String(pageNum));
        args.push('--dfn-priority', dfnPriority);
        if(extraArgsStr) args.push(...extraArgsStr.split(' '));
        args.push('--work-dir', cwd);

        return new Promise((resolve, reject) => {
            const bbdown = spawn(bbdownPath, args, { shell: false });
            let output = '';
            bbdown.stdout.on('data', (data) => { output += data.toString(); });
            bbdown.stderr.on('data', (data) => { output += data.toString(); });
            bbdown.on('close', (code) => {
                if (code === 0) {
                    resolve(output);
                } else {
                    reject(new Error(`BBDown进程退出，代码: ${code}\n日志: ${output}`));
                }
            });
            bbdown.on('error', (err) => reject(err));
        });
    }
}
