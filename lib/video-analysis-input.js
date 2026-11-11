const PLAIN_TEXT_TYPES = new Set(['conversation', 'extendedTextMessage'])

export function isPlainPrivateTextMessage(message) {
  if (!message || message.fromMe || message.isGroup) return false

  const type = String(message.mtype || '')
  if (!PLAIN_TEXT_TYPES.has(type)) return false

  const payload = message.msg
  if (payload && typeof payload === 'object') {
    // WhatsApp list, button, template and native-flow replies are UI events,
    // not user-entered API key text. Never feed their labels/IDs to validation.
    if (
      payload.singleSelectReply ||
      payload.nativeFlowResponseMessage ||
      payload.selectedButtonId ||
      payload.selectedId ||
      payload.hydratedTemplate
    ) return false
  }

  return true
}

export function isPromptTriggerMessage(message, pending) {
  const messageId = String(message?.id || message?.key?.id || '')
  const triggerId = String(pending?.triggerMessageId || '')
  return Boolean(messageId && triggerId && messageId === triggerId)
}
