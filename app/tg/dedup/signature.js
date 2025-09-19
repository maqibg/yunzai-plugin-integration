import crypto from 'node:crypto'

export function getChatKey(ch){
  if (ch?.id !== undefined) return String(ch.id)
  if (ch?.username) return String(ch.username).replace(/^@/,'')
  if (ch?.alias) return String(ch.alias)
  return 'unknown'
}

export function mergeSignatures(existing, messages){
  const merged = Array.isArray(existing) ? existing.slice(-500) : []
  for (const m of messages){
    const sig = m?.signature || m?.sig || m
    if (!sig) continue
    merged.push({ sig, ts: Math.floor(Date.now()/1000) })
    if (merged.length > 500) merged.splice(0, merged.length-500)
  }
  return merged
}

export function computeSignature(chatKey, message){
  const h = crypto.createHash('sha1')
  h.update(chatKey || '')
  h.update(String(message?.message_id||''))
  if (message?.media_group_id) h.update(String(message.media_group_id))
  if (message?.text) h.update(message.text)
  if (message?.caption) h.update(message.caption)
  for (const att of (message?.attachments||[])){
    if (att.file_unique_id) h.update(att.file_unique_id)
  }
  return h.digest('hex')
}
