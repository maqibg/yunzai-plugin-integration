import plugin from '../../../../lib/plugins/plugin.js'
import fs from 'node:fs'
import common from '../../../../lib/common/common.js'
import setting from '../../model/hs/hs-setting.js'

const xhz_path = "plugins/yunzai-plugin-integration/resources/hs/小黑子图片/"
const dz_path = "plugins/yunzai-plugin-integration/resources/hs/丁真图片/"
const week_path = "plugins/yunzai-plugin-integration/resources/hs/周几/"
let source = {}

// 初始化目录
await initDirectories()

export default class HsDingzhen extends plugin {
  constructor() {
    super({
      /** 功能名称 */
      name: "一眼丁真",
      /** 功能描述 */
      dsc: "每日一张丁真图片或坤坤图片",
      event: "message",
      /** 优先级，数字越小等级越高 */
      priority: 10,
      rule: [
        {
          reg: "^#?上传坤图$",
          fnc: "uploadKunTu"
        },
        {
          reg: "^#?爱坤(图片)?列表$",
          fnc: "showKunList"
        },
        {
          reg: "^#?删除坤图(\\d)+$",
          fnc: "deleteKunTu"
        },
        {
          reg: "鸡你太美|坤坤|小黑子|鲲鲲|鸽鸽",
          fnc: "sendKunTu"
        },
        {
          reg: "一眼丁真|雪豹闭嘴|芝士雪豹|雪豹|讨口子",
          fnc: "sendDingzhen"
        },
        {
          reg: "^丁真帮助",
          fnc: "showHelp"
        },
        {
          reg: /^#?今天(周|星期)几$/i,
          fnc: "showWeekday"
        }
      ]
    })
  }

  /**
   * 坤图列表
   * @param {object} e
   */
  async showKunList(e) {
    let config = setting.getConfig('hs-kunkundinzhen')
    if (!config.kunkun) return this.reply("坤坤功能已关闭")
    if (!e.isMaster) { return false }
    
    let msglist = []
    try {
      let files = fs.readdirSync(xhz_path)
      if (files.length == 0) {
        e.reply("目前一张图都没有请使用上传坤图")
        return true
      }
      msglist.push(`坤坤图片共${files.length}张，可输入【删除坤图+(序列号)】进行删除`)
      for (let i = 0; i < files.length; i++) {
        msglist.push([`${i + 1}.`, segment.image(`file://${xhz_path}${files[i]}`)])
      }

      let msgRsg = await e.reply(await common.makeForwardMsg(e, msglist))
      if (!msgRsg) e.reply("可能风控了，私聊查看试试", true)
    } catch (err) {
      logger.error(err)
    }
  }

  /**
   * 删除图片
   * @param {object} e
   */
  async deleteKunTu(e) {
    let config = setting.getConfig('hs-kunkundinzhen')
    if (!config.kunkun) return this.reply("坤坤功能已关闭")
    if (!e.isMaster) { return false }
    
    // 获取序号
    let num = e.msg.match(/\d+/)
    if (!num) {
      return e.reply("没序列号要不先【爱坤图片列表】查看下图片对应的序列号...")
    }
    try {
      let files = fs.readdirSync(xhz_path)
      fs.unlinkSync(`${xhz_path}${files[num - 1]}`)
      await e.reply("删除成功")
    } catch (err) {
      e.reply("删除失败，请检查序列号是否正确")
    }
  }

  /**
   * 上传坤图
   * @param {object} e
   */
  async uploadKunTu(e) {
    let config = setting.getConfig('hs-kunkundinzhen')
    if (!config.kunkun) return this.reply("坤坤功能已关闭")
    if (!e.isMaster) return e.reply("只有主人能上传!!!")
    
    // 获取图片消息
    if (e.isGroup) {
      source = (await e.group.getChatHistory(e.source?.seq, 1)).pop()
    } else {
      source = (await e.friend.getChatHistory((e.source?.time + 1), 1)).pop()
    }
    
    let imageMessages = []
    if (source) {
      for (let val of source.message) {
        if (val.type === "image") {
          imageMessages.push(val.url)
        } else if (val.type === "xml") {
          let resid = val.data.match(/m_resid="(.*?)"/)?.[1]
          if (!resid) break
          let message = await Bot.getForwardMsg(resid)
          for (const item of message) {
            for (const i of item.message) {
              if (i.type === "image") {
                imageMessages.push(i.url)
              }
            }
          }
        }
      }
    } else {
      imageMessages = e.img
    }
    
    if (!imageMessages.length) return e.reply("消息中未找到图片，请将要发送的图片与消息一同发送或者引用要添加的图像哟~")
    
    try {
      let savePath
      let files
      if (!fs.existsSync(xhz_path)) fs.mkdirSync(xhz_path, { recursive: true })
      
      for (let i = 0; i < imageMessages.length; i++) {
        files = fs.readdirSync(xhz_path)
        savePath = `${xhz_path}${files.length + 1}.jpg`
        await common.downFile(imageMessages[i], savePath)
      }
      e.reply(`上传坤坤图片${imageMessages.length}张成功`)
    } catch (err) {
      logger.error(err)
      e.reply("上传坤坤图片失败")
    }
    return true
  }

