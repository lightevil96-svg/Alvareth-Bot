import path from 'node:path'
import fs from 'node:fs/promises'
import { fileTypeFromFile } from 'file-type'
import {
  DOWNLOAD_PAGE_SIZE,
  decodeDownloadPath,
  encodeDownloadPath,
  formatDownloadSize,
  getDownloadRoot,
  listDownloadEntries,
  resolveDownloadPath
} from '../../lib/download-browser.js'
import { sendLocalFile } from '../../lib/whatsapp-file-sender.js'

const MIME_BY_EXTENSION = {
  '.7z': 'application/x-7z-compressed',
  '.apk': 'application/vnd.android.package-archive',
  '.avi': 'video/x-msvideo',
  '.csv': 'text/csv',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.gif': 'image/gif',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.m4a': 'audio/mp4',
  '.mkv': 'video/x-matroska',
  '.mov': 'video/quicktime',
  '.mp3': 'audio/mpeg',
  '.mp4': 'video/mp4',
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.ppt': 'application/vnd.ms-powerpoint',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.rar': 'application/vnd.rar',
  '.txt': 'text/plain',
  '.wav': 'audio/wav',
  '.webm': 'video/webm',
  '.webp': 'image/webp',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.zip': 'application/zip'
}

function displayName(name, maxLength = 26) {
  const value = String(name || '')
  return value.length > maxLength ? value.slice(0, maxLength - 1) + '…' : value
}

function getMimeType(filePath, detected) {
  return detected?.mime || MIME_BY_EXTENSION[path.extname(filePath).toLowerCase()] || 'application/octet-stream'
}

function commandId(usedPrefix, command, action, token, extra = '') {
  return (usedPrefix || '.') + (command || 'download') + ' ' + action + ' ' + token + (extra ? ' ' + extra : '')
}

async function sendFolderList(m, conn, { root, relativePath, page, usedPrefix, command }) {
  const result = await listDownloadEntries(root, relativePath)
  const currentRelative = path.relative(root, result.directory).split(path.sep).join('/') || '.'
  const totalPages = Math.max(1, Math.ceil(result.entries.length / DOWNLOAD_PAGE_SIZE))
  const safePage = Math.min(Math.max(0, Number(page) || 0), totalPages - 1)
  const visible = result.entries.slice(safePage * DOWNLOAD_PAGE_SIZE, (safePage + 1) * DOWNLOAD_PAGE_SIZE)
  const currentToken = encodeDownloadPath(currentRelative)
  const rows = []

  if (currentRelative !== '.') {
    rows.push({
      title: '⬅️ Kembali ke folder',
      description: 'Naik satu tingkat',
      rowId: commandId(usedPrefix, command, 'back', currentToken)
    })
  }
  if (safePage > 0) {
    rows.push({
      title: '◀️ Halaman sebelumnya',
      description: 'Lihat file/folder sebelumnya',
      rowId: commandId(usedPrefix, command, 'page', currentToken, String(safePage - 1))
    })
  }

  for (const entry of visible) {
    const childRelative = currentRelative === '.' ? entry.name : currentRelative + '/' + entry.name
    const token = encodeDownloadPath(childRelative)
    if (token.length > 170) continue
    const isDirectory = entry.type === 'directory'
    rows.push({
      title: (isDirectory ? '📁 ' : '📄 ') + displayName(entry.name, isDirectory ? 22 : 23),
      description: isDirectory ? 'Folder • ketuk untuk membuka' : 'File • ' + formatDownloadSize(entry.size) + ' • ketuk untuk mengirim',
      rowId: commandId(usedPrefix, command, isDirectory ? 'open' : 'send', token)
    })
  }

  if (safePage < totalPages - 1) {
    rows.push({
      title: 'Halaman berikutnya ▶️',
      description: 'Lihat file/folder selanjutnya',
      rowId: commandId(usedPrefix, command, 'page', currentToken, String(safePage + 1))
    })
  }

  const folderLabel = currentRelative === '.' ? '/downloads' : '/downloads/' + currentRelative
  const summary = [
    '📂 *' + folderLabel + '*',
    '📦 ' + result.entries.length + ' item' + (result.truncated ? ' pertama (daftar dibatasi)' : ''),
    'Halaman ' + (safePage + 1) + '/' + totalPages,
    '',
    'Pilih folder untuk membukanya atau file untuk mengirimkannya ke chat ini.'
  ].join('\n')

  if (!rows.length) {
    await conn.sendMessage(m.chat, {
      text: summary + '\n\nFolder ini kosong atau tidak memiliki item yang dapat ditampilkan.'
    }, { quoted: m })
    return
  }

  try {
    await conn.sendMessage(m.chat, {
      text: summary,
      footer: global.namebot || 'Alvareth Bot',
      title: '📁 ALVARETH DOWNLOADS',
      buttonText: 'Buka folder / pilih file',
      sections: [{ title: 'Folder dan file', rows }]
    }, { quoted: m })
  } catch (error) {
    console.error('[DOWNLOAD] Gagal mengirim daftar interaktif:', error?.stack || error)
    const fallback = rows.map((row, index) =>
      (index + 1) + '. ' + row.title + '\n   ' + row.description + '\n   ' + row.rowId
    ).join('\n')
    await conn.sendMessage(m.chat, {
      text: summary + '\n\n' + fallback + '\n\nPilih dengan mengetik salah satu perintah di atas.'
    }, { quoted: m })
  }
}

