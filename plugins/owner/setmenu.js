let handler = async (m, { text }) => {
  const n = parseInt(text?.trim())

  if (![1, 2].includes(n)) {
    return m.reply(`Pilih style menu:\n\n*setmenu 1* — Button\n*setmenu 2* — Link Preview Thumbnail Besar`)
  }

  global.menuStyle = n
  m.reply(`✅ Menu style diubah ke *Style ${n}*`)
}

handler.help = ['setmenu <1/2>']
handler.tags = ['owner']
handler.command = /^setmenu$/i
handler.owner = true

export default handler