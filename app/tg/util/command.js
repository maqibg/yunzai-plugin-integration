export function parseCommand(e, cfg){
  const msg = (e.msg || '').trim()
  const parts = msg.split(/\s+/)
  const defLimit = Number(cfg?.batch?.size) || 20
  const channels = Array.isArray(cfg.channels) ? cfg.channels : []
  if (parts.length === 1) return { channels, limit: defLimit }
  const key = String(parts[1]).replace(/^@/, '')
  const limit = parts[2] ? Math.max(1, Math.min(200, Number(parts[2]) || defLimit)) : defLimit
  const matched = channels.filter(it => {
    const id = it.id !== undefined ? String(it.id) : null
    const user = it.username ? String(it.username).replace(/^@/, '') : null
    const alias = it.alias ? String(it.alias) : null
    return key === id || key === user || key === alias
  })
  return { channels: matched, limit }
}
