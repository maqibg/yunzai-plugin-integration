export async function sendForward(e, target, nodeList) {
  if (!nodeList?.length) return { sent: 0 }
  const forwardNodes = nodeList.map((content) => ({
    nickname: '\u7624\u840E',
    user_id: '80000000',
    message: content,
    time: Math.floor(Date.now() / 1000)
  }))
  const forwardMsg = await globalThis.Bot.makeForwardMsg(forwardNodes)
  await sendToTarget(e, target, forwardMsg)
  return { sent: nodeList.length }
}

async function sendToTarget(e, target, msg) {
  if (target && target.type === 'group' && target.id) {
    const g = globalThis.Bot.pickGroup(target.id)
    if (!g) throw new Error(`QQ 群 ${target.id} 未找到`)
    await g.sendMsg(msg)
    return
  }
  if (target && target.type === 'user' && target.id) {
    const u = globalThis.Bot.pickUser(target.id)
    if (!u) throw new Error(`QQ 好友 ${target.id} 未找到`)
    await u.sendMsg(msg)
    return
  }
  await e.reply(msg)
}