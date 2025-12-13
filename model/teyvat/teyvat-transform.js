/**
 * 提瓦特小助手数据转换工具
 */
import _ from 'lodash'
import { ELEM, POS, PROP, SKILL, RANK_MAP, GROW_VALUE, SINGLE_VALUE } from './teyvat-const.js'

/**
 * 转换词条数值为字符串形式
 */
export function vStr(prop, value) {
  if (['生命值', '攻击力', '防御力', '元素精通'].includes(prop)) {
    return String(value)
  } else {
    return String(Math.round(value * 10) / 10) + '%'
  }
}

/**
 * 转换词条名称为简短形式
 */
export function kStr(prop, reverse = false) {
  if (reverse) {
    return prop.replace('充能', '元素充能').replace('伤加成', '元素伤害加成').replace('物理元素', '物理')
  }
  return prop
    .replace('百分比', '')
    .replace('元素充能', '充能')
    .replace('元素伤害', '伤')
    .replace('物理伤害', '物伤')
}

/**
 * 获取圣遗物评级
 */
export function getRelicRank(mark) {
  for (const [rank, threshold] of RANK_MAP) {
    if (mark < threshold) return rank
  }
  return 'ACE²'
}

/**
 * 获取圣遗物配置
 */
export async function getRelicConfig(Json, charName, baseProp) {
  const CALC_RULES = Json.CALC_RULES || {}
  const RELIC_APPEND = Json.RELIC_APPEND || {}

  // 默认权重
  let affixWeight = {
    '暴击率': 100,
    '暴击伤害': 100,
    '攻击力百分比': 75,
    '元素精通': 75,
    '元素充能效率': 55,
    '生命值百分比': 0,
    '防御力百分比': 0,
    '攻击力': 0,
    '生命值': 0,
    '防御力': 0
  }

  // 角色特殊权重
  if (CALC_RULES[charName]) {
    affixWeight = { ...affixWeight, ...CALC_RULES[charName] }
  }

  // 计算分数基准
  let pointMark = {}
  let maxMark = 0

  for (const [key, weight] of Object.entries(affixWeight)) {
    if (GROW_VALUE[key]) {
      pointMark[key] = weight / GROW_VALUE[key]
      maxMark = Math.max(maxMark, pointMark[key])
    }
  }

  return [affixWeight, pointMark, maxMark]
}

/**
 * 计算圣遗物评分
 */
export async function calcRelicMark(Json, relicData, elem, affixWeight, pointMark, maxMark) {
  let total = 0
  let mainMark = 0
  let subMark = 0

  // 主词条评分（仅时之沙、空之杯、理之冠）
  if (relicData.pos >= 3) {
    const mainProp = relicData.main.prop
    if (affixWeight[mainProp]) {
      mainMark = affixWeight[mainProp] / 100 * 2
    }
    // 元素杯特殊处理
    if (relicData.pos === 4 && mainProp.includes('元素伤害')) {
      mainMark = 2
    }
  }

  // 副词条评分
  for (const sub of relicData.sub) {
    const prop = sub.prop
    const value = sub.value
    if (pointMark[prop]) {
      const singleVal = SINGLE_VALUE[prop] || 1
      subMark += (value / singleVal) * pointMark[prop] / maxMark * 6.6
    }
  }

  total = mainMark + subMark

  return {
    total,
    mainMark: Math.round(mainMark * 10) / 10,
    subMark: Math.round(subMark * 10) / 10
  }
}

/**
 * 转换 Enka 数据为内部格式
 */
