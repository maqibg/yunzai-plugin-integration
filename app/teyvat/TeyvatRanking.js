/**
 * 提瓦特小助手 - 成就/宝箱排行
 * 指令：
 *   #成就排行/查询 [UID] - 查询成就排名
 *   #成就排行榜 - 群内成就排行榜
 *   #宝箱排行/查询 [UID] - 查询宝箱排名
 *   #宝箱排行榜 - 群内宝箱排行榜
 */
import plugin from '../../../../lib/plugins/plugin.js'
import puppeteer from '../../../../lib/puppeteer/puppeteer.js'
import axios from 'axios'
import _ from 'lodash'
import fs from 'node:fs'
import path from 'node:path'
import gsCfg from '../../../genshin/model/gsCfg.js'

const _path = process.cwd()
const pluginRoot = path.join(_path, 'plugins', 'yunzai-plugin-integration')
const dataPath = path.join(_path, 'data', 'yunzai-plugin-integration', 'teyvat')

// 数据文件路径
const chestTopPath = path.join(dataPath, 'ChestTop.json')
const achieveTopPath = path.join(dataPath, 'AchieveTop.json')

export class TeyvatRanking extends plugin {
  constructor() {
    super({
      name: '提瓦特小助手-排行榜',
      dsc: '成就/宝箱排行榜',
      event: 'message',
      priority: 100,
      rule: [
        {
          reg: '^#成就(排行|排名|查询|统计)(.*)$',
          fnc: 'achieveQuery'
        },
        {
          reg: '^#宝箱(排行|排名|查询|统计)(.*)$',
          fnc: 'chestQuery'
        }
      ]
    })
  }

  /**
   * 成就查询/排行
   */
  async achieveQuery(e) {
    const msg = e.original_msg || e.msg
    if (!msg) return false

    // 判断是查询还是排行榜
    if (msg.includes('排行榜')) {
      return await this.achieveGroupTop(e)
    }
    return await this.achieveTop(e)
  }

  /**
   * 宝箱查询/排行
   */
  async chestQuery(e) {
    const msg = e.original_msg || e.msg
    if (!msg) return false

    // 判断是查询还是排行榜
    if (msg.includes('排行榜')) {
      return await this.chestGroupTop(e)
    }
    return await this.chestTop(e)
  }

  /**
   * 成就排名查询
   */
  async achieveTop(e) {
    // CD 检查
    const cdKey = `teyvat:ranking:achieve:${e.user_id}`
    if (await redis.get(cdKey)) {
      const cd = await redis.ttl(cdKey)
      e.reply(`请等待${cd}s后再请求~`, true)
      return true
    }

    const uid = await this.getUid(e)
    if (!uid) {
      e.reply('请先绑定uid 或 在指令后面加你要查询的uid')
      return true
    }

    e.reply(`正在查询 UID:${uid} 的成就排名...`)

    const url = `https://feixiaoqiu.com/search_achievement_ajax/?draw=1&columns[0][data]=total_index_div()&columns[0][name]=&columns[0][searchable]=true&columns[0][orderable]=false&columns[0][search][value]=&columns[0][search][regex]=false&columns[1][data]=nick_name_div()&columns[1][name]=&columns[1][searchable]=true&columns[1][orderable]=false&columns[1][search][value]=&columns[1][search][regex]=false&columns[2][data]=title_div()&columns[2][name]=&columns[2][searchable]=true&columns[2][orderable]=false&columns[2][search][value]=&columns[2][search][regex]=false&columns[3][data]=grade_div()&columns[3][name]=&columns[3][searchable]=true&columns[3][orderable]=false&columns[3][search][value]=&columns[3][search][regex]=false&columns[4][data]=achievement_number_div()&columns[4][name]=&columns[4][searchable]=true&columns[4][orderable]=false&columns[4][search][value]=&columns[4][search][regex]=false&start=0&length=20&search[value]=&search[regex]=false&uid=${uid}&_=${Date.now()}`

    let jsonRes
    try {
      const response = await axios.get(url, { timeout: 15000 })
      jsonRes = this.parseResponse(response.data)
    } catch (error) {
      logger.error('[成就排行] 接口请求失败！', error)
      e.reply(`成就排行接口请求失败~`)
      return true
    }

    if (jsonRes.data && jsonRes.data.length > 0) {
      jsonRes.data[0].title = unescape(jsonRes.data[0].title.replace(/\\u/g, '%u'))
      const { name, signature } = await this.getPlayerInfo(uid)

      // 保存到群排行数据
      if (e.isGroup) {
        await this.saveAchieveData(e, uid, signature, jsonRes)
      }

      await this.renderAchieve(e, uid, name, signature, jsonRes)

      // 设置 CD
      await redis.set(cdKey, 1)
      await redis.expire(cdKey, 60)
    } else {
      e.reply(`UID:${uid} 没有匹配的数据，可能是米游社权限未开放或为国际服UID`)
    }

    return true
  }

