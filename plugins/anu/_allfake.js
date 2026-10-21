import fs from 'fs'
import moment from 'moment-timezone'

const fallbackThumb = 'https://eiiuzfmbewjlwfjz.public.blob.vercel-storage.com/YnU5WMiCgO_file.jpeg'

const LINK_URL = 'https://spoo.me/ryoyamada-emdeh'
const LINK_TITLE = '✿ ʀyᴏ yᴀᴍᴀᴅᴀ'

let handler = m => m

handler.all = async function (m) {
    let thumb
    try {
        const pp = await this.profilePictureUrl(this.user.jid, 'image')
        thumb = await (await fetch(pp)).buffer()
    } catch {
        try {
            thumb = fs.readFileSync('./thumbnail.jpg')
        } catch {
            thumb = await (await fetch(fallbackThumb)).buffer()
        }
    }

    global.adReply = {
        contextInfo: {
            forwardingScore: 999,
            isForwarded: false,
            forwardedNewsletterMessageInfo: {
                newsletterName: global.newsletterName,
                newsletterJid: global.chId
            }
        }
    }

    // === Fake STATUS ===
    global.fstatus = {
        key: {
            participant: '0@s.whatsapp.net',
            remoteJid: 'status@broadcast',
            fromMe: false,
            id: 'RyoYamada'
        },
        message: {
            locationMessage: {
                name: global.wm,
                jpegThumbnail: thumb
            }
        }
    }

    // === Fake Kontak ===
    global.fkontak = {
        key: {
            fromMe: false,
            participant: '0@s.whatsapp.net'
        },
        message: {
            contactMessage: {
                displayName: global.wm,
                vcard: `BEGIN:VCARD
VERSION:3.0
N:XL;${global.wm},;;;
FN:${global.wm}
item1.TEL;waid=${m.sender.split('@')[0]}:${m.sender.split('@')[0]}
item1.X-ABLabel:Ponsel
END:VCARD`,
                jpegThumbnail: thumb
            }
        }
    }

    // === Fake VN ===
    global.fvn = {
        key: {
            fromMe: false,
            participant: '0@s.whatsapp.net'
        },
        message: {
            audioMessage: {
                mimetype: 'audio/ogg; codecs=opus',
                seconds: '999999',
                ptt: true
            }
        }
    }

    // === Fake Text ===
    global.ftextt = {
        key: {
            fromMe: false,
            participant: '0@s.whatsapp.net'
        },
        message: {
            extendedTextMessage: {
                text: global.wm,
                title: global.wm,
                jpegThumbnail: thumb
            }
        }
    }

    // === Fake Gif ===
    global.fgif = {
        key: {
            fromMe: false,
            participant: '0@s.whatsapp.net'
        },
        message: {
            videoMessage: {
                title: global.wm,
                h: 'Hmm',
                seconds: '999',
                gifPlayback: true,
                caption: global.wm,
                jpegThumbnail: thumb
            }
        }
    }

    // === Fake Toko ===
    global.ftoko = {
        key: {
            fromMe: false,
            participant: '0@s.whatsapp.net'
        },
        message: {
            productMessage: {
                product: {
                    productImage: {
                        mimetype: 'image/jpeg',
                        jpegThumbnail: thumb
                    },
                    title: global.wm,
                    description: 'Simple Bot ESM',
                    currencyCode: 'IDR',
                    priceAmount1000: '7777777',
                    retailerId: global.wm,
                    productImageCount: 1
                },
                businessOwnerJid: '0@s.whatsapp.net'
            }
        }
    }

    // === Fake Document ===
    global.fdocs = {
        key: {
            participant: '0@s.whatsapp.net'
        },
        message: {
            documentMessage: {
                title: global.wm,
                jpegThumbnail: thumb
            }
        }
    }

    // === Fake Group Invite ===
    global.fgclink = {
        key: {
            fromMe: false,
            participant: '0@s.whatsapp.net'
        },
        message: {
            groupInviteMessage: {
                groupJid: '628xxx-xxx@g.us',
                inviteCode: 'null',
                groupName: global.wm,
                caption: global.wm,
                jpegThumbnail: thumb
            }
        }
    }

    if (!this._autoLinkPreviewPatched) {
        this._autoLinkPreviewPatched = true

        const originalSend = this.sendMessage.bind(this)

        this.sendMessage = async (jid, content = {}, options = {}) => {

            if (Array.isArray(jid)) {
                let results = []
                for (let id of jid) {
                    results.push(await this.sendMessage(id, content, options))
                }
                return results
            }

            const allowedKeys = ['text', 'mentions', 'contextInfo']
            const isPlainText =
                content.text &&
                Object.keys(content).every(k => allowedKeys.includes(k))

            if (isPlainText) {
                return originalSend(jid, {
                    text: `${LINK_URL}  ${content.text}`,
                    mentions: content.mentions,
                    linkPreview: {
                        'matched-text': LINK_URL,
                        title: LINK_TITLE,
                        description: momentGreeting(),
                        previewType: 0,
                        jpegThumbnail: thumb
                    },
                    contextInfo: {
                        ...(content.contextInfo || {}),
                        mentionedJid: content.contextInfo?.mentionedJid || content.mentions || []
                    }
                }, options)
            }

            return originalSend(jid, content, options)
        }
    }
}

export default handler

function momentGreeting() {
    const hour = moment.tz('Asia/Jakarta').hour()

    if (hour >= 18) return 'Konbanwa🍃'
    if (hour >= 15) return 'Konnichiwa🌾'
    if (hour > 10) return 'Konnichiwa🍂'
    if (hour >= 4) return 'Ohayou Gozaimasu🌿'
    return 'Oyasuminasai🪷'
}