export async function transFromEnka(Json, avatarInfo, ts = 0) {
  const HASH_TRANS = Json.HASH_TRANS || {}
  const CHAR_DATA = Json.CHAR_DATA || {}
  const charData = CHAR_DATA[String(avatarInfo.avatarId)]

  if (!charData) {
    return { error: `未找到角色数据: ${avatarInfo.avatarId}` }
  }

  const res = {
    id: avatarInfo.avatarId,
    rarity: charData.QualityType?.includes('QUALITY_ORANGE') ? 5 : 4,
    name: charData.NameCN,
    slogan: charData.Slogan,
    element: ELEM[charData.Element],
    cons: avatarInfo.talentIdList?.length || 0,
    fetter: avatarInfo.fetterInfo?.expLevel || 0,
    level: parseInt(avatarInfo.propMap['4001']?.val || 1),
    icon: avatarInfo.costumeId
      ? charData.Costumes?.[avatarInfo.costumeId.toString()]?.icon
      : charData.iconName,
    baseProp: {
      生命值: avatarInfo.fightPropMap['1'],
      攻击力: avatarInfo.fightPropMap['4'],
      防御力: avatarInfo.fightPropMap['7']
    },
    fightProp: {
      生命值: avatarInfo.fightPropMap['2000'],
      攻击力: avatarInfo.fightPropMap['4'] * (1 + (avatarInfo.fightPropMap['6'] || 0)) + (avatarInfo.fightPropMap['5'] || 0),
      防御力: avatarInfo.fightPropMap['2002'],
      暴击率: avatarInfo.fightPropMap['20'] * 100,
      暴击伤害: avatarInfo.fightPropMap['22'] * 100,
      治疗加成: avatarInfo.fightPropMap['26'] * 100,
      元素精通: avatarInfo.fightPropMap['28'],
      元素充能效率: avatarInfo.fightPropMap['23'] * 100,
      物理伤害加成: avatarInfo.fightPropMap['30'] * 100,
      火元素伤害加成: avatarInfo.fightPropMap['40'] * 100,
      水元素伤害加成: avatarInfo.fightPropMap['42'] * 100,
      风元素伤害加成: avatarInfo.fightPropMap['44'] * 100,
      雷元素伤害加成: avatarInfo.fightPropMap['41'] * 100,
      草元素伤害加成: avatarInfo.fightPropMap['43'] * 100,
      冰元素伤害加成: avatarInfo.fightPropMap['46'] * 100,
      岩元素伤害加成: avatarInfo.fightPropMap['45'] * 100
    },
    skills: {},
    consts: [],
    weapon: {},
    relics: [],
    relicSet: {},
    relicCalc: {},
    damage: {},
    time: ts || parseInt(Date.now() / 1000)
  }

  // 技能数据
  const skills = { a: {}, e: {}, q: {} }
  const extraLevels = Object.fromEntries(
    Object.entries(avatarInfo.proudSkillExtraLevelMap || {}).map(([k, v]) => [k.slice(-1), v])
  )

  for (let idx = 0; idx < (charData.SkillOrder?.length || 0); idx++) {
    const skillId = charData.SkillOrder[idx]
    const level = avatarInfo.skillLevelMap?.[String(skillId)] || 1
    const currentLvl = level + (extraLevels[Object.keys(SKILL)[idx]] || 0)
    skills[Object.values(SKILL)[idx]] = {
      style: currentLvl > level ? 'extra' : '',
      icon: charData.Skills?.[String(skillId)] || '',
      level: currentLvl,
      originLvl: level
    }
  }
  res.skills = skills

  // 命座数据
  const consts = []
  for (let cIdx = 0; cIdx < (charData.Consts?.length || 0); cIdx++) {
    consts.push({
      style: cIdx + 1 > res.cons ? 'off' : '',
      icon: charData.Consts[cIdx]
    })
  }
  res.consts = consts

  // 装备数据
  const [affixWeight, pointMark, maxMark] = await getRelicConfig(Json, charData.NameCN, res.baseProp)
  let [relicsMark, relicsCnt, relicSet] = [0.0, 0, {}]

  for (const equip of avatarInfo.equipList || []) {
    if (equip.flat.itemType === 'ITEM_WEAPON') {
      const weaponSub = equip.flat.weaponStats[equip.flat.weaponStats.length - 1]?.appendPropId
      const weaponSubValue = equip.flat.weaponStats[equip.flat.weaponStats.length - 1]?.statValue
      res.weapon = {
        id: equip.itemId,
        rarity: equip.flat.rankLevel,
        name: HASH_TRANS[equip.flat.nameTextMapHash] || '未知武器',
        affix: Object.values(equip.weapon?.affixMap || { _: 0 })[0] + 1,
        level: equip.weapon?.level || 1,
        icon: equip.flat.icon,
        main: equip.flat.weaponStats[0]?.statValue || 0,
        sub: weaponSub && weaponSub !== 'FIGHT_PROP_BASE_ATTACK'
          ? {
              prop: PROP[weaponSub]?.replace('百分比', '') || '',
              value: `${weaponSubValue}${weaponSub.endsWith('ELEMENT_MASTERY') ? '' : '%'}`
            }
          : {}
      }
    } else if (equip.flat.itemType === 'ITEM_RELIQUARY') {
      const mainProp = equip.flat.reliquaryMainstat
      const subProps = equip.flat.reliquarySubstats || []
      const posIdx = Object.keys(POS).indexOf(equip.flat.equipType) + 1

      const relicData = {
        pos: posIdx,
        rarity: equip.flat.rankLevel,
        name: HASH_TRANS[equip.flat.nameTextMapHash] || '未知圣遗物',
        setName: HASH_TRANS[equip.flat.setNameTextMapHash] || '未知套装',
        level: (equip.reliquary?.level || 1) - 1,
        main: {
          prop: PROP[mainProp?.mainPropId] || '',
          value: mainProp?.statValue || 0
        },
        sub: subProps.map(s => ({
          prop: PROP[s.appendPropId] || '',
          value: s.statValue
        })),
        calc: {},
        icon: equip.flat.icon
      }

      relicData.calc = await calcRelicMark(Json, relicData, res.element, affixWeight, pointMark, maxMark)

      // 格式化显示
      relicData.main.value = vStr(relicData.main.prop, relicData.main.value)
      relicData.main.prop = kStr(relicData.main.prop)
      relicData.sub = relicData.sub.map(s => ({
        prop: kStr(s.prop),
        value: vStr(s.prop, s.value)
      }))

      relicData.calc.total = Math.round(relicData.calc.total * 10) / 10
      relicSet[relicData.setName] = (relicSet[relicData.setName] || 0) + 1
      res.relics.push(relicData)

      relicsMark += relicData.calc.total
      relicsCnt += 1
    }
  }

  res.relicSet = relicSet
  res.relicCalc = {
    rank: relicsCnt ? getRelicRank(relicsMark / relicsCnt) : 'NaN',
    total: Math.round(relicsMark * 10) / 10
  }

  return res
}

