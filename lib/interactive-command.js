const MESSAGE_WRAPPERS = [
  'ephemeralMessage',
  'viewOnceMessage',
  'viewOnceMessageV2',
  'viewOnceMessageV2Extension',
  'documentWithCaptionMessage',
  'deviceSentMessage',
  'editedMessage'
]

export function unwrapInteractiveMessageContent(input) {
  let current = input
  for (let depth = 0; depth < 8; depth++) {
    if (!current || typeof current !== 'object') return {}
    let next = null
    for (const wrapper of MESSAGE_WRAPPERS) {
      const candidate = current[wrapper]?.message
      if (candidate && typeof candidate === 'object') {
        next = candidate.message && typeof candidate.message === 'object'
          ? candidate.message
          : candidate
        break
      }
    }
    if (!next) return current
    current = next
  }
  return current && typeof current === 'object' ? current : {}
}

function parseNativeFlowId(paramsJson) {
  if (typeof paramsJson !== 'string' || !paramsJson.trim()) return ''
  try {
    const params = JSON.parse(paramsJson)
    const id = params.id || params.selectedId || params.row_id ||
      params.rowId || params.button_id || params.buttonId ||
      params.selected_row_id
    return typeof id === 'string' ? id.trim() : ''
  } catch {
    return ''
  }
}

/**
 * Extract a command ID from WhatsApp list/button/native-flow replies.
 * Wrapper messages are unwrapped first so a selection still routes when
 * WhatsApp wraps the interactive response in an ephemeral message.
 */
export function extractSelectedCommandId(input) {
  const content = unwrapInteractiveMessageContent(input)
  const selected = content.templateButtonReplyMessage?.selectedId ||
    content.buttonsResponseMessage?.selectedButtonId ||
    content.listResponseMessage?.singleSelectReply?.selectedRowId ||
    parseNativeFlowId(content.interactiveResponseMessage?.nativeFlowResponseMessage?.paramsJson)
  return typeof selected === 'string' ? selected.trim() : ''
}
