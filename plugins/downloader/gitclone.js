const regex = /(?:https|git)(?::\/\/|@)github\.com[\/:]([^\/:]+)\/(.+)/i
var handler = async (m, { args, usedPrefix, command, conn }) => {
    if (!args[0]) throw `Example user ${usedPrefix}${command} https://github.com/ImYanXiao/Elaina-MultiDevice`
    if (!regex.test(args[0])) throw 'Url Tidak Valid! '
    let [_, user, repo] = args[0].match(regex) || []
    repo = repo.replace(/.git$/, '')
    let url = `https://api.github.com/repos/${user}/${repo}/zipball`

    const head = await fetch(url, { method: 'HEAD' })
    if (!head.ok) throw new Error(`GitHub gagal menyiapkan ZIP (HTTP ${head.status}).`)
    const disposition = head.headers.get('content-disposition') || ''
    const filename = disposition.match(/attachment; filename="?([^";]+)"?/i)?.[1] || `${repo}.zip`

    await m.reply('D o w n l o a d i n g. . .')
    return await conn.sendFile(m.chat, url, filename, null, m)
}
handler.help = ['gitclone'].map(v => v + ' <url>')
handler.tags = ['downloader']
handler.command = /gitclone/i

handler.limit = true

export default handler
