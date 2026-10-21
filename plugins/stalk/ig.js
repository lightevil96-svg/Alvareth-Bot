let handler = async (m, { conn, text, usedPrefix, command }) => {
  if (!text) {
    return m.reply(`Contoh:\n${usedPrefix + command} hilman_ackerman`)
  }

  try {
    await m.react('🕒')

    const res = await fetch(
      API('theresav', '/stalk/ig', {
        username: text.trim()
      }, 'apikey')
    )

    const json = await res.json()

    if (!json.status) throw 'Username tidak ditemukan.'

    const d = json.result

    await conn.sendMessage(m.chat, {
      image: { url: d.profilePicUrl },
      caption: `
*\`Instagram Stalk\`*

✿ *\`Username\`* : ${d.username}
✿ *\`Full Name\`* : ${d.fullName || '-'}
✿ *\`Followers\`* : ${Number(d.followedCount).toLocaleString('id-ID')}
✿ *\`Following\`* : ${Number(d.followCount).toLocaleString('id-ID')}
✿ *\`Posts\`* : ${Number(d.postsCount).toLocaleString('id-ID')}
✿ *\`Verified\`* : ${d.isVerified ? 'Yes ✅' : 'No ❌'}
✿ *\`Private\`* : ${d.isPrivate ? 'Yes 🔒' : 'No 🌍'}
✿ *\`Biography\`* : ${d.biography || '-'}
`.trim()
    }, {
      quoted: m
    })

    await m.react('✅')

  } catch (e) {
    console.error(e)
    await m.react('❌')
    m.reply(typeof e === 'string' ? e : '❌ Gagal mengambil data Instagram.')
  }
}

handler.help = ['igstalk']
handler.tags = ['stalk']
handler.command = /^(igstalk|instagramstalk)$/i
handler.limit = true

export default handler