const handler = async (m, { conn, text, usedPrefix, command }) => {
  if (String(m.chat || '').endsWith('@g.us')) {
    return m.reply('📁 Fitur tombol .download hanya tersedia di chat pribadi WhatsApp. Silakan buka chat pribadi dengan bot lalu ketik .download.')
  }
  const root = await getDownloadRoot()
  const parts = String(text || '').trim().split(/\s+/).filter(Boolean)
  const action = (parts[0] || 'browse').toLowerCase()
  console.log('[DOWNLOAD] Permintaan diterima:', { action, hasSelectionToken: Boolean(parts[1]), chat: m.chat })
  let relativePath = '.'
  let page = 0

  try {
    if (action === 'browse') {
      relativePath = '.'
    } else if (['open', 'back', 'page', 'send'].includes(action)) {
      relativePath = decodeDownloadPath(parts[1])
      if (action === 'back') relativePath = path.posix.dirname(relativePath)
      if (action === 'page') {
        page = Number(parts[2])
        if (!Number.isInteger(page) || page < 0 || page > 100000) throw new Error('Nomor halaman tidak valid.')
      }
    } else {
      return m.reply('Perintah: .download untuk membuka folder, lalu pilih folder atau file dari daftar.')
    }

    if (action === 'send') {
      const target = await resolveDownloadPath(root, relativePath)
      const info = await fs.stat(target)
      if (!info.isFile()) throw new Error('Item yang dipilih bukan file.')
      const maxBytes = Number(process.env.ALVARETH_DOWNLOAD_MAX_BYTES || (2 * 1024 ** 3 - 10 * 1024 ** 2))
      if (info.size > maxBytes) {
        throw new Error('Ukuran file ' + formatDownloadSize(info.size) + ' melebihi batas pengiriman ' + formatDownloadSize(maxBytes) + '. Atur ALVARETH_DOWNLOAD_MAX_BYTES jika perlu.')
      }

      const detected = await fileTypeFromFile(target).catch(() => null)
      const mimetype = getMimeType(target, detected)
      const fileName = path.basename(target)
      console.log('[DOWNLOAD] File pilihan tervalidasi; menyiapkan pengiriman:', {
        relativePath,
        size: info.size,
        mimetype,
        chat: m.chat
      })
      const delivery = await sendLocalFile(conn, m.chat, target, {
        jobId: 'download',
        mimetype,
        fileName,
        maxBytes,
        quoted: m,
        caption: '📁 *File dari Alvareth Downloads*\n' +
          '📄 ' + fileName + '\n' +
          '📦 ' + formatDownloadSize(info.size)
      })
      console.log('[DOWNLOAD] WhatsApp upload berhasil:', {
        messageId: delivery.messageId,
        mediaType: delivery.mediaType,
        size: delivery.size,
        fileName: delivery.fileName
      })
      try { await m.react('✅') } catch {}
      return
    }

    await sendFolderList(m, conn, { root, relativePath, page, usedPrefix, command })
  } catch (error) {
    console.error('[DOWNLOAD] Gagal memproses file manager:', error?.stack || error)
    await m.reply('❌ ' + String(error?.message || error) + '\nKetik .download untuk membuka folder utama lagi.')
  }
}

handler.help = ['download']
handler.tags = ['downloader']
handler.command = /^download$/i
handler.owner = true

export default handler