  /**
   * 宝箱排名查询
   */
  async chestTop(e) {
    // CD 检查
    const cdKey = `teyvat:ranking:chest:${e.user_id}`
    if (await redis.get(cdKey)) {
      const cd = await redis.ttl(cdKey)
      e.reply(`请等待${cd}s后再请求~`, true)
      return true
    }

    const uid = await this.getUid(e)
    if (!uid) {
      e.reply('请先绑定uid 或 在指令后面加你要查询的uid')
      return true
    }

    e.reply(`正在查询 UID:${uid} 的宝箱排名...`)

    const url = `https://feixiaoqiu.com/search_box_ajax/?draw=1&columns[0][data]=total_index_div()&columns[0][name]=&columns[0][searchable]=true&columns[0][orderable]=false&columns[0][search][value]=&columns[0][search][regex]=false&columns[1][data]=nick_name_div()&columns[1][name]=&columns[1][searchable]=true&columns[1][orderable]=false&columns[1][search][value]=&columns[1][search][regex]=false&columns[2][data]=title_div()&columns[2][name]=&columns[2][searchable]=true&columns[2][orderable]=false&columns[2][search][value]=&columns[2][search][regex]=false&columns[3][data]=grade_div()&columns[3][name]=&columns[3][searchable]=true&columns[3][orderable]=false&columns[3][search][value]=&columns[3][search][regex]=false&columns[4][data]=box_div()&columns[4][name]=&columns[4][searchable]=true&columns[4][orderable]=false&columns[4][search][value]=&columns[4][search][regex]=false&columns[5][data]=total_box_div()&columns[5][name]=&columns[5][searchable]=true&columns[5][orderable]=false&columns[5][search][value]=&columns[5][search][regex]=false&columns[6][data]=luxurious_div()&columns[6][name]=&columns[6][searchable]=true&columns[6][orderable]=false&columns[6][search][value]=&columns[6][search][regex]=false&columns[7][data]=precious_div()&columns[7][name]=&columns[7][searchable]=true&columns[7][orderable]=false&columns[7][search][value]=&columns[7][search][regex]=false&columns[8][data]=exquisite_div()&columns[8][name]=&columns[8][searchable]=true&columns[8][orderable]=false&columns[8][search][value]=&columns[8][search][regex]=false&columns[9][data]=common_div()&columns[9][name]=&columns[9][searchable]=true&columns[9][orderable]=false&columns[9][search][value]=&columns[9][search][regex]=false&start=0&length=20&search[value]=&search[regex]=false&uid=${uid}&_=${Date.now()}`

    let jsonRes
    try {
      const response = await axios.get(url, { timeout: 15000 })
      jsonRes = this.parseResponse(response.data)
    } catch (error) {
      logger.error('[宝箱排行] 接口请求失败！', error)
      e.reply(`宝箱排行接口请求失败~`)
      return true
    }

    if (jsonRes.data && jsonRes.data.length > 0) {
      jsonRes.data[0].title = unescape(jsonRes.data[0].title.replace(/\\u/g, '%u'))
      const { name, signature } = await this.getPlayerInfo(uid)

      // 保存到群排行数据
      if (e.isGroup) {
        await this.saveChestData(e, uid, signature, jsonRes)
      }

      await this.renderChest(e, uid, name, signature, jsonRes)

      // 设置 CD
      await redis.set(cdKey, 1)
      await redis.expire(cdKey, 60)
    } else {
      e.reply(`UID:${uid} 没有匹配的数据，可能是米游社权限未开放或为国际服UID`)
    }

    return true
  }

