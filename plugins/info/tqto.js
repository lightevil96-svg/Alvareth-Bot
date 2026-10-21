// gausah hapus credit mending tambahin aja nama lu di list

import fs from 'fs'
import { prepareWAMessageMedia } from 'baileys'

let handler = async (m, { conn }) => {
    const urlB = global.repository || 'https://github.com/'

    const thumb = fs.readFileSync('./media/thumbnail.jpg')

    const { imageMessage: image } = await prepareWAMessageMedia({
        image: thumb
    }, {
        upload: conn.waUploadToServer,
        mediaTypeOverride: 'thumbnail-link'
    })

    image.width = 1280
    image.height = 720

    const teks = `
❏ Al 
❏ irsan
❏ sanur    
❏ via 
❏ nesta
❏ rachel
❏ Nana
❏ Kyu
❏ Ham
❏ han
❏ Renz 
❏ Rin
❏ Kano
❏ kaizen
❏ fahri
❏ gara
❏ raynold
❏ Zynn
❏ Lynx
❏ Fikri 
❏ Ryu 

❏ ShirokamiRyzen (Penyedia Base Nao MD)
❏ ItsLiaaa (Penyedia Baileys)

❏ Penyedia Layanan API
❏ Penyedia Server/VPS

❏ Contributor
❏ Tester

❏ Light V (Owner Alvareth Bot)
❏ Hilman (Pembuat SC sumber Ryo Yamada MD)

❏ Semua Supporter
❏ Semua User Alvareth Bot
`.trim()

    await conn.sendMessage(m.chat, {
        text: `${urlB}\n\n${teks}`,
        linkPreview: {
            'matched-text': urlB,
            title: 'Alvareth Bot',
            description: 'Alvareth Bot',
            previewType: 0,
            jpegThumbnail: thumb,
            highQualityThumbnail: image,
            linkPreviewMetadata: {
                linkMediaDuration: 0,
                socialMediaPostType: 4
            }
        }
    }, { quoted: m })
}

handler.help = ['tqto']
handler.tags = ['info']
handler.command = /^(tqto|thanks|credit|credits)$/i

export default handler