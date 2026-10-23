let handler = async (m) => {
  const statusMessage = `*\`Alvareth Bot\`*

✿ *\`Status\`* : Online.
✿ *\`Info\`* : Ketik *.menu* untuk melihat semua fitur.

Ketik *.menu* untuk melihat fitur yang tersedia.`

  m.reply(statusMessage)
}

handler.customPrefix = /^(tes|bot|alvareth|alvarethbot|test)$/i
handler.command = new RegExp

export default handler