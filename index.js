import fs from "fs";

logger.info('------ヾ(≧▽≦*)o------')
logger.info('yunzai-plugin-integration载入成功!')
logger.info('----------------------')

const files = fs.readdirSync("./plugins/yunzai-plugin-integration/app").filter(file => file.endsWith(".js"));

let ret = [];

files.forEach((file) => {
  ret.push(import(`./app/${file}`));
});

ret = await Promise.allSettled(ret);

let apps = {};
for (let i in files) {
  let name = files[i].replace(".js", "");
  
  if (ret[i].status != "fulfilled") {
    logger.error(`载入插件错误：${logger.red(name)}`);
    logger.error(ret[i].reason);
    continue;
  }
  
  // 处理嵌套的 apps 结构
  const moduleExports = ret[i].value;
  if (moduleExports.apps && typeof moduleExports.apps === 'object') {
    // 如果模块导出了 apps 对象，则将其内容合并到主 apps 中
    Object.assign(apps, moduleExports.apps);
  } else {
    // 否则按原来的方式处理
    apps[name] = moduleExports[Object.keys(moduleExports)[0]];
  }
}

export { apps };
