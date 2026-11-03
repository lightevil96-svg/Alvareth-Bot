import test from 'node:test'
import assert from 'node:assert/strict'
import {
  extractSelectedCommandId,
  unwrapInteractiveMessageContent
} from '../lib/interactive-command.js'

test('extracts WhatsApp list response row ID', () => {
  assert.equal(
    extractSelectedCommandId({
      listResponseMessage: {
        singleSelectReply: { selectedRowId: '.download send Y2xpcC9oYXNpbC5tcDQ' }
      }
    }),
    '.download send Y2xpcC9oYXNpbC5tcDQ'
  )
})

test('extracts native flow IDs from supported JSON field names', () => {
  for (const field of ['id', 'selectedId', 'row_id', 'rowId', 'button_id', 'buttonId', 'selected_row_id']) {
    const value = '.download send token'
    assert.equal(
      extractSelectedCommandId({
        interactiveResponseMessage: {
          nativeFlowResponseMessage: { paramsJson: JSON.stringify({ [field]: value }) }
        }
      }),
      value
    )
  }
})

test('unwraps ephemeral and view-once wrappers before routing list selection', () => {
  const wrapped = {
    ephemeralMessage: {
      message: {
        viewOnceMessageV2: {
          message: {
            message: {
              listResponseMessage: {
                singleSelectReply: { selectedRowId: '.download open Y2xpcA' }
              }
            }
          }
        }
      }
    }
  }
  assert.equal(
    extractSelectedCommandId(wrapped),
    '.download open Y2xpcA'
  )
  assert.ok(unwrapInteractiveMessageContent(wrapped).listResponseMessage)
})

test('returns empty string for non-interactive messages and malformed params', () => {
  assert.equal(extractSelectedCommandId({ conversation: '.download' }), '')
  assert.equal(extractSelectedCommandId({
    interactiveResponseMessage: {
      nativeFlowResponseMessage: { paramsJson: '{broken' }
    }
  }), '')
})
