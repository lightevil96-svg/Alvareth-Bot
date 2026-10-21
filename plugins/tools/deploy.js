import axios from 'axios'

const TOKEN = process.env.VERCEL_TOKEN || ''

let handler = async (m, { text }) => {
  if (!text) return m.reply(
    `✦ ─────────────── ✦\n` +
    `  ❀ Contoh Penggunaan\n` +
    `✦ ─────────────── ✦\n\n` +
    `  .deploy nama-project`
  )

  if (!m.quoted) return m.reply(
    `✦ ─────────────── ✦\n` +
    `  ❀ Reply file index.html\n` +
    `✦ ─────────────── ✦`
  )

  await m.react('⏳')

  const projectName = text.trim().toLowerCase()
  const htmlFile = await m.quoted.download()

  await axios.post(
    'https://api.vercel.com/v9/projects',
    { name: projectName },
    {
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        'Content-Type': 'application/json'
      }
    }
  )

  const { data } = await axios.post(
    'https://api.vercel.com/v13/deployments',
    {
      name: projectName,
      files: [
        {
          file: 'index.html',
          data: htmlFile.toString('base64'),
          encoding: 'base64'
        }
      ],
      projectSettings: { framework: null }
    },
    {
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        'Content-Type': 'application/json'
      }
    }
  )

  const deployUrl = data?.url || `${projectName}.vercel.app`

  await m.reply(
    `✦ ─────────────── ✦\n` +
    `    𝗗 𝗘 𝗣 𝗟 𝗢 𝗬  𝗩 𝗘 𝗥 𝗖 𝗘 𝗟\n` +
    `✦ ─────────────── ✦\n\n` +
    `❀ Project  : ${projectName}\n` +
    `❀ URL      : https://${deployUrl}\n\n` +
    `✦ ─────────────── ✦\n` +
    `  ✨ Berhasil di deploy ~`
  )

  await m.react('✅')
}

handler.help = ['deploy']
handler.tags = ['tools']
handler.command = /^deploy$/i
handler.limit = false
handler.register = false

export default handler