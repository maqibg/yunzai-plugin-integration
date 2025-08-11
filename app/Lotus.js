import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const lotusDir = path.join(__dirname, 'Lotus');

// 获取所有Lotus功能模块
const files = fs.existsSync(lotusDir) 
    ? fs.readdirSync(lotusDir).filter(file => file.endsWith('.js'))
    : [];

if (files.length === 0) {
    logger.info('[Lotus插件] Lotus目录下没有找到.js文件');
}

// 动态导入所有模块
let ret = [];
files.forEach((file) => {
    ret.push(import(`./Lotus/${file}`));
});

ret = await Promise.allSettled(ret);

let apps = {};
for (let i in files) {
    let name = files[i].replace('.js', '').replace('Lotus', '');
    
    if (ret[i].status != 'fulfilled') {
        logger.error(`载入Lotus子模块错误：${logger.red(name)}`);
        logger.error(ret[i].reason);
        continue;
    }
    
    const moduleExports = ret[i].value;
    const keys = Object.keys(moduleExports);
    if (keys.length > 0) {
        apps[`lotus-${name.toLowerCase()}`] = moduleExports[keys[0]];
        logger.info(`[Lotus插件] 成功载入: ${logger.green(name)}`);
    }
}

logger.info(`[Lotus插件] 共载入 ${Object.keys(apps).length} 个功能模块`);

export { apps };