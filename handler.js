import { smsg } from './lib/simple.js'
import { format } from 'util'
import { fileURLToPath } from 'url'
import path, { join } from 'path'
import { watchFile } from 'fs'
import chalk from 'chalk'
import fetch from 'node-fetch'

/**
 * @type {import('baileys')}
 */
const { proto } = (await import('baileys')).default
const isNumber = x => typeof x === 'number' && !isNaN(x)
const delay = ms => isNumber(ms) && new Promise(resolve => setTimeout(resolve, ms))

export async function handler(chatUpdate) {
    this.msgqueque = this.msgqueque || []
    if (!chatUpdate) return
    this.pushMessage(chatUpdate.messages).catch(console.error)
    
    let m = chatUpdate.messages[chatUpdate.messages.length - 1]
    if (!m) return
    
    const conn = this
    
    if (global.db.data == null) await global.loadDatabase()
    
    try {
    const rawMessage = m
    // Snapshot these before protobuf serialization; fromObject may normalize/drop fields.
    const rawKeySnapshot = rawMessage?.key ? { ...rawMessage.key } : null
    const rawContentSnapshot = rawMessage?.message ? { ...rawMessage.message } : null
    m = smsg(this, m) || m
    if (!m) return

    // Compatibility layer: protobuf conversion in this Baileys fork can leave
    // message objects without serializer methods. Add safe fallbacks centrally
    // so every plugin can use m.reply() / m.react() instead of crashing.
    if (typeof m.reply !== 'function') {
        Object.defineProperty(m, 'reply', {
            configurable: true,
            enumerable: false,
            writable: true,
            value: function (text, chatId, options = {}) {
                const target = typeof chatId === 'string' ? chatId : this.chat
                const sendOptions = (chatId && typeof chatId === 'object' ? chatId : options) || {}
                return conn.sendMessage(target, typeof text === 'string' ? { text } : text, {
                    quoted: this,
                    ...sendOptions
                })
            }
        })
    }
    if (typeof m.react !== 'function') {
        Object.defineProperty(m, 'react', {
            configurable: true,
            enumerable: false,
            writable: true,
            value: function (text) {
                if (!this.chat || !this.key) return Promise.resolve(null)
                return conn.sendMessage(this.chat, {
                    react: { text: String(text ?? ''), key: this.key }
                })
            }
        })
    }

    // Restore routing metadata and derive command-critical fields from the original
    // Baileys event. This fork's protobuf conversion may retain key data but lose
    // the serializer prototype getters (chat/sender/mtype), so do not rely on getters.
    if (rawKeySnapshot) {
        if (!m.key) m.key = { ...rawKeySnapshot }
        else {
            for (const field of ['remoteJid', 'participant', 'fromMe', 'id', 'participantAlt', 'remoteJidAlt', 'addressingMode']) {
                if ((m.key[field] === undefined || m.key[field] === null || m.key[field] === '') &&
                    rawKeySnapshot[field] !== undefined && rawKeySnapshot[field] !== null) {
                    m.key[field] = rawKeySnapshot[field]
                }
            }
        }
        m.conn = conn
    }

    const rawChat = typeof rawKeySnapshot?.remoteJid === 'string' ? rawKeySnapshot.remoteJid : ''
    const rawFromMe = rawKeySnapshot?.fromMe === true
    const rawSender = rawFromMe
        ? (conn.user?.id || rawKeySnapshot?.remoteJidAlt || rawChat)
        : (rawKeySnapshot?.participantAlt || rawKeySnapshot?.participant || rawKeySnapshot?.remoteJidAlt || rawChat)
    const normalizeJid = value => typeof value === 'string' && value
        ? (typeof conn.decodeJid === 'function' ? conn.decodeJid(value) : value)
        : ''
    const derivedChat = normalizeJid(rawChat)
    const derivedSender = normalizeJid(rawSender)

    // WhatsApp group JIDs are authoritative. In this Baileys fork the
    // serialized message may expose an incorrect m.isGroup=false even while
    // m.chat/raw remoteJid is a valid @g.us JID. Normalize the flag before
    // plugin permissions run so group-only commands (including .swgc) work.
    const isGroupJid = value => typeof value === 'string' && /@g\.us$/i.test(value)
    const normalizedIsGroup = isGroupJid(rawChat) || isGroupJid(derivedChat) ||
        isGroupJid(m.chat) || m.isGroup === true
    if (m.isGroup !== normalizedIsGroup ||
        Object.getOwnPropertyDescriptor(m, 'isGroup')?.writable !== true) {
        Object.defineProperty(m, 'isGroup', {
            configurable: true,
            enumerable: true,
            writable: true,
            value: normalizedIsGroup
        })
    }

    // Override absent/broken prototype getters with stable own data properties.
    if (typeof m.chat !== 'string' || !m.chat) {
        Object.defineProperty(m, 'chat', { configurable: true, enumerable: true, writable: true, value: derivedChat })
    }
    if (typeof m.sender !== 'string' || !m.sender) {
        Object.defineProperty(m, 'sender', { configurable: true, enumerable: true, writable: true, value: derivedSender })
    }
    if (typeof m.fromMe !== 'boolean' || (rawFromMe && m.fromMe !== true)) {
        Object.defineProperty(m, 'fromMe', { configurable: true, enumerable: true, writable: true, value: rawFromMe })
    }
    if ((!m.mtype || typeof m.mtype !== 'string') && rawContentSnapshot) {
        const rawType = Object.keys(rawContentSnapshot).find(key => key !== 'messageContextInfo' && key !== 'senderKeyDistributionMessage') || ''
        if (rawType) Object.defineProperty(m, 'mtype', { configurable: true, enumerable: true, writable: true, value: rawType })
    }

    // Prefer the selected command ID from interactive button/list replies.
    // Template buttons may expose their visible label via m.text, which must not
    // shadow the selectedId needed to route commands such as ".ttfoto <url>".
    const content = rawContentSnapshot || rawMessage?.message || {}
    let nativeFlowSelectedId = ''
    const nativeFlowParams = content.interactiveResponseMessage?.nativeFlowResponseMessage?.paramsJson
    if (typeof nativeFlowParams === 'string') {
        try {
            const parsed = JSON.parse(nativeFlowParams)
            nativeFlowSelectedId = parsed.id || parsed.selectedId || parsed.row_id || parsed.button_id || ''
        } catch {
            // Not all interactive responses contain JSON command parameters.
        }
    }
    const selectedButtonId =
        content.templateButtonReplyMessage?.selectedId ||
        content.buttonsResponseMessage?.selectedButtonId ||
        content.listResponseMessage?.singleSelectReply?.selectedRowId ||
        nativeFlowSelectedId
    if (typeof selectedButtonId === 'string' && selectedButtonId.trim()) {
        m.text = selectedButtonId.trim()
    } else if (typeof m.text !== 'string' || !m.text.trim()) {
        // Fallback text extraction for self-chat / LID messages when the serializer
        // does not expose m.text consistently. This keeps commands such as .menu usable.
        const rawText = content.conversation ||
            content.extendedTextMessage?.text ||
            content.imageMessage?.caption ||
            content.videoMessage?.caption ||
            content.documentMessage?.caption ||
            content.buttonsResponseMessage?.selectedButtonId ||
            content.listResponseMessage?.singleSelectReply?.selectedRowId
        if (typeof rawText === 'string') m.text = rawText
    }

    // Temporary diagnostic: trace .menu through serialization and command parsing.
    const isMenuDiagnostic = typeof m.text === 'string' && /^\s*[.!/](menu|help)(?:\s|$)/i.test(m.text)
    if (isMenuDiagnostic) console.log('[DIAG menu-handler]', JSON.stringify({
        text: m.text,
        rawKey: rawKeySnapshot,
        serializedKey: m.key || null,
        rawMessageKeys: rawContentSnapshot ? Object.keys(rawContentSnapshot) : [],
        serializedMessageKeys: m.message ? Object.keys(m.message) : [],
        prototypeName: Object.getPrototypeOf(m)?.constructor?.name || null,
        hasChatGetter: Boolean(Object.getOwnPropertyDescriptor(Object.getPrototypeOf(m) || {}, 'chat')?.get),
        hasSenderGetter: Boolean(Object.getOwnPropertyDescriptor(Object.getPrototypeOf(m) || {}, 'sender')?.get),
        connectionUser: conn.user?.id || null,
        derivedChat: derivedChat || null,
        derivedSender: derivedSender || null,
        sender: m.sender || null,
        chat: m.chat || null,
        fromMe: Boolean(m.fromMe),
        messageType: m.mtype || null,
        textType: typeof m.text
    }))
    // Ignore non-chat/system updates that do not contain a usable sender or chat JID.
    if (typeof m.sender !== 'string' || !m.sender || typeof m.chat !== 'string' || !m.chat) {
        if (isMenuDiagnostic) console.log('[DIAG menu-stop] missing sender/chat')
        return
    }

    m.exp = 0
    m.limit = false

m.senderPN = m.sender

if (m.sender?.endsWith('@lid')) {
    const resolved = await conn.findUserId(m.sender).catch(() => null)
    if (resolved?.phoneNumber) {
        m.senderPN = resolved.phoneNumber
    }
}

m.mentionedJidPN = []

if (Array.isArray(m.mentionedJid)) {
    m.mentionedJidPN = await Promise.all(
        m.mentionedJid.map(async jid => {
            if (!jid?.endsWith('@lid')) return jid

            const resolved = await conn.findUserId(jid).catch(() => null)
            return resolved?.phoneNumber || jid
        })
    )
}

m.quotedSenderPN = m.quoted?.sender || null

if (m.quoted?.sender?.endsWith('@lid')) {
    const resolved = await conn.findUserId(m.quoted.sender).catch(() => null)

    if (resolved?.phoneNumber) {
        m.quotedSenderPN = resolved.phoneNumber
    }
}
        // Cache pushName untuk welcome/goodbye
        if (m.pushName && m.sender) {
            if (!global.nameCache) global.nameCache = {}
            global.nameCache[m.sender] = m.pushName
        }

        // Detect group icon change (stub type 22 = GROUP_CHANGE_ICON)
        if (m.messageStubType === 22 && m.chat?.endsWith('@g.us')) {
            let chats = global.db.data.chats?.[m.chat]
            if (chats?.detect) {
                await this.sendMessage(m.chat, { text: chats.sIcon || '```Icon grup diganti```' }).catch(console.error)
            }
        }

        // auto typing 
        if (global.autotyping && typeof this.sendPresenceUpdate === 'function') {
            this.sendPresenceUpdate('composing', m.chat).catch(console.error)
        }
        if (global.autorecording && typeof this.sendPresenceUpdate === 'function') {
            this.sendPresenceUpdate('recording', m.chat).catch(console.error)
        }

        try {
            // USER DATABASE INIT
            if (typeof global.db.data.users[m.sender] !== 'object')
                global.db.data.users[m.sender] = {}
            
            let user = global.db.data.users[m.sender]
            const defaults = {
            registered: false,
            name: m.name || '',
            nama: '',
            username: '',
            age: -1,
            regTime: -1,
            
            level: 0,
            exp: 0,
            totalexp: 0,
            limit: 100,
            freelimit: 0,
            warn: 0,
            warned: 0,
            
            afk: -1,
            afkReason: '',
            
            banned: false,
            banReason: '',
            role: 'Free user',
            autolevelup: false,
            
            premium: false,
            premiumTime: 0,
            
            money: 0,
            bank: 0,
            atm: 0,
            fullatm: 0,
            chip: 0,
            
            health: 100,
            maxHealth: 100,
            energy: 100,
            stamina: 100,
            sleep: 100,
            
            potion: 0,
            trash: 0,
            wood: 0,
            rock: 0,
            string: 0,
            iron: 0,
            gold: 0,
            emerald: 0,
            diamond: 0,
            
            common: 0,
            uncommon: 0,
            mythic: 0,
            legendary: 0,
            
            petfood: 0,
            pet: 0,
            umpan: 0,
            
            botol: 0,
            kardus: 0,
            kaleng: 0,
            gelas: 0,
            plastik: 0,
            
            gandum: 0,
            minyak: 0,
            garam: 0,
            
            apel: 0,
            anggur: 0,
            jeruk: 0,
            mangga: 0,
            pisang: 0,
            
            bibitapel: 0,
            bibitanggur: 0,
            bibitjeruk: 0,
            bibitmangga: 0,
            bibitpisang: 0,
            
            makanan: 0,
            
            ayam: 0,
            babi: 0,
            babihutan: 0,
            banteng: 0,
            buaya: 0,
            gajah: 0,
            harimau: 0,
            kambing: 0,
            kerbau: 0,
            monyet: 0,
            panda: 0,
            sapi: 0,
            
            paus: 0,
            kepiting: 0,
            gurita: 0,
            cumi: 0,
            buntal: 0,
            dory: 0,
            lumba: 0,
            lobster: 0,
            hiu: 0,
            udang: 0,
            orca: 0,
            
            ikan: 0,
            lele: 0,
            nila: 0,
            bawal: 0,
            
            steak: 0,
            ayam_goreng: 0,
            ayamgoreng: 0,
            ayambakar: 0,
            ribs: 0,
            roti: 0,
            udang_goreng: 0,
            udangbakar: 0,
            bacon: 0,
            
            ikanbakar: 0,
            lelebakar: 0,
            nilabakar: 0,
            bawalbakar: 0,
            kepitingbakar: 0,
            pausbakar: 0,
            babipanggang: 0,
            oporayam: 0,
            rendang: 0,
            gulai: 0,
            
            aqua: 0,
            clay: 0,
            coal: 0,
            
            ojek: 0,
            polisi: 0,
            roket: 0,
            rokets: 0,
            taxy: 0,
            
            horse: 0,
            horseexp: 0,
            
            cat: 0,
            catexp: 0,
            
            dog: 0,
            dogexp: 0,
            
            fox: 0,
            foxexp: 0,
            
            robo: 0,
            roboexp: 0,
            
            dragon: 0,
            dragonexp: 0,
            
            lion: 0,
            lionexp: 0,
            
            rhinoceros: 0,
            rhinocerosexp: 0,
            
            centaur: 0,
            centaurexp: 0,
            
            kyubi: 0,
            kyubiexp: 0,
            
            griffin: 0,
            griffinexp: 0,
            
            phonix: 0,
            phonixexp: 0,
            
            wolf: 0,
            wolfexp: 0,
            
            horselastfeed: 0,
            catlastfeed: 0,
            doglastfeed: 0,
            foxlastfeed: 0,
            robolastfeed: 0,
            dragonlastfeed: 0,
            lionlastfeed: 0,
            rhinoceroslastfeed: 0,
            centaurlastfeed: 0,
            kyubilastfeed: 0,
            griffinlastfeed: 0,
            phonixlastfeed: 0,
            wolflastfeed: 0,
            
            armor: 0,
            armordurability: 0,
            
            sword: 0,
            sworddurability: 0,
            
            pickaxe: 0,
            pickaxedurability: 0,
            
            fishingrod: 0,
            fishingroddurability: 0,
            
            robodurability: 0,
            
            lockBankCD: 0,
            lasthackbank: 0,
            
            lastadventure: 0,
            lastkill: 0,
            lastmisi: 0,
            lastdungeon: 0,
            lastwar: 0,
            lastsda: 0,
            lastduel: 0,
            lastmining: 0,
            lasthunt: 0,
            lastgift: 0,
            lastberkebon: 0,
            lastdagang: 0,
            lasthourly: 0,
            lastbansos: 0,
            lastrampok: 0,
            lastclaim: 0,
            lastnebang: 0,
            lastweekly: 0,
            lastmonthly: 0,
            
            lastDailyQuest: 0,
            lastHero: 0,
            lastKerjaRPG: 0,
            lastKoboy: 0,
            lastNotified: 0,
            lastcode: 0,
            lastgrab: 0,
            lastmaling: 0,
            lastmulung: 0,
            
            bunuh: 0,
            like: 0,
            
            subscribers: 0,
            viewers: 0,
            
            ownerWelcome: false,
            
            youtube_account: '',
            tiktok: '',
            
            senjata: 0,
            sand: 0,
            
            dailyQuest: {},
            
            jailUntil: 0,
            
            racing: {
            car: '',
            track: '',
            races: 0,
            wins: 0,
            losses: 0,
            coins: 0,
            recordTime: 0
            },
            
            cafe: {
            name: 'Kafe Pemula',
            level: 1,
            capacity: 10,
            stock: 20,
            maxStock: 20,
            popularity: 0,
            rating: 5,
            revenue: 0,
            upgradeCost: 50000,
            menu: []
            },
            
            pelabuhanLevel: 1,
            pelabuhanMaxPenumpang: 10,
            pelabuhanSaldo: 100,
            pelabuhanPendapatanPerPenumpang: 5,
            pelabuhanJumlahPenumpang: 0,
            pelabuhanBiayaUpgrade: 50,
            pelabuhanLastBermain: 0,
            pelabuhanCooldown: 1,
            
            attributes: {},
            attrs: {},
            
            count: 0,
            last: 0,
            
            items: [],
            
            currentGame: null,
            isPlaying: false,
            
            pasangan: '',
            pacar: '',
            jadian: false,
            jadianTime: 0,
            
            rpg: {
                hp: 100,
                gold: 0,
                skillCooldown: 0
            }
            }
            for (let key in defaults) if (!(key in user)) user[key] = defaults[key]

            // CHAT DATABASE INIT
            if (typeof global.db.data.chats[m.chat] !== 'object')
                global.db.data.chats[m.chat] = {}
            
            let chat = global.db.data.chats[m.chat]
            const chatDefaults = {
                isBanned: false, welcome: false, detect: false, sWelcome: '', sBye: '', sPromote: '', sDemote: '',
                delete: false, 
                antiLink: false, viewonce: false, antiToxic: false, simi: false, autogpt: false, autoSticker: false, premium: false, premiumTime: false, nsfw: false, menu: true, rpgs: true, expired: 0
            }
            for (let key in chatDefaults) if (!(key in chat)) chat[key] = chatDefaults[key]

            // SETTINGS INIT
            if (typeof global.db.data.settings[this.user.jid] !== 'object')
                global.db.data.settings[this.user.jid] = {}
            
            let settings = global.db.data.settings[this.user.jid]
            const settingDefaults = { self: false, autoread: false, anticall: true, restartDB: 0, restrict: false }
            for (let key in settingDefaults) if (!(key in settings)) settings[key] = settingDefaults[key]
            
        } catch (e) {
            console.error('INIT ERROR:', e)
        }

        // Options Check
        if (opts['nyimak']) return
        if (opts['pconly'] && m.chat.endsWith('g.us')) return
        if (opts['gconly'] && !m.chat.endsWith('g.us')) return
        if (opts['swonly'] && m.chat !== 'status@broadcast') return
        if (typeof m.text !== 'string') m.text = ''

        let resolvedSender = m.sender
if (typeof m.sender === 'string' && m.sender.endsWith('@lid')) {
  const resolved = await conn.findUserId(m.sender).catch(() => null)
  if (resolved?.phoneNumber) resolvedSender = resolved.phoneNumber
}
const isROwner = [conn.decodeJid(global.conn.user.id), ...global.owner.map(([number]) => number)].map(v => v.replace(/[^0-9]/g, '') + '@s.whatsapp.net').includes(resolvedSender)
const isOwner = isROwner || m.fromMe

        // Group allowlist gate: when enabled, silently ignore every message from
        // groups that are not explicitly approved. Private chats remain available
        // so the owner can manage the list even when no group is approved.
        const groupAccess = global.db.data.settings?.groupAccess || { enabled: true, allowedGroups: ['120363424686467256@g.us'] }
        if (m.chat.endsWith('@g.us') && groupAccess.enabled !== false) {
            const allowedGroups = Array.isArray(groupAccess.allowedGroups) ? groupAccess.allowedGroups : []
            if (!allowedGroups.includes(m.chat)) {
                console.log('[GROUP ACCESS] ignored message from unapproved group:', m.chat)
                return
            }
        }
const isMods = isOwner || global.mods.map(v => v.replace(/[^0-9]/g, '') + '@s.whatsapp.net').includes(resolvedSender)
const isPrems = isROwner || global.db.data.users[m.sender].premiumTime > 0
        
        if (!isOwner && !m.fromMe && opts['self']) return
        
        // Message Queue
        if (m.text && !(isMods || isPrems)) {
            let queque = this.msgqueque, time = 1000 * 5
            const previousID = queque[queque.length - 1]
            queque.push(m.id || m.key.id)
            let intervalID = setInterval(async function () {
                if (queque.indexOf(previousID) === -1) clearInterval(intervalID)
                await delay(time)
            }, time)
        }

// Do not filter messages by ID length: real WhatsApp messages may also
// be classified as Baileys by the legacy helper. Command matching handles replies safely.

if (global.db.data.chats[m.chat]?.autolevelup) {
    m.exp += Math.ceil(Math.random() * 10)
}

        const groupMetadata = m.isGroup ? await conn.groupMetadata(m.chat).catch(() => ({})) : {}
        const participants = m.isGroup ?(groupMetadata.participants || []) : []
        
const normalizeIdentity = value => {
  const values = new Set()
  if (typeof value !== 'string') return values
  const input = value.trim()
  if (!input) return values

  const add = jid => {
    if (!jid || typeof jid !== 'string') return
    const trimmed = jid.trim()
    if (!trimmed) return
    values.add(trimmed)
    values.add(trimmed.replace(/:\d+(?=@)/, ''))
    if (trimmed.endsWith('@c.us')) values.add(trimmed.replace(/@c\.us$/i, '@s.whatsapp.net'))
    if (typeof conn.decodeJid === 'function') {
      try {
        const decoded = conn.decodeJid(trimmed)
        if (decoded) {
          values.add(decoded)
          values.add(decoded.replace(/:\d+(?=@)/, ''))
          if (decoded.endsWith('@c.us')) values.add(decoded.replace(/@c\.us$/i, '@s.whatsapp.net'))
        }
      } catch {}
    }
  }

  if (/@/.test(input)) {
    add(input)
  } else if (/^\+?[\d\s().-]+$/.test(input)) {
    const digits = input.replace(/\D/g, '')
    if (digits) add(digits + '@s.whatsapp.net')
  } else {
    add(input)
  }
  return values
}

const participantIdentityValues = participant => [
  participant?.id,
  participant?.jid,
  participant?.phoneNumber,
  participant?.phone_number,
  participant?.lid,
  participant?.pn,
  participant?.participant,
  participant?.participantAlt
].filter(value => typeof value === 'string' && value)

const expandIdentityAliases = async values => {
  const aliases = new Set()
  for (const value of values) {
    for (const alias of normalizeIdentity(value)) aliases.add(alias)
  }

  // LID and phone-number JIDs are different namespaces. Resolve LIDs through
  // the active Baileys mapping so participant metadata can match either form.
  for (const alias of [...aliases]) {
    if (!alias.endsWith('@lid') || typeof conn.findUserId !== 'function') continue
    const resolved = await conn.findUserId(alias).catch(() => null)
    for (const value of [resolved?.phoneNumber, resolved?.lid]) {
      for (const normalized of normalizeIdentity(value)) aliases.add(normalized)
    }
  }
  return aliases
}

const userIds = await conn.findUserId(m.sender).catch(() => null)
const botIds = await conn.findUserId(conn.user?.id).catch(() => null)
const senderAliases = await expandIdentityAliases([
  m.sender,
  m.senderPN,
  m.key?.participant,
  m.key?.participantAlt,
  m.key?.remoteJidAlt,
  userIds?.phoneNumber,
  userIds?.lid
])
const botAliases = await expandIdentityAliases([
  conn.user?.id,
  conn.user?.lid,
  botIds?.phoneNumber,
  botIds?.lid
])

const participantMatches = async (participant, aliases) => {
  const identities = await expandIdentityAliases(participantIdentityValues(participant))
  for (const identity of identities) {
    if (aliases.has(identity)) return true
  }
  return false
}

let groupUser = {}
let bot = {}
if (m.isGroup) {
  for (const participant of participants) {
    if (!groupUser.admin && await participantMatches(participant, senderAliases)) groupUser = participant
    if (!bot.admin && await participantMatches(participant, botAliases)) bot = participant
    if (groupUser.admin && bot.admin) break
  }
}

const isRAdmin = groupUser?.admin === 'superadmin'
const isAdmin = isRAdmin || groupUser?.admin === 'admin'
const isBotAdmin = ['admin', 'superadmin'].includes(bot?.admin)

        const ___dirname = path.join(path.dirname(fileURLToPath(import.meta.url)), './plugins')

        let user = global.db.data.users[m.sender]
/*
if (user && user.name && !user.registered) {
    user.registered = true
}
*/

// Number-based ban gate. It runs before every plugin/before-handler so a banned
// number cannot trigger commands, AutoDL, AI auto-replies, or other bot features.
const normalizeBanNumber = value => {
  const raw = String(value || '').trim();
  // A LID is not a phone number. Only phone JIDs and bare resolved numbers
  // may be matched against the number-ban list.
  if (raw.includes('@') && !/@(?:s\.whatsapp\.net|c\.us)$/i.test(raw)) return '';
  return raw.split('@')[0].split(':')[0].replace(/\D/g, '');
};

const phoneBans = global.db.data.settings?.phoneBans || {};
const senderNumbers = [...new Set([
  normalizeBanNumber(m.senderPN),
  normalizeBanNumber(resolvedSender),
  normalizeBanNumber(m.sender)
].filter(number => number.length >= 8 && number.length <= 15))];

const phoneBanEntry = senderNumbers
  .map(number => ({ number, entry: phoneBans[number] }))
  .find(item => item.entry);

const isLegacyBanned = user?.banned === true;
const isNumberBanned = Boolean(phoneBanEntry);
if (!isOwner && (isNumberBanned || isLegacyBanned)) {
  const messageText = String(m.text || '').trim();
  const configuredPrefix = conn.prefix ?? global.prefix;
  const hasPrefix = value => {
    if (value instanceof RegExp) {
      const safeRegex = new RegExp(value.source, value.flags.replace(/[gy]/g, ''));
      return safeRegex.test(messageText);
    }
    if (typeof value === 'string') return value.length > 0 && messageText.startsWith(value);
    return false;
  };
  const isNoPrefixMode = configuredPrefix instanceof RegExp &&
    ['^', '(?:)', ''].includes(configuredPrefix.source);
  const startsWithPrefix = isNoPrefixMode ? false : (Array.isArray(configuredPrefix)
    ? configuredPrefix.some(hasPrefix)
    : hasPrefix(configuredPrefix));

  // In no-prefix mode, only known bot commands should trigger the teasing reply.
  let isCommandAttempt = startsWithPrefix;
  if (!isCommandAttempt && isNoPrefixMode) {
    const command = messageText.split(/\s+/)[0]?.toLowerCase();
    if (command) {
      isCommandAttempt = Object.values(global.plugins || {}).some(plugin => {
        if (!plugin || !plugin.command) return false;
        const matchesCommandRegex = regex => {
          let flags = regex.flags.replace(/[gy]/g, '');
          if (!flags.includes('i')) flags += 'i';
          return new RegExp(regex.source, flags).test(command);
        };
        if (plugin.command instanceof RegExp) return matchesCommandRegex(plugin.command);
        if (Array.isArray(plugin.command)) return plugin.command.some(value =>
          value instanceof RegExp ? matchesCommandRegex(value) : String(value).toLowerCase() === command
        );
        return String(plugin.command).toLowerCase() === command;
      });
    }
  }

  const isAutoDownloadAttempt = Boolean(global.db.data.chats[m.chat]?.autodl) &&
    /https?:\/\/[^\s]+/i.test(messageText);
  const isBotAttempt = isCommandAttempt || isAutoDownloadAttempt;

  if (isBotAttempt) {
    global._alvarethBanReplyCooldown ||= new Map();
    for (const [key, timestamp] of global._alvarethBanReplyCooldown) {
      if (Date.now() - timestamp > 120_000) global._alvarethBanReplyCooldown.delete(key);
    }
    const cooldownKey = m.chat + ':' + (senderNumbers[0] || m.sender);
    const now = Date.now();
    const lastSent = global._alvarethBanReplyCooldown.get(cooldownKey) || 0;

    // Avoid flooding the group if a blocked spammer repeats the command.
    if (now - lastSent >= 60_000) {
      global._alvarethBanReplyCooldown.set(cooldownKey, now);
      const banText = '🚫 *YAH, AKSES DITOLAK, NGAB!*\n\n' +
        'Nomormu sudah masuk daftar BAN Alvareth Bot. Mau spam terus? Percuma, ' +
        'perintahmu cuma jadi pajangan. Bot ini sudah nggak melayani kamu. 🤡' +
        (phoneBanEntry?.entry?.reason || user?.banReason
          ? '\n\nAlasan: ' + String(phoneBanEntry?.entry?.reason || user?.banReason).slice(0, 180)
          : '');
      await conn.sendMessage(m.chat, { text: banText }, m.key ? { quoted: m } : {})
        .catch(error => console.warn('[USER BAN] Gagal mengirim notifikasi:', error?.message || error));
    }
  }

  console.log('[USER BAN] Pesan diblokir:', senderNumbers[0] || m.sender, '| chat:', m.chat);
  return;
}

for (let name in global.plugins) {
    let plugin = global.plugins[name]
    if (!plugin || plugin.disabled) continue

    let chat = global.db.data.chats[m.chat]

    if (chat?.isBanned) {
        if (!name.endsWith('owner/unbanchat.js')) continue
    }
            
            const __filename = join(___dirname, name)
            if (typeof plugin.all === 'function') {
                try {
                    await plugin.all.call(this, m, { chatUpdate, __dirname: ___dirname, __filename })
                } catch (e) {
                    console.error(e)
                }
            }

            if (opts['restrict']) if (plugin.tags && plugin.tags.includes('admin')) continue

            const str2Regex = str => str.replace(/[|\\{}()[\]^$+*?.]/g, '\\$&')
            let _prefix = plugin.customPrefix ? plugin.customPrefix : conn.prefix ? conn.prefix : global.prefix
            let match = (_prefix instanceof RegExp ? [[_prefix.exec(m.text), _prefix]] :
                Array.isArray(_prefix) ? _prefix.map(p => {
                    let re = p instanceof RegExp ? p : new RegExp(str2Regex(p))
                    return [re.exec(m.text), re]
                }) :
                typeof _prefix === 'string' ? [[new RegExp(str2Regex(_prefix)).exec(m.text), new RegExp(str2Regex(_prefix))]] :
                [[[], new RegExp]]
            ).find(p => p[1])
            if (isMenuDiagnostic && (name === 'main/menu.js' || name.endsWith('/menu.js') || name.endsWith('menu.js'))) {
                console.log('[DIAG menu-prefix]', JSON.stringify({
                    plugin: name,
                    text: m.text,
                    prefixSource: plugin.customPrefix ? 'plugin.customPrefix' : conn.prefix ? 'conn.prefix' : 'global.prefix',
                    prefixType: _prefix instanceof RegExp ? 'RegExp' : Array.isArray(_prefix) ? 'Array' : typeof _prefix,
                    matched: Boolean(match?.[0]?.[0]),
                    matchedText: match?.[0]?.[0] || null
                }))
            }

            if (typeof plugin.before === 'function') {
                if (await plugin.before.call(this, m, {
                    match, conn: this, participants, groupMetadata, user, bot,
                    isROwner, isOwner, isRAdmin, isAdmin, isBotAdmin, isPrems, chatUpdate, __dirname: ___dirname, __filename
                })) continue
            }

            if (typeof plugin !== 'function') continue
            
                    let usedPrefix
        if ((usedPrefix = (match[0] || '')[0])) {
            let noPrefix = m.text.replace(usedPrefix, '')
            let [command, ...args] = noPrefix.trim().split` `.filter(v => v)
        
            args = args || []
            let _args = noPrefix.trim().split` `.slice(1)
            let text = _args.join` `
        
            if (m.mentionedJid?.length && /^@/.test(text)) {
                try {
                    text = await conn.getName(m.mentionedJid[0])
                } catch {}
            }
        
            command = (command || '').toLowerCase()
                let fail = plugin.fail || global.dfail

                let isAccept = plugin.command instanceof RegExp ? plugin.command.test(command) :
                    Array.isArray(plugin.command) ? plugin.command.some(cmd => cmd instanceof RegExp ? cmd.test(command) : cmd === command) :
                    typeof plugin.command === 'string' ? plugin.command === command : false

                if (isMenuDiagnostic && (name === 'main/menu.js' || name.endsWith('/menu.js') || name.endsWith('menu.js'))) {
                    console.log('[DIAG menu-command]', JSON.stringify({
                        plugin: name,
                        command,
                        isAccept,
                        isOwner,
                        isROwner,
                        disabled: Boolean(plugin.disabled)
                    }))
                }
                if (!isAccept) continue
                
                m.plugin = name
                let chat = global.db.data.chats[m.chat]
                
                if (plugin.rpg && m.isGroup && !chat?.rpgs) {
                    m.reply('🎮 Mode RPG di grup ini belum aktif\n\nKetik:\n.enable rpg')
                    continue
                }

                if (chat?.isBanned && !isOwner) return 
                if (user?.banned && !isOwner) return

                if (plugin.rowner && !isROwner) { fail('rowner', m, this); continue }
                if (plugin.owner && !isOwner) { fail('owner', m, this); continue }
                if (plugin.mods && !isMods) { fail('mods', m, this); continue }
                if (plugin.premium && !isPrems) { fail('premium', m, this); continue }
                if (plugin.group && !m.isGroup) { fail('group', m, this); continue }
                if (plugin.botAdmin && !isBotAdmin) { fail('botAdmin', m, this); continue }
                if (plugin.admin && !isAdmin) { fail('admin', m, this); continue }
                if (plugin.private && m.isGroup) { fail('private', m, this); continue }
                if (plugin.register && !user.registered) { fail('unreg', m, this); continue }

                m.isCommand = true
                let xp = 'exp' in plugin ? parseInt(plugin.exp) : 17
                if (xp < 200 && user?.autolevelup) m.exp += xp

                if (!isPrems && plugin.limit && user.limit < plugin.limit * 1) {
                    this.reply(m.chat, `[❗] Limit harian kamu telah habis`, m)
                    continue 
                }
                
                if (plugin.level > user.level) {
                    this.reply(m.chat, `[💬] Diperlukan level ${plugin.level} untuk perintah ini\n*Level mu:* ${user.level} 📊`, m)
                    continue 
                }

                let extra = {
    match, usedPrefix, noPrefix, _args, args, command, text, conn: this,
    participants, groupMetadata, user, bot,
    isROwner, isOwner, isRAdmin, isAdmin,
    isBotAdmin, isPrems,
    senderPN: m.senderPN,
    chatUpdate, __dirname: ___dirname, __filename
                }

                try {
                    await plugin.call(this, m, extra)
                    if (!isPrems && !m.skipLimit) m.limit = m.limit || plugin.limit || false
                } catch (e) {
                    m.error = e
                    console.error(e)
                    if (e) {
                        const errorText = `*Error:* ${format(e)}`
                        if (typeof m.reply === 'function') {
                            await m.reply(errorText).catch?.(sendError => console.error('ERROR REPLY:', sendError))
                        } else if (m.chat && typeof this.sendMessage === 'function') {
                            await this.sendMessage(m.chat, { text: errorText }, m.key ? { quoted: m } : {}).catch(sendError => console.error('ERROR REPLY:', sendError))
                        }
                    }
                } finally {
                    if (typeof plugin.after === 'function') {
                        try {
                            await plugin.after.call(this, m, extra)
                        } catch (e) {
                            console.error(e)
                        }
                    }
                    if (m.limit) {
                        const limitText = +m.limit + ' Limit terpakai'
                        if (typeof m.reply === 'function') await m.reply(limitText).catch(console.error)
                        else if (m.chat && typeof this.sendMessage === 'function') await this.sendMessage(m.chat, { text: limitText }, m.key ? { quoted: m } : {}).catch(console.error)
                    }
                }
                break
            }
        }
    } catch (e) {
        console.error(e)
    } finally {
            if (m.text) {
            const quequeIndex = this.msgqueque.indexOf(m.id || m.key.id)
            if (quequeIndex !== -1) this.msgqueque.splice(quequeIndex, 1)
        }
        
        let user = global.db.data.users[m.sender]
        
        if (user && global.db.data.chats[m.chat]?.autolevelup) {
            user.exp += (m.exp || 0)
        }
        
        if (user && m.limit) user.limit -= (m.limit * 1)
        
        await global.db.write?.()

    try {
        if (!opts['noprint']) await (await import(`./lib/print.js`)).default(m, this)
    } catch (e) {
        console.log(e)
    }
    if (opts['autoread']) await conn.readMessages([m.key])
}
}

