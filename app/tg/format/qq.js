export async function sendForward(e, target, nodeList) {
  if (!nodeList?.length) return { sent: 0 }

  const forwardNodes = nodeList.map((content) => ({
    nickname: 'Telegram',
    user_id: e.user_id || (globalThis.Bot ? globalThis.Bot.uin : 100000),
    message: content,
    time: Math.floor(Date.now() / 1000)
  }))

  // 首选合并转发；失败则降级为逐条发送（私聊常见限制）
  try {
    const forwardMsg = await globalThis.Bot.makeForwardMsg(forwardNodes)
    await sendToTarget(e, target, forwardMsg)
    return { sent: nodeList.length }
  } catch (err) {
    // 降级：逐条发送，避免合并转发在私聊失败
    const errors = []
    let sent = 0
    for (const content of nodeList) {
      try {
        await sendToTarget(e, target, content)
        sent++
        await sleep(350)
      } catch (e2) {
        errors.push(e2?.message || String(e2))
      }
    }
    if (sent > 0) return { sent, skipped: nodeList.length - sent, errors }
    throw new Error('合并转发与逐条发送均失败: ' + (errors[0] || 'unknown'))
  }
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

function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }
