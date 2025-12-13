/**
 * 提瓦特小助手 - 队伍伤害计算
 * 指令：
 *   #队伍伤害[详情] [UID] 角色1,角色2,角色3,角色4
 *   #单人评级 [UID] 角色名
 */
import plugin from '../../../../lib/plugins/plugin.js'
import puppeteer from '../../../../lib/puppeteer/puppeteer.js'
import _ from 'lodash'
import fs from 'node:fs'
import path from 'node:path'
import { Format } from '../../../miao-plugin/components/index.js'
import { Character, Player } from '../../../miao-plugin/models/index.js'
import teyvatSetting from '../../model/teyvat/teyvat-setting.js'
import { getTeyvatData, getServer } from '../../model/teyvat/teyvat-api.js'
import { attrsKeys } from '../../model/teyvat/teyvat-const.js'

const _path = process.cwd()
const pluginRoot = path.join(_path, 'plugins', 'yunzai-plugin-integration')
const miaoRes = path.join(_path, 'plugins', 'miao-plugin', 'resources')

export class TeyvatTeamDamage extends plugin {
  constructor() {
    super({
      name: '提瓦特小助手-队伍伤害',
      dsc: '队伍伤害计算/单人评级',
      event: 'message',
      priority: 100,
      rule: [
        {
          reg: /^#队伍伤害(详情|过程|全图)?(\d+)?(.*)$/,
          fnc: 'teamDamage'
        },
        {
          reg: /^#单人评级(\d+)?(.*)$/,
          fnc: 'singleRating'
        },
        {
          reg: /^#更新(提瓦特|小助手)配置$/,
          fnc: 'updateConfig'
        }
      ]
    })
  }

