import { pluginInfo } from "./pluginInfo.js"
import { config as configInfo } from "./configInfo.js"

// 适配锅巴插件
export function supportGuoba() {
  return {
    pluginInfo,
    configInfo
  }
}