  /**
   * 群成就排行榜
   */
  async achieveGroupTop(e) {
    if (!e.isGroup) {
      e.reply('该指令仅限群聊使用')
      return true
    }

    this.ensureDataDir()
    if (!fs.existsSync(achieveTopPath)) {
      e.reply('暂无排行数据，请先使用【#成就排行】写入数据')
      return true
    }

    const data = JSON.parse(fs.readFileSync(achieveTopPath, 'utf-8'))
    if (!data[e.group_id]) {
      e.reply('本群暂无排行数据，请先使用【#成就排行】写入数据')
      return true
    }

    const sortedData = _(data[e.group_id])
      .map((value, key) => ({ qq: key, ...value }))
      .orderBy('achievement_number', 'desc')
      .slice(0, 15)
      .value()

    const rankedData = sortedData.map((value, index) => ({ ...value, rank: index + 1 }))
    let top3 = rankedData.slice(0, 3)

    // 填充空位
    while (top3.length < 3) {
      top3.push({
        achievement_number: 0,
        total_index: '虚位以待',
        title: '虚位以待',
        grade: 0,
        uid: 100000000,
        nickname: '虚位以待',
        qq: 10000,
        rank: 0
      })
    }

    const lable = gsCfg.getdefSet('role', 'index')
    const screenData = {
      achievement: lable?.achievement || 1000,
      version: '1.0.0',
      YunzaiName: 'Yunzai-Bot',
      YunzaiVersion: 'V3',
      CssPath: path.join(pluginRoot, 'resources', 'teyvat', 'ranking') + '/',
      quality: 100,
      Top3: top3,
      rankedData,
      cwd: _path,
      Resources: path.join(pluginRoot, 'resources', 'teyvat', 'ranking') + '/',
      saveId: e.user_id,
      tplFile: path.join(pluginRoot, 'resources', 'teyvat', 'ranking', 'achieve-group.html')
    }

    const img = await puppeteer.screenshot('TeyvatAchieveGroupTop', screenData)
    await e.reply(img)
    return true
  }

  /**
   * 群宝箱排行榜
   */
  async chestGroupTop(e) {
    if (!e.isGroup) {
      e.reply('该指令仅限群聊使用')
      return true
    }

    this.ensureDataDir()
    if (!fs.existsSync(chestTopPath)) {
      e.reply('暂无排行数据，请先使用【#宝箱排行】写入数据')
      return true
    }

    const data = JSON.parse(fs.readFileSync(chestTopPath, 'utf-8'))
    if (!data[e.group_id]) {
      e.reply('本群暂无排行数据，请先使用【#宝箱排行】写入数据')
      return true
    }

    const sortedData = _(data[e.group_id])
      .map((value, key) => ({ qq: key, ...value }))
      .orderBy('grade', 'desc')
      .slice(0, 15)
      .value()

    const rankedData = sortedData.map((value, index) => ({ ...value, rank: index + 1 }))
    let top3 = rankedData.slice(0, 3)

    // 填充空位
    while (top3.length < 3) {
      top3.push({
        box: 0,
        total_index: '虚位以待',
        title: '虚位以待',
        total_box: 0,
        grade: 0,
        luxurious: 0,
        precious: 0,
        exquisite: 0,
        common: 0,
        uid: 100000000,
        nickname: '虚位以待',
        qq: 10000,
        rank: 0
      })
    }

    const screenData = {
      version: '1.0.0',
      YunzaiName: 'Yunzai-Bot',
      YunzaiVersion: 'V3',
      CssPath: path.join(pluginRoot, 'resources', 'teyvat', 'ranking') + '/',
      quality: 100,
      Top3: top3,
      rankedData,
      cwd: _path,
      Resources: path.join(pluginRoot, 'resources', 'teyvat', 'ranking') + '/',
      saveId: e.user_id,
      tplFile: path.join(pluginRoot, 'resources', 'teyvat', 'ranking', 'chest-group.html')
    }

    const img = await puppeteer.screenshot('TeyvatChestGroupTop', screenData)
    await e.reply(img)
    return true
  }

  /**
   * 获取 UID
   */
  async getUid(e) {
    const msg = e.original_msg || e.msg || ''
    const uidMatch = /[0-9]{9}/.exec(msg)
    if (uidMatch) return uidMatch[0]

    const user = e.user
    return user?._regUid || user?.uid || user?.getUid?.('gs')
  }