/**
 * 转换内部格式为提瓦特 API 请求格式
 */
export async function transToTeyvatRequest(avatarsData, uid) {
  const { getServer } = await import('./teyvat-api.js')

  const res = { uid, role_data: [] }
  if (!['1', '2'].includes(uid[0])) {
    res.server = getServer(uid, true)
  }

  for (const avatarData of avatarsData) {
    const name = avatarData.name
    const cons = avatarData.cons
    const weapon = avatarData.weapon
    const baseProp = avatarData.baseProp
    let fightProp = { ...avatarData.fightProp }
    const skills = avatarData.skills
    const relics = avatarData.relics
    const relicSet = avatarData.relicSet

    // 特殊角色属性处理
    if (name === '雷电将军') {
      const _thunderDmg = fightProp['雷元素伤害加成']
      const _recharge = fightProp['元素充能效率']
      fightProp['雷元素伤害加成'] = Math.max(0, _thunderDmg - (_recharge - 100) * 0.4)
    }
    if (name === '莫娜') {
      const _waterDmg = fightProp['水元素伤害加成']
      const _recharge = fightProp['元素充能效率']
      fightProp['水元素伤害加成'] = Math.max(0, _waterDmg - _recharge * 0.2)
    }
    if (name === '妮露' && cons === 6) {
      const _count = parseFloat(fightProp['生命值'] / 1000)
      fightProp['暴击率'] = Math.max(5, fightProp['暴击率'] - Math.min(30, _count * 0.6))
      fightProp['暴击伤害'] = Math.max(50, fightProp['暴击伤害'] - Math.min(60, _count * 1.2))
    }

    // 特定武器元素伤害扣除
    if (['息灾', '波乱月白经津', '雾切之回光', '猎人之径'].includes(weapon.name)) {
      const weaponAffix = weapon.affix
      for (const elem of ['火', '水', '雷', '风', '冰', '岩', '草']) {
        const key = `${elem}元素伤害加成`
        fightProp[key] = Math.max(0, fightProp[key] - 12 - 12 * (weaponAffix - 1) / 4)
      }
    }

    // 圣遗物数据
    const artifacts = []
    const posNames = ['生之花', '死之羽', '时之沙', '空之杯', '理之冠']
    for (const a of relics) {
      const tData = {
        artifacts_name: a.name,
        artifacts_type: posNames[a.pos - 1] || '',
        level: a.level,
        maintips: kStr(a.main.prop, true),
        mainvalue: typeof a.main.value === 'number' ? parseInt(a.main.value) : a.main.value
      }

      for (let sIdx = 0; sIdx < 4; sIdx++) {
        if (sIdx < a.sub.length) {
          tData[`tips${sIdx + 1}`] = kStr(a.sub[sIdx].prop, true) + '+' + a.sub[sIdx].value
        } else {
          tData[`tips${sIdx + 1}`] = ''
        }
      }
      artifacts.push(tData)
    }

    res.role_data.push({
      uid,
      role: name,
      role_class: cons,
      level: parseInt(avatarData.level),
      weapon: weapon.name,
      weapon_level: weapon.level,
      weapon_class: `精炼${weapon.affix}阶`,
      hp: parseInt(fightProp['生命值']),
      base_hp: parseInt(baseProp['生命值']),
      attack: parseInt(fightProp['攻击力']),
      base_attack: parseInt(baseProp['攻击力']),
      defend: parseInt(fightProp['防御力']),
      base_defend: parseInt(baseProp['防御力']),
      element: Math.round(fightProp['元素精通']),
      crit: `${_.round(fightProp['暴击率'], 1)}%`,
      crit_dmg: `${_.round(fightProp['暴击伤害'], 1)}%`,
      heal: `${_.round(fightProp['治疗加成'], 1)}%`,
      recharge: `${_.round(fightProp['元素充能效率'], 1)}%`,
      fire_dmg: `${_.round(fightProp['火元素伤害加成'], 1)}%`,
      water_dmg: `${_.round(fightProp['水元素伤害加成'], 1)}%`,
      thunder_dmg: `${_.round(fightProp['雷元素伤害加成'], 1)}%`,
      wind_dmg: `${_.round(fightProp['风元素伤害加成'], 1)}%`,
      ice_dmg: `${_.round(fightProp['冰元素伤害加成'], 1)}%`,
      rock_dmg: `${_.round(fightProp['岩元素伤害加成'], 1)}%`,
      grass_dmg: `${_.round(fightProp['草元素伤害加成'], 1)}%`,
      physical_dmg: `${_.round(fightProp['物理伤害加成'], 1)}%`,
      artifacts: _.map(_.pickBy(relicSet, (v, k) => v >= 2 || k.includes('之人')), (v1, k1) => `${k1}${v1 >= 4 ? 4 : v1 >= 2 ? 2 : 1}`).join('+'),
      ability1: skills.a?.level || 1,
      ability2: skills.e?.level || 1,
      ability3: skills.q?.level || 1,
      artifacts_detail: artifacts
    })
  }

  return res
}

export default {
  vStr,
  kStr,
  getRelicRank,
  getRelicConfig,
  calcRelicMark,
  transFromEnka,
  transToTeyvatRequest
}
