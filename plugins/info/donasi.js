let handler = async (m) => {
  const ownerContact = global.nomorown
    ? `wa.me/${global.nomorown}`
    : 'Kontak owner belum diatur di file .env.'
  await m.reply(`*SUPPORT ALVARETH BOT* 🤍\n\nJika bot ini bermanfaat, terima kasih atas dukunganmu. ✨\n\nOwner: ${global.nameown || 'Light V'}\nKontak: ${ownerContact}`)
}

handler.help = ['donasi']
handler.tags = ['info']
handler.command = /^donasi$/i

export default handler