  /**
   * 获取玩家信息
   */
  async getPlayerInfo(uid) {
    let name = '旅行者'
    let signature = '未设置签名'

    try {
      const res = await axios.get(`https://enka.network/api/uid/${uid}?info`, {
        headers: { 'Content-Type': 'application/json' },
        timeout: 10000
      })

      if (res.status === 200 && res.data?.playerInfo) {
        name = res.data.playerInfo.nickname || name
        signature = res.data.playerInfo.signature || signature
      }
    } catch (error) {
      logger.warn(`[提瓦特] 获取玩家信息失败: ${error.message}`)
    }

    return { name, signature }
  }

  /**
   * 解析 API 响应
   */
  parseResponse(data) {
    let str = JSON.stringify(data)
    str = str.replace(/[\r\n\t\s]/g, '').replace(/\\"/g, '"').replace(/\\n/g, '')
    if (str.startsWith('"') && str.endsWith('"')) {
      str = str.substring(1, str.length - 1)
    }
    return JSON.parse(str)
  }

  /**
   * 确保数据目录存在
   */
  ensureDataDir() {
    if (!fs.existsSync(dataPath)) {
      fs.mkdirSync(dataPath, { recursive: true })
    }
  }

  /**
   * 保存成就数据
   */
  async saveAchieveData(e, uid, signature, jsonRes) {
    this.ensureDataDir()
    if (!fs.existsSync(achieveTopPath)) {
      fs.writeFileSync(achieveTopPath, '{}')
    }

    const json = JSON.parse(fs.readFileSync(achieveTopPath, 'utf-8'))
    if (!json[e.group_id]) json[e.group_id] = {}

    json[e.group_id][e.user_id] = {
      ...jsonRes.data[0],
      uid,
      nickname: signature
    }

    fs.writeFileSync(achieveTopPath, JSON.stringify(json, null, 2))
    e.reply('您可以通过【#成就排行榜】查看群内数据了', true, { recallMsg: 15 })
  }

  /**
   * 保存宝箱数据
   */
  async saveChestData(e, uid, signature, jsonRes) {
    this.ensureDataDir()
    if (!fs.existsSync(chestTopPath)) {
      fs.writeFileSync(chestTopPath, '{}')
    }

    const json = JSON.parse(fs.readFileSync(chestTopPath, 'utf-8'))
    if (!json[e.group_id]) json[e.group_id] = {}

    json[e.group_id][e.user_id] = {
      ...jsonRes.data[0],
      uid,
      nickname: signature
    }

    fs.writeFileSync(chestTopPath, JSON.stringify(json, null, 2))
    e.reply('您可以通过【#宝箱排行榜】查看群内数据了', true, { recallMsg: 15 })
  }

  /**
   * 渲染成就卡片
   */
  async renderAchieve(e, uid, name, signature, jsonRes) {
    const lable = gsCfg.getdefSet('role', 'index')
    const data = jsonRes.data[0]

    const screenData = {
      CssPath: path.join(pluginRoot, 'resources', 'teyvat', 'ranking') + '/',
      AchieveHtml: {
        uid,
        name,
        nickname: signature,
        allAc: data.achievement_number,
        top: data.total_index,
        title: data.title,
        score: data.grade,
        user_img: `https://q1.qlogo.cn/g?b=qq&nk=${e.user_id}&s=160`,
        AcgBg: ''
      },
      achievement: lable?.achievement || 1000,
      quality: 100,
      saveId: e.user_id,
      tplFile: path.join(pluginRoot, 'resources', 'teyvat', 'ranking', 'achieve.html')
    }

    const img = await puppeteer.screenshot('TeyvatAchieveTop', screenData)
    await e.reply(img)
  }

  /**
   * 渲染宝箱卡片
   */
  async renderChest(e, uid, name, signature, jsonRes) {
    const data = jsonRes.data[0]

    const screenData = {
      CssPath: path.join(pluginRoot, 'resources', 'teyvat', 'ranking') + '/',
      ChestHtml: {
        uid,
        name,
        nickname: signature,
        allchest: data.total_box,
        top: data.total_index,
        Achest: data.luxurious,
        Bchest: data.precious,
        Cchest: data.exquisite,
        Dchest: data.common,
        title: data.title,
        score: data.grade,
        user_img: `https://q1.qlogo.cn/g?b=qq&nk=${e.user_id}&s=160`,
        AcgBg: ''
      },
      quality: 100,
      saveId: e.user_id,
      tplFile: path.join(pluginRoot, 'resources', 'teyvat', 'ranking', 'chest.html')
    }

    const img = await puppeteer.screenshot('TeyvatChestTop', screenData)
    await e.reply(img)
  }
}