  /**
   * 队伍伤害计算
   */
  async teamDamage(e) {
    const match = e.msg.match(/^#队伍伤害(详情|过程|全图)?(\d+)?(.*)$/)
    if (!match) return false

    const detail = !!match[1]
    let uid = match[2]
    let roleListStr = match[3]?.trim()

    // 获取 UID
    if (!uid) {
      uid = await this.getUid(e)
    }

    // 处理 @用户
    if (e.at) {
      const atUid = await this.getAtUid(e)
      if (atUid) {
        uid = atUid
      } else {
        e.reply(`QQ:${e.at} 尚未绑定 UID，请先【#绑定uid】`)
        return true
      }
    }

    if (!uid) {
      e.reply('请先绑定 UID：#绑定 xxx\n或直接指定：#队伍伤害 100000000 钟离,阿贝多')
      return true
    }

    if (!roleListStr) {
      e.reply('请指定队伍角色，例如：\n#队伍伤害 钟离,阿贝多,可莉,魈', true, { recallMsg: 30 })
      return true
    }

    // 解析角色列表
    const splitter = ['\\s', ',', '，', '、', '。', '-', '\\|']
    let roleList = roleListStr.split(new RegExp(splitter.join('|'))).filter(Boolean)

    // 队伍简写支持
    if (roleList.length === 1) {
      const teamConfig = this.getTeamConfig()
      const expanded = teamConfig[roleList[0]]
      if (expanded) {
        roleList = Array.isArray(expanded) ? expanded : expanded.chars || []
        logger.info(`[提瓦特小助手] 展开队伍简写: ${roleList.join(',')}`)
      }
    }

    if (roleList.length === 0) {
      e.reply('请指定要计算的队伍角色', true)
      return true
    }

    if (roleList.length > 4) {
      roleList = roleList.slice(0, 4)
    }

    // 验证角色名称
    const teamChars = []
    let errMsg = ''
    for (const name of roleList) {
      const char = Character.get(name.split('(')[0].trim())
      if (!char) {
        errMsg = `无法识别角色：${name}`
        break
      }
      teamChars.push(char)
    }

    if (errMsg) {
      e.reply(errMsg)
      return true
    }

    // 检查旅行者
    for (const char of teamChars) {
      if (['旅行者', '空', '荧', '萤'].includes(char.name)) {
        e.reply('旅行者暂不支持伤害计算')
        return true
      }
    }

    // 获取角色数据
    const player = Player.create(uid)
    const rolesData = {}
    const weaponsData = {}
    const teyvatBody = { uid, role_data: [] }
    const noDataList = []
    const hasDataList = []

    for (const char of teamChars) {
      const profile = player.getProfile(char.id)
      if (!profile || !profile.hasData) {
        noDataList.push(char.name)
        continue
      }

      hasDataList.push(char.name)

      // 转换数据格式
      const roleData = this.convertProfileData(profile)
      rolesData[char.name] = roleData
      weaponsData[char.name] = roleData.weapon

      const teyvatData = this.convertToTeyvatFormat(profile, uid)
      teyvatBody.role_data.push(teyvatData)
    }

    if (noDataList.length > 0) {
      e.reply(`UID${uid}：缺少 ${noDataList.join('|')} 的面板数据\n请先【#更新面板】获取角色数据`, true)
      return true
    }

    // 设置服务器
    const server = getServer(uid, true)
    if (server) {
      teyvatBody.server = server
    }

    e.reply(`正在计算 UID${uid} 的队伍伤害：${hasDataList.join('|')}`)
    logger.info(`[提瓦特小助手] 队伍伤害请求: UID${uid} - ${hasDataList.join('|')}`)

    // 调用提瓦特 API
    const result = await getTeyvatData(teyvatBody, 'team')
    if (result.code !== 200 || !result.result) {
      logger.error(`[提瓦特小助手] API 返回错误: ${JSON.stringify(result)}`)
      e.reply('提瓦特小助手接口返回错误，请稍后再试')
      return true
    }

    // 处理返回数据
    const data = await this.simpleTeamDamageRes(result.result, rolesData)

    // 补充武器路径
    for (const key in weaponsData) {
      if (data.avatars[key]) {
        data.avatars[key].weapon.imgPath = weaponsData[key].weaponPath
      }
    }

    // 渲染图片
    const screenData = await this.getScreenData(e, data, detail)
    const img = await puppeteer.screenshot('TeyvatTeamDamage', screenData)
    await e.reply(img)

    return true
  }

  /**
   * 单人评级
   */
  async singleRating(e) {
    const match = e.msg.match(/^#单人评级(\d+)?(.*)$/)
    if (!match) return false

    let uid = match[1]
    let roleStr = match[2]?.trim()

    // 获取 UID
    if (!uid) {
      uid = await this.getUid(e)
    }

    if (!uid) {
      e.reply('请先绑定 UID：#绑定 xxx\n或直接指定：#单人评级 100000000 钟离')
      return true
    }

    if (!roleStr) {
      e.reply('请指定要评级的角色，例如：\n#单人评级 钟离', true, { recallMsg: 30 })
      return true
    }

    // 解析角色
    const char = Character.get(roleStr.split('(')[0].trim())
    if (!char) {
      e.reply(`无法识别角色：${roleStr}`)
      return true
    }

    // 检查旅行者
    if (['旅行者', '空', '荧', '萤'].includes(char.name)) {
      e.reply('旅行者暂不支持伤害计算')
      return true
    }

    // 获取角色数据
    const player = Player.create(uid)
    const profile = player.getProfile(char.id)

    if (!profile || !profile.hasData) {
      e.reply(`UID${uid}：缺少 ${char.name} 的面板数据\n请先【#更新面板】获取角色数据`, true)
      return true
    }

    const rolesData = {}
    const weaponsData = {}
    const teyvatBody = { uid, role_data: [] }

    // 转换数据格式
    const roleData = this.convertProfileData(profile)
    rolesData[char.name] = roleData
    weaponsData[char.name] = roleData.weapon

    const teyvatData = this.convertToTeyvatFormat(profile, uid)
    teyvatBody.role_data.push(teyvatData)

    // 设置服务器
    const server = getServer(uid, true)
    if (server) {
      teyvatBody.server = server
    }

    e.reply(`正在计算 UID${uid} ${char.name} 的伤害评级...`)
    logger.info(`[提瓦特小助手] 单人评级请求: UID${uid} - ${char.name}`)

    // 调用提瓦特 API
    const result = await getTeyvatData(teyvatBody, 'team')
    if (result.code !== 200 || !result.result) {
      logger.error(`[提瓦特小助手] API 返回错误: ${JSON.stringify(result)}`)
      e.reply('提瓦特小助手接口返回错误，请稍后再试')
      return true
    }

    // 处理返回数据
    const data = await this.simpleTeamDamageRes(result.result, rolesData)

    // 补充武器路径
    for (const key in weaponsData) {
      if (data.avatars[key]) {
        data.avatars[key].weapon.imgPath = weaponsData[key].weaponPath
      }
    }

    // 渲染图片
    const screenData = await this.getScreenData(e, data, false)
    const img = await puppeteer.screenshot('TeyvatSingleRating', screenData)
    await e.reply(img)

    return true
  }

  /**
   * 更新提瓦特配置数据
   */
  async updateConfig(e) {
    e.reply('正在更新提瓦特小助手配置...')

    try {
      const urls = {
        CHAR_DATA: 'https://cdn.monsterx.cn/bot/gspanel/char-data.json',
        HASH_TRANS: 'https://cdn.monsterx.cn/bot/gspanel/hash-trans.json',
        CALC_RULES: 'https://cdn.monsterx.cn/bot/gspanel/calc-rule.json',
        RELIC_APPEND: 'https://cdn.monsterx.cn/bot/gspanel/relic-append.json'
      }

      const data = teyvatSetting.getTeyvatUrlJson() || {}
      const errors = []

      for (const [key, url] of Object.entries(urls)) {
        try {
          const res = await fetch(url)
          if (res.ok) {
            data[key] = await res.json()
            logger.info(`[提瓦特小助手] 已更新 ${key}`)
          } else {
            errors.push(key)
          }
        } catch (err) {
          errors.push(key)
          logger.error(`[提瓦特小助手] 更新 ${key} 失败: ${err.message}`)
        }
      }

      teyvatSetting.setTeyvatUrlJson(data)

      if (errors.length > 0) {
        e.reply(`配置更新完成，但 ${errors.join(',')} 获取失败`)
      } else {
        e.reply('提瓦特小助手配置更新完成！')
      }
    } catch (error) {
      e.reply(`配置更新失败: ${error.message}`)
    }

    return true
  }

  /**
   * 获取当前用户 UID
   */
  async getUid(e) {
    const user = e.user
    return user?._regUid || user?.uid || user?.getUid?.('gs')
  }

  /**
   * 获取 @用户的 UID
   */
  async getAtUid(e) {
    const at = e.at
    if (!at) return null

    // 尝试从 Redis 获取
    let uid = await redis.get(`genshin:id-uid:${at}`)
    if (!uid) {
      uid = await redis.get(`Yz:genshin:mys:qq-uid:${at}`)
    }
    return uid
  }

  /**
   * 获取队伍简写配置
   */
  getTeamConfig() {
    const config = teyvatSetting.getConfig('teyvat-config')
    return config.teamShortcuts || {}
  }

  /**
   * 转换 Profile 数据为内部格式
   */
  convertProfileData(profile) {
    return {
      id: profile.char.id,
      name: profile.char.name,
      element: attrsKeys[profile.elem],
      fetter: profile.char.fetter,
      cons: profile.cons,
      level: profile.level,
      weapon: {
        name: profile.weapon.name,
        rarity: profile.weapon.star,
        affix: profile.weapon.affix,
        level: profile.weapon.level,
        icon: profile.weapon.img,
        weaponPath: `${profile.weapon.type}/${profile.weapon.name}`
      },
      fightProp: {
        '暴击率': profile.attr.cpct,
        '暴击伤害': profile.attr.cdmg,
        '生命值': profile.attr.hp,
        '攻击力': profile.attr.atk,
        '防御力': profile.attr.def,
        '元素精通': profile.attr.mastery,
        '治疗加成': profile.attr.heal,
        '元素充能效率': profile.attr.recharge
      },
      skills: {
        a: { level: profile.talent.a.level, originLvl: profile.talent.a.original, style: profile.talent.a.level > profile.talent.a.original ? 'extra' : '', icon: `Skill_A_${profile.char.name}` },
        e: { level: profile.talent.e.level, originLvl: profile.talent.e.original, style: profile.talent.e.level > profile.talent.e.original ? 'extra' : '', icon: `Skill_S_${profile.char.name}` },
        q: { level: profile.talent.q.level, originLvl: profile.talent.q.original, style: profile.talent.q.level > profile.talent.q.original ? 'extra' : '', icon: `Skill_E_${profile.char.name}` }
      },
      relicSet: profile.getArtisMark()?.sets || {}
    }
  }

  /**
   * 转换为提瓦特 API 格式
   */
  convertToTeyvatFormat(profile, uid) {
    const a = profile.attr
    const base = profile.base

    const attr = {}
    _.each(['hp', 'def', 'atk', 'mastery'], (key) => {
      const fn = (n) => Format.comma(n, key === 'hp' ? 0 : 1)
      attr[key] = fn(a[key])
      attr[`${key}Base`] = fn(base[key])
    })
    _.each(['cpct', 'cdmg', 'recharge', 'dmg'], (key) => {
      let key2 = key
      if (key === 'dmg' && a.phy > a.dmg) key2 = 'phy'
      attr[key] = Format.pct(a[key2])
    })

    const artisDetail = profile.getArtisMark()
    let artifacts = ''
    for (const key in artisDetail.sets) {
      artifacts = artifacts ? `${artifacts}+${key}${artisDetail.sets[key]}` : `${key}${artisDetail.sets[key]}`
    }

    const artifactsDetail = []
    const posNames = ['生之花', '死之羽', '时之沙', '空之杯', '理之冠']
    let idx = 0
    for (const key in profile.artis.artis) {
      const artis = profile.artis.artis[key]
      const detail = {
        artifacts_name: artis.name,
        artifacts_type: posNames[idx] || '',
        level: artis.level,
        maintips: attrsKeys[artis.main.key],
        mainvalue: artisDetail.artis[key]?.main?.value?.replace(/,/g, '') || ''
      }

      let tipIdx = 0
      for (const attrKey in artis.attrs) {
        tipIdx++
        const attrName = attrsKeys[artis.attrs[attrKey].key]
        const attrValue = artisDetail.artis[key].attrs[attrKey]?.value?.replace(/,/g, '') || ''
        detail[`tips${tipIdx}`] = `${attrName}+${attrValue}`
      }

      artifactsDetail.push(detail)
      idx++
    }

    return {
      uid,
      role: profile.char.name,
      role_class: profile.cons,
      level: profile.level,
      weapon: profile.weapon.name,
      weapon_level: profile.weapon.level,
      weapon_class: `精炼${profile.weapon.affix}阶`,
      hp: Format.int(attr.hp?.replace(/,/g, '') || ''),
      base_hp: Format.int(attr.hpBase?.replace(/,/g, '') || ''),
      attack: Format.int(attr.atk?.replace(/,/g, '') || ''),
      base_attack: Format.int(attr.atkBase?.replace(/,/g, '') || ''),
      defend: Format.int(attr.def?.replace(/,/g, '') || ''),
      base_defend: Format.int(attr.defBase?.replace(/,/g, '') || ''),
      element: Format.int(attr.mastery?.replace(/,/g, '') || ''),
      crit: attr.cpct,
      crit_dmg: attr.cdmg,
      heal: Format.pct(a.heal),
      recharge: attr.recharge,
      fire_dmg: profile.elem === 'pyro' ? Format.pct(a.dmg) : Format.pct(0),
      water_dmg: profile.elem === 'hydro' ? Format.pct(a.dmg) : Format.pct(0),
      ice_dmg: profile.elem === 'cryo' ? Format.pct(a.dmg) : Format.pct(0),
      thunder_dmg: profile.elem === 'electro' ? Format.pct(a.dmg) : Format.pct(0),
      wind_dmg: profile.elem === 'anemo' ? Format.pct(a.dmg) : Format.pct(0),
      rock_dmg: profile.elem === 'geo' ? Format.pct(a.dmg) : Format.pct(0),
      grass_dmg: profile.elem === 'dendro' ? Format.pct(a.dmg) : Format.pct(0),
      physical_dmg: Format.pct(a.phy),
      ability1: profile.talent.a.level,
      ability2: profile.talent.e.level,
      ability3: profile.talent.q.level,
      artifacts,
      artifacts_detail: artifactsDetail
    }
  }

  /**
   * 处理队伍伤害返回数据
   */
  async simpleTeamDamageRes(raw, rolesData) {
    const [tm, total] = raw.zdl_tips0.replace(/你的队伍|，DPS为:/g, '').split('秒内造成总伤害')

    let pieData = []
    const pieColor = []
    _.each(raw.chart_data, v => {
      const nameSplit = v.name.split('\n')
      pieData.push({
        char: nameSplit[0],
        damage: parseFloat(nameSplit[1].replace('W', ''))
      })
      pieColor.push(v.label.color)
    })
    pieData = _.sortBy(pieData, 'damage').reverse()

    const elem = _.map(_.filter(pieData, i => rolesData[i.char]), v => rolesData[v.char].element)[0]

    const avatars = {}
    _.each(raw.role_list, role => {
      const panelData = rolesData[role.role]
      if (!panelData) return

      const relicSet = _.pickBy(panelData.relicSet, i => i >= 2)

      const skills = []
      _.each(panelData.skills, skill => {
        skills.push({
          icon: this.getTalentPath(role.role, skill.icon),
          style: skill.style,
          level: skill.level
        })
      })

      avatars[role.role] = {
        rarity: role.role_star,
        icon: panelData.icon,
        name: role.role,
        face: this.getFace(role.role),
        elem: panelData.element,
        cons: role.role_class,
        level: role.role_level.replace('Lv', ''),
        weapon: {
          icon: panelData.weapon.icon,
          level: panelData.weapon.level,
          rarity: panelData.weapon.rarity,
          affix: panelData.weapon.affix,
          imgPath: ''
        },
        relicSet,
        cp: _.round(panelData.fightProp['暴击率'], 1),
        cd: _.round(panelData.fightProp['暴击伤害'], 1),
        key_prop: role.key_ability,
        key_value: role.key_value,
        skills
      }
    })

    // 充能信息
    _.each(raw.recharge_info, rechargeData => {
      const [name, tmp] = rechargeData.recharge.split('共获取同色球')
      let [same, diff] = tmp.split('个，异色球')
      if (diff.includes('个，无色球')) {
        diff = diff.split('个，无色球')[0]
      }
      if (avatars[name]) {
        avatars[name].recharge = {
          pct: rechargeData.rate,
          same: _.round(parseFloat(same), 1),
          diff: _.round(parseFloat(diff.replace('个', '')), 1)
        }
      }
    })

    // 伤害流程
    const damages = []
    for (const step of raw.advice) {
      if (!step.content) continue
      const [t, s] = step.content.split(' ')
      const a = s.split('，')[0]
      let d = []
      if (s.split('，').length === 1) {
        d = ['-', '-', '-']
      } else {
        const dmgs = s.split('，')[1]
        if (dmgs.split(',').length === 1) {
          d = ['-', '-', _.last(dmgs.split(',')[0].split('：'))]
        } else {
          d = dmgs.split(',').map(dd => _.last(dd.split(':')))
        }
      }
      damages.push([t.replace('s', ''), _.toUpper(a), ...d])
    }

    // Buff 信息
    const buffs = []
    for (const buff of raw.buff) {
      if (!buff.content) continue
      const [t, tmp] = buff.content.split(' ')
      const b = tmp.split('-')[0]
      const bd = _.tail(tmp.split('-')).join('-')
      buffs.push([t.replace('s', ''), _.toUpper(b), _.toUpper(bd)])
    }

    return {
      uid: raw.uid,
      elem,
      rank: raw.zdl_tips2,
      dps: raw.zdl_result,
      tm,
      total,
      pie_data: JSON.stringify(pieData),
      pie_color: JSON.stringify(pieColor),
      pie_data2: pieData,
      pie_color2: pieColor,
      avatars,
      actions: raw.combo_intro.split(','),
      damages,
      buffs
    }
  }

  /**
   * 获取技能图标路径
   */
  getTalentPath(role, icon) {
    const dataFile = path.join(miaoRes, 'meta-gs', 'character', role, 'data.json')
    let roleData = {}
    if (fs.existsSync(dataFile)) {
      roleData = JSON.parse(fs.readFileSync(dataFile, 'utf8'))
    }

    const weapon = roleData.weapon
    const talentCons = roleData.talentCons || {}
    const type = icon.split('_')[1]
    const talentPath = `meta-gs/character/${role}/icons`

    switch (type) {
      case 'A':
        return `common/item/atk-${weapon}.webp`
      case 'S':
        if (!talentCons.e) return `${talentPath}/talent-e.webp`
        return `${talentPath}/${talentCons.e === 3 ? 'cons-3' : 'cons-5'}.webp`
      case 'E':
        if (!talentCons.q) return `${talentPath}/talent-q.webp`
        return `${talentPath}/${talentCons.q === 5 ? 'cons-5' : 'cons-3'}.webp`
    }
    return ''
  }

  /**
   * 获取角色头像
   */
  getFace(role) {
    const miaoPath = path.join(miaoRes, 'meta-gs', 'character', role, 'imgs')
    const faceQ = path.join(miaoPath, 'face-q.webp')
    const face = path.join(miaoPath, 'face.webp')
    return fs.existsSync(faceQ) ? faceQ : face
  }

  /**
   * 获取渲染数据
   */
  async getScreenData(e, data, detail) {
    const pieData = JSON.parse(data.pie_data)
    const damageMap = pieData.map(item => item.damage)
    const total = damageMap.reduce((prev, cur) => prev + cur, 0)
    const percent = damageMap.map(item => (item / total).toFixed(2))
    const pieColor = JSON.parse(data.pie_color)
    const nameChar = pieData.map(item => item.char)

    return {
      version: '1.0.0',
      YunzaiName: 'Yunzai-Bot',
      YunzaiVersion: 'V3',
      result: pieData.reduce((acc, d, i) => {
        acc[d.char] = { name: d.char, damage: d.damage, color: pieColor[i] }
        return acc
      }, {}),
      RoleData: pieData,
      quality: 100,
      AcgBg: '',
      Bing: { percent, RoleColor: pieColor, NameChar: nameChar },
      detail,
      data,
      cwd: _path,
      saveId: e.user_id,
      miaoRes: path.join(miaoRes),
      tplFile: path.join(pluginRoot, 'resources', 'teyvat', 'html.html'),
      pluResPath: path.join(pluginRoot, 'resources', 'teyvat')
    }
  }
}
