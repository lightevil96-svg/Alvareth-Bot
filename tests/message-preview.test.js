import test from 'node:test'
import assert from 'node:assert/strict'
import { sanitizeBotRepositoryPreview } from '../lib/message-preview.js'

const repositoryUrl = 'https://github.com/lightevil96-svg/Alvareth-Bot'

test('removes the repository URL from ordinary text and captions', () => {
  const original = {
    text: repositoryUrl + '  ✅ Pemeriksaan update selesai.',
    caption: 'Hasil render: ' + repositoryUrl
  }
  const cleaned = sanitizeBotRepositoryPreview(original)
  assert.equal(cleaned.text, '✅ Pemeriksaan update selesai.')
  assert.equal(cleaned.caption, 'Hasil render: ')
  assert.equal(original.text.startsWith(repositoryUrl), true)
})

test('removes only external ad previews that point to the bot repository', () => {
  const message = {
    text: 'Video diterima.',
    contextInfo: {
      externalAdReply: {
        sourceUrl: repositoryUrl,
        title: 'Alvareth Bot',
        thumbnailUrl: 'https://raw.githubusercontent.com/lightevil96-svg/Alvareth-Bot/main/media/alvareth-character.png'
      }
    }
  }
  const cleaned = sanitizeBotRepositoryPreview(message)
  assert.equal(cleaned.contextInfo.externalAdReply, undefined)
  assert.equal(message.contextInfo.externalAdReply.sourceUrl, repositoryUrl)
})

test('preserves unrelated link previews', () => {
  const message = {
    text: 'Lihat dokumentasi.',
    contextInfo: {
      externalAdReply: {
        sourceUrl: 'https://example.com/docs',
        title: 'Documentation'
      }
    }
  }
  const cleaned = sanitizeBotRepositoryPreview(message)
  assert.equal(cleaned.contextInfo.externalAdReply.sourceUrl, 'https://example.com/docs')
})
