import test from 'node:test'
import assert from 'node:assert/strict'
import handler, {
  buildSwgcPickerRows,
  getSwgcPage,
  getSwgcPages,
  SWGC_MAX_LIST_ROWS
} from '../plugins/group/tagsw.js'

function makeGroups(count) {
  return Array.from({ length: count }, (_, i) => ({
    id: `120000000000${String(i + 1).padStart(2, '0')}@g.us`,
    subject: `Grup ${String(i + 1).padStart(3, '0')}`
  }))
}

function groupIdsFromRows(rows) {
  return rows
    .filter(row => row.id.includes('swgcselect'))
    .map(row => row.id.split(/\s+/).pop())
}

test('SWGC: 10 grup atau kurang tampil semua dalam satu halaman tanpa navigasi', () => {
  assert.equal(SWGC_MAX_LIST_ROWS, 10)
  assert.deepEqual(getSwgcPages(10), [{ start: 0, count: 10 }])
  assert.deepEqual(getSwgcPages(3), [{ start: 0, count: 3 }])
  const { rows, page } = buildSwgcPickerRows(makeGroups(10), 0, 'token123', '.')
  assert.equal(rows.length, 10)
  assert.equal(page.totalPages, 1)
  assert.equal(page.hasPrev, false)
  assert.equal(page.hasNext, false)
  assert.deepEqual(groupIdsFromRows(rows), makeGroups(10).map(group => group.id))
})

test('SWGC: semua grup tetap tercapai lewat paginasi di dalam satu daftar', () => {
  for (const total of [11, 20, 25, 47, 100]) {
    const groups = makeGroups(total)
    const seen = []
    const pages = getSwgcPages(total)
    assert.ok(pages.length > 1, `total ${total} harus lebih dari satu halaman`)
    for (let page = 0; page < pages.length; page++) {
      const { rows, page: pageInfo } = buildSwgcPickerRows(groups, page, 'token123', '.')
      // Batas keras WhatsApp: maksimal 10 baris per pesan daftar.
      assert.ok(rows.length <= SWGC_MAX_LIST_ROWS, `halaman ${page} dari ${total} grup: ${rows.length} baris`)
      assert.equal(pageInfo.hasPrev, page > 0)
      assert.equal(pageInfo.hasNext, page < pages.length - 1)
      if (pageInfo.hasNext) {
        assert.ok(rows.some(row => row.id.startsWith('.swgcpage token123 ' + (page + 1))))
      }
      if (pageInfo.hasPrev) {
        assert.ok(rows.some(row => row.id.startsWith('.swgcpage token123 ' + (page - 1))))
      }
      seen.push(...groupIdsFromRows(rows))
    }
    assert.deepEqual(seen, groups.map(group => group.id), `semua ${total} grup harus muncul tepat sekali`)
  }
})

test('SWGC: nomor grup di judul baris mengikuti urutan global, bukan per halaman', () => {
  const { rows } = buildSwgcPickerRows(makeGroups(25), 1, 'token123', '.')
  const groupRows = rows.filter(row => row.id.includes('swgcselect'))
  assert.equal(groupRows[0].title.startsWith('10. '), true)
  assert.equal(groupRows.at(-1).title.startsWith('17. '), true)
  assert.equal(getSwgcPage(makeGroups(25), 99).page, 2)
})

test('SWGC: perintah swgcpage menampilkan halaman berikutnya dari sesi yang sama', async () => {
  const groups = makeGroups(25)
  const sent = []
  const conn = {
    groupFetchAllParticipating: async () => Object.fromEntries(
      groups.map(group => [group.id, { id: group.id, subject: group.subject }])
    ),
    sendMessage: async (_chat, payload) => {
      sent.push(payload)
      return { key: { id: 'picker-' + sent.length } }
    }
  }
  const replies = []
  const m = {
    sender: '6281234567890@s.whatsapp.net',
    chat: '6281234567890@s.whatsapp.net',
    isGroup: false,
    quoted: { text: 'Status tes' },
    message: {},
    reply: async text => { replies.push(text) }
  }

  await handler(m, { conn, text: '', usedPrefix: '.', command: 'swgc', isAdmin: false, isOwner: false })
  assert.equal(sent.length, 1)
  const firstRows = sent[0].nativeFlow[0].sections[0].rows
  assert.equal(firstRows.length, 10)
  assert.deepEqual(groupIdsFromRows(firstRows), groups.slice(0, 9).map(group => group.id))

  const nextRow = firstRows.find(row => row.id.includes('swgcpage'))
  assert.ok(nextRow, 'halaman pertama harus punya baris Halaman berikutnya')
  const [, token, page] = nextRow.id.replace(/^\./, '').split(/\s+/)
  assert.equal(page, '1')

  await handler(m, { conn, text: `${token} ${page}`, usedPrefix: '.', command: 'swgcpage', isAdmin: false, isOwner: false })
  assert.equal(sent.length, 2)
  assert.equal(replies.length, 0)
  const secondRows = sent[1].nativeFlow[0].sections[0].rows
  assert.equal(secondRows.length, 10)
  assert.deepEqual(groupIdsFromRows(secondRows), groups.slice(9, 17).map(group => group.id))
  assert.ok(sent[1].text.includes('Halaman 2 dari 3'))

  // Pengirim lain tidak boleh memakai tombol sesi ini.
  const other = { ...m, sender: '6289999999999@s.whatsapp.net' }
  await handler(other, { conn, text: `${token} 2`, usedPrefix: '.', command: 'swgcpage', isAdmin: false, isOwner: false })
  assert.equal(sent.length, 2)
  assert.match(replies.at(-1), /bukan milik kamu/)
})
