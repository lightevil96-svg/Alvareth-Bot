import test from 'node:test'
import assert from 'node:assert/strict'
import {
  isPlainPrivateTextMessage,
  isPromptTriggerMessage
} from '../lib/video-analysis-input.js'

test('accepts only newly entered private text as API key input', () => {
  assert.equal(isPlainPrivateTextMessage({
    mtype: 'conversation',
    msg: 'AIzaSy' + 'A'.repeat(33),
    isGroup: false,
    fromMe: false
  }), true)

  assert.equal(isPlainPrivateTextMessage({
    mtype: 'extendedTextMessage',
    msg: { text: 'AIzaSy' + 'B'.repeat(33) },
    isGroup: false,
    fromMe: false
  }), true)

  for (const mtype of [
    'listResponseMessage',
    'buttonsResponseMessage',
    'templateButtonReplyMessage',
    'interactiveResponseMessage'
  ]) {
    assert.equal(isPlainPrivateTextMessage({
      mtype,
      msg: { selectedDisplayText: 'API Key Gemini' },
      isGroup: false,
      fromMe: false
    }), false, 'must ignore ' + mtype)
  }

  assert.equal(isPlainPrivateTextMessage({
    mtype: 'conversation',
    msg: 'not a private owner input',
    isGroup: true,
    fromMe: false
  }), false)

  assert.equal(isPlainPrivateTextMessage({
    mtype: 'conversation',
    msg: 'bot message',
    isGroup: false,
    fromMe: true
  }), false)
})

test('does not re-process the message that opened the API key prompt', () => {
  const pending = { triggerMessageId: 'menu-click-123' }
  assert.equal(isPromptTriggerMessage({ id: 'menu-click-123' }, pending), true)
  assert.equal(isPromptTriggerMessage({ key: { id: 'menu-click-123' } }, pending), true)
  assert.equal(isPromptTriggerMessage({ id: 'api-key-message-456' }, pending), false)
  assert.equal(isPromptTriggerMessage({ id: 'menu-click-123' }, {}), false)
})