  /** 丁真帮助 */
  async showHelp() {
    let config = setting.getConfig('hs-kunkundinzhen')
    if (!config.dz) return this.reply("一眼丁真功能已关闭")
    this.reply("发送一眼丁真.雪豹闭嘴.芝士雪豹.讨口子.鸡你太美.坤坤.小黑子.鲲鲲.鸽鸽.触发表情,全文匹配")
  }

  /**
   * ikun
   * @param {object} e 消息事件
   */
  async sendKunTu(e) {
    let config = setting.getConfig('hs-kunkundinzhen')
    if (!config.kunkun) { return false }
    
    try {
      let files = fs.readdirSync(xhz_path)
      if (files.length === 0) return false
      
      let imgnum = Math.floor(Math.random() * files.length)
      let msg = [segment.at(e.user_id), segment.image("file://" + xhz_path + files[imgnum])]
      await e.reply(msg)
    } catch (err) {
      logger.error('发送坤图失败:', err)
    }
    return false
  }

  /**
   * 丁真
   * @param {object} e 消息事件
   */
  async sendDingzhen(e) {
    let config = setting.getConfig('hs-kunkundinzhen')
    if (!config.dz) { return false }
    
    try {
      let files = fs.readdirSync(dz_path)
      if (files.length === 0) return false
      
      let imgnum = Math.floor(Math.random() * files.length)
      let msg = [segment.at(e.user_id), segment.image("file://" + dz_path + files[imgnum])]
      await e.reply(msg)
    } catch (err) {
      logger.error('发送丁真图失败:', err)
    }
    return false
  }

  /**
   * 显示星期几
   * @param {object} e 消息事件
   */
  async showWeekday(e) {
    let config = setting.getConfig('hs-kunkundinzhen')
    if (!config.weekday) return false
    
    let nowWeekday = new Date()
    let tdweekday = nowWeekday.getDay()
    let weekdayImages = {
      "0": `${week_path}Sunday.jpg`, // 周天 
      "1": `${week_path}Monday.jpg`, // 周一
      "2": `${week_path}Tuesday.jpg`, // 周二  
      "3": `${week_path}Wednesday.jpg`, // 周三  
      "4": `${week_path}Thursday.jpg`, // 周四 
      "5": `${week_path}Friday.jpg`, // 周五  
      "6": `${week_path}Saturday.jpg` // 周六 
    }
    
    let weekdayimg = weekdayImages[tdweekday]
    let weekdayText = ["日", "一", "二", "三", "四", "五", "六"]
    let todayWd = weekdayText[tdweekday]
    
    try {
      if (e.isMaster) {
        await this.reply([`主人 今天是『星期${todayWd}』`, segment.image("file://" + weekdayimg)], true)
      } else {
        await this.reply([`孩子们 今天『星期${todayWd}』`, segment.image("file://" + weekdayimg)], true)
      }
    } catch (err) {
      logger.error('发送星期几图片失败:', err)
      this.reply(`今天是星期${todayWd}`)
    }
    return true
  }
}

async function initDirectories() {
  try {
    if (!fs.existsSync(xhz_path)) {
      fs.mkdirSync(xhz_path, { recursive: true })
    }
    if (!fs.existsSync(dz_path)) {
      fs.mkdirSync(dz_path, { recursive: true })
    }
    if (!fs.existsSync(week_path)) {
      fs.mkdirSync(week_path, { recursive: true })
    }
  } catch (err) {
    logger.error('初始化目录失败:', err)
  }
}