export async function participantsUpdate({ id, participants, action }) {
    if (opts['self'] || this.isInit) return
    if (global.db.data == null) await global.loadDatabase()

    const groupAccess = global.db.data.settings?.groupAccess || { enabled: true, allowedGroups: ['120363424686467256@g.us'] }
    if (groupAccess.enabled !== false &&
        !(Array.isArray(groupAccess.allowedGroups) && groupAccess.allowedGroups.includes(id))) return

    let chat = global.db.data.chats[id]
    if (!chat || !chat.welcome) return

    let groupMetadata = await this.groupMetadata(id).catch(() => null)
    if (!groupMetadata || !groupMetadata.subject) {
        groupMetadata = this.chats?.[id] || {}
    }

    let groupName = groupMetadata.subject || groupMetadata.name || id.split('@')[0]
    let memberCount = groupMetadata.participants?.length || 0

    for (let userObj of participants) {
        let user = typeof userObj === 'object'
            ? (userObj.phoneNumber || userObj.id || userObj.lid || '')
            : userObj

        let ids = await this.findUserId(user).catch(() => null)

        let displayName =
            global.nameCache?.[ids?.lid] ||
            global.nameCache?.[user] ||
            global.nameCache?.[ids?.phoneNumber] ||
            this.getName(user) ||
            user.split('@')[0]

        let pp = 'https://i.ibb.co/1s8T3sY/48f7ce63c7aa.jpg'
        try {
            pp = await this.profilePictureUrl(user, 'image')
        } catch {}

        let text = ''

        // ================= WELCOME =================
        if (action === 'add') {
            text = chat.sWelcome?.trim()
                ? chat.sWelcome
                : `👋 Halo ${displayName}!\n\nSelamat datang di *${groupName}* ✨`
        }

        // ================= GOODBYE =================
        if (action === 'remove') {
            text = chat.sBye?.trim()
                ? chat.sBye
                : `✨ Sayonara ${displayName}`
        }

        // ================= PROMOTE =================
        if (action === 'promote') {
            text = (chat.sPromote || this.spromote || '@user Sekarang jadi admin!')
                .replace('@user', displayName)

            await this.sendMessage(id, { text })
            continue
        }

        // ================= DEMOTE =================
        if (action === 'demote') {
            text = (chat.sDemote || this.sdemote || '@user Sekarang bukan lagi admin!')
                .replace('@user', displayName)

            await this.sendMessage(id, { text })
            continue
        }

        text = text
            .replace('@user', displayName)
            .replace('@subject', groupName)
            .replace('@desc', groupMetadata.desc || '')

        try {
            const {
                createWelcomeCanvas,
                createGoodbyeCanvas
            } = await import('./lib/welcomeCanvas.js')

            let buf

            if (action === 'add') {
                buf = await createWelcomeCanvas({
                    groupName,
                    avatarUrl: pp,
                    name: displayName,
                    count: memberCount + 1
                })
            } else if (action === 'remove') {
                buf = await createGoodbyeCanvas({
                    groupName,
                    avatarUrl: pp,
                    name: displayName,
                    count: memberCount
                })
            }

            await this.sendMessage(id, {
                image: buf,
                caption: text
            })
        } catch (e) {
            console.log('WELCOME ERROR:', e)
            await this.sendMessage(id, { text })
        }
    }
}
export async function groupsUpdate(groupsUpdate) {
    if (opts['self']) return
    for (const groupUpdate of groupsUpdate) {
        const id = groupUpdate.id
        if (!id) continue
        const groupAccess = global.db.data.settings?.groupAccess || { enabled: true, allowedGroups: ['120363424686467256@g.us'] }
        if (groupAccess.enabled !== false &&
            !(Array.isArray(groupAccess.allowedGroups) && groupAccess.allowedGroups.includes(id))) continue
        let chats = global.db.data.chats[id], text = ''
        if (!chats?.detect) continue
        if (groupUpdate.desc) text = (chats.sDesc || this.sDesc || 'Deskripsi telah diubah menjadi \n@desc').replace('@desc', groupUpdate.desc)
        if (groupUpdate.subject) text = (chats.sSubject || this.sSubject || 'Judul grup telah diubah menjadi \n@subject').replace('@subject', groupUpdate.subject)
        if (groupUpdate.icon) text = (chats.sIcon || this.sIcon || 'Icon grup telah diubah!')
        if (groupUpdate.revoke) text = (chats.sRevoke || this.sRevoke || 'Link group telah diubah ke \n@revoke').replace('@revoke', groupUpdate.revoke)
        if (groupUpdate.announce == true) text = this.sAnnounceOn || 'Group telah di tutup!\nsekarang hanya admin yang dapat mengirim pesan.'
        if (groupUpdate.announce == false) text = this.sAnnounceOff || 'Group telah di buka!\nsekarang semua peserta dapat mengirim pesan.'
        if (groupUpdate.restrict == true) text = this.sRestrictOn || 'Edit Info Grup di ubah ke hanya admin!'
        if (groupUpdate.restrict == false) text = this.sRestrictOff || 'Edit Info Grup di ubah ke semua peserta!'

        if (!text) continue
        this.reply(id, text.trim())
    }
}

export async function deleteUpdate(message) {
    try {
        const { fromMe, id, participant } = message
        if (fromMe) return
        let msg = this.serializeM(this.loadMessage(id))
        if (!msg || !global.db.data.chats[msg.chat]?.delete) return

        const who = (participant || msg.sender).split('@')[0]
        await this.reply(msg.chat, `Terdeteksi @${who} telah menghapus pesan.`, msg, { mentions: [participant || msg.sender] })
        await this.copyNForward(msg.chat, msg).catch(() => {})
    } catch (e) {
        console.error(e)
    }
}

global.dfail = (type, m, conn) => {
  const msg = {
    rowner: '*`ᴅᴇᴠᴇʟᴏᴘᴇʀ ᴏɴʟʏ • ᴀᴋsᴇs ɪɴɪ ʜᴀɴʏᴀ ᴛᴇʀsᴇᴅɪᴀ ᴜɴᴛᴜᴋ ᴅᴇᴠᴇʟᴏᴘᴇʀ ʙᴏᴛ.`*',
    owner: '*`ᴏᴡɴᴇʀ ᴏɴʟʏ • ᴀᴋsᴇs ɪɴɪ ʜᴀɴʏᴀ ᴛᴇʀsᴇᴅɪᴀ ᴜɴᴛᴜᴋ ᴏᴡɴᴇʀ ʙᴏᴛ.`*',
    mods: '*`ᴍᴏᴅᴇʀᴀᴛᴏʀ ᴏɴʟʏ • ᴀᴋsᴇs ɪɴɪ ʜᴀɴʏᴀ ᴛᴇʀsᴇᴅɪᴀ ᴜɴᴛᴜᴋ ᴍᴏᴅᴇʀᴀᴛᴏʀ ʙᴏᴛ.`*',
    premium: '*`ᴘʀᴇᴍɪᴜᴍ ᴏɴʟʏ • ғɪᴛᴜʀ ɪɴɪ ᴋʜᴜsᴜs ᴜɴᴛᴜᴋ ᴘʀᴇᴍɪᴜᴍ ᴜsᴇʀ.`*',
    group: '*`ɢʀᴏᴜᴘ ᴏɴʟʏ • ᴘᴇʀɪɴᴛᴀʜ ɪɴɪ ʜᴀɴʏᴀ ᴅᴀᴘᴀᴛ ᴅɪɢᴜɴᴀᴋᴀɴ ᴅɪ ᴅᴀʟᴀᴍ ɢʀᴜᴘ.`*',
    private: '*`ᴘʀɪᴠᴀᴛᴇ ᴏɴʟʏ • ᴘᴇʀɪɴᴛᴀʜ ɪɴɪ ʜᴀɴʏᴀ ᴅᴀᴘᴀᴛ ᴅɪɢᴜɴᴀᴋᴀɴ ᴅɪ ᴄʜᴀᴛ ᴘʀɪʙᴀᴅɪ.`*',
    admin: '*`ᴀᴅᴍɪɴ ᴏɴʟʏ • ᴘᴇʀɪɴᴛᴀʜ ɪɴɪ ʜᴀɴʏᴀ ᴅᴀᴘᴀᴛ ᴅɪɢᴜɴᴀᴋᴀɴ ᴏʟᴇʜ ᴀᴅᴍɪɴ ɢʀᴜᴘ.`*',
    botAdmin: '*`ʙᴏᴛ ᴀᴅᴍɪɴ ʀᴇǫᴜɪʀᴇᴅ • ᴊᴀᴅɪᴋᴀɴ ʙᴏᴛ sᴇʙᴀɢᴀɪ ᴀᴅᴍɪɴ ᴛᴇʀʟᴇʙɪʜ ᴅᴀʜᴜʟᴜ.`*',
    unreg: '*`ʀᴇɢɪsᴛʀᴀᴛɪᴏɴ ʀᴇǫᴜɪʀᴇᴅ • sɪʟᴀᴋᴀɴ ᴅᴀғᴛᴀʀ ᴅᴇɴɢᴀɴ ᴘᴇʀɪɴᴛᴀʜ .ᴅᴀғᴛᴀʀ.`*',
    restrict: '*`ʀᴇsᴛʀɪᴄᴛ ᴅɪsᴀʙʟᴇᴅ • ᴍᴏᴅᴇ ʀᴇsᴛʀɪᴄᴛ ʙᴇʟᴜᴍ ᴅɪᴀᴋᴛɪғᴋᴀɴ ᴅɪ ᴄʜᴀᴛ ɪɴɪ.`*'
  }

  if (msg[type]) {
    if (typeof m.reply === 'function') return m.reply(msg[type])
    const chat = m.chat || m.key?.remoteJid
    if (chat && typeof conn?.sendMessage === 'function') return conn.sendMessage(chat, { text: msg[type] }, m.key ? { quoted: m } : {})
  }
}
const handlerFile = global.__filename(import.meta.url, true)

// handler.js is imported with a cache-busting query on reconnect. Share one watcher
// across those module instances so each reconnect does not add another StatWatcher listener.
if (!global.__alvarethHandlerFileWatcher) {
    global.__alvarethHandlerFileWatcher = true
    watchFile(handlerFile, async (current, previous) => {
        if (current.mtimeMs === previous.mtimeMs && current.size === previous.size) return
        console.log(chalk.redBright("Update 'handler.js'"))
        if (global.reloadHandler) {
            try {
                console.log(await global.reloadHandler())
            } catch (error) {
                console.error(chalk.red('Gagal memuat ulang handler:'), error)
            }
        }
    })
}