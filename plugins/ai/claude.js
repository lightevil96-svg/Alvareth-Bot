let handler = async (m, { text, usedPrefix, command }) => {
  if (!text) {
    return m.reply(`Contoh:
${usedPrefix + command} Halo`)
  }

  await m.react('🕒')

  try {
    const res = await fetch(
      `${global.APIs.nexray}/ai/claude?text=${encodeURIComponent(text)}`
    )
    const data = await res.json()

    if (!data?.status) {
      await m.react('❌')
      return m.reply('❌ Gagal mendapatkan respons AI.')
    }

    const caption = `   *Claude AI*

✿ *Question* : ${text}

✿ *Answer* :
${data.result}`

    await m.react('✅')
    m.reply(caption)
  } catch (e) {
    console.error(e)
    await m.react('❌')
    m.reply('❌ Terjadi kesalahan.')
  }
}

handler.help = ['claude']
handler.tags = ['ai']
handler.command = /^(claude|claudeai)$/i
handler.register = true
handler.limit = true

export default handler