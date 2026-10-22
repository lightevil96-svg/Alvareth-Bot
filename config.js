import 'dotenv/config'
import { watchFile, unwatchFile } from 'fs'
import chalk from 'chalk'
import { fileURLToPath } from 'url'
import moment from 'moment-timezone'

/*============= WAKTU =============*/
let wibh = moment.tz('Asia/Jakarta').format('HH')
let wibm = moment.tz('Asia/Jakarta').format('mm')
let wibs = moment.tz('Asia/Jakarta').format('ss')
let wktuwib = `${wibh} H ${wibm} M ${wibs} S`
let wktugeneral = `${wibh}:${wibm}:${wibs}`

let d = new Date(new Date + 3600000)
let locale = 'id'
let weton = ['Pahing', 'Pon', 'Wage', 'Kliwon', 'Legi'][Math.floor(d / 84600000) % 5]
let week = d.toLocaleDateString(locale, { weekday: 'long' })
let date = d.toLocaleDateString(locale, {
    day: 'numeric',
    month: 'long',
    year: 'numeric'
})
const more = String.fromCharCode(8206)
const readMore = more.repeat(4001)

/*============= MAIN INFO =============*/
// Isi BOT_NUMBER dan OWNER_NUMBER di file .env sebelum menjalankan bot.
const botNumber = String(process.env.BOT_NUMBER || '').replace(/\D/g, '')
const ownerNumber = String(process.env.OWNER_NUMBER || '').replace(/\D/g, '')
const ownerName = process.env.OWNER_NAME || 'Light V'
const botName = 'Alvareth Bot'

global.pairing = botNumber
global.owner = [[ownerNumber, ownerName, true]]
global.mods = []
global.prems = []
global.nomorbot = botNumber
global.nomorown = ownerNumber
global.nameown = ownerName
global.version = '1.0.0'
global.autotyping = false
global.autorecording = false
global.repository = process.env.REPOSITORY_URL || 'https://github.com/lightevil96-svg/Alvareth-Bot'

// ===== LINK PREVIEW DEFAULT =====
// Gunakan satu identitas untuk preview balasan bot, bukan metadata Ryo dari SC asal.
global.botLink = 'https://spoo.me/Alvareth-Bot'
global.adReply = {
    contextInfo: {
        externalAdReply: {
            title: 'Alvareth Bot',
            body: 'WhatsApp Bot',
            thumbnailUrl: 'https://raw.githubusercontent.com/lightevil96-svg/Alvareth-Bot/main/media/thumbnail.jpg',
            sourceUrl: global.botLink,
            mediaType: 1,
            renderLargerThumbnail: true
        }
    }
}

/*============= WATERMARK =============*/
global.readMore = readMore
global.author = ownerName
global.namebot = botName
global.wm = botName
global.watermark = global.wm
global.botdate = `⫹⫺ DATE: ${week} ${date}\n⫹⫺ 𝗧𝗶𝗺𝗲: ${wktuwib}`
global.bottime = `T I M E : ${wktuwib}`
global.stickpack = `${botName} ✦\nPowered by ${ownerName}${botNumber ? `\nwa.me/${botNumber}` : ''}`
global.stickauth = `ʙy ${ownerName}`
global.week = `${week} ${date}`
global.wibb = `${wktuwib}`


// ================= Cpanel ========================================
global.egg = "15" // gausah di ubah

global.nestid = "5" // gausah diubah

global.loc = "1" // gausah diubah

global.domain = "-" // ini ubah ama domain / web panel lu

global.apikey = "-" // apikey / plta lu

global.capikey = "-" // capikey / pltc lu

/*============= CHANNEL =============*/
global.linkch = process.env.WHATSAPP_CHANNEL_URL || ''
global.chId = process.env.WHATSAPP_CHANNEL_ID || ''
global.newsletterName = 'Alvareth Bot' 

/*============= TAMPILAN =============*/

global.dashmenu = '୨୧ STATISTICS ୨୧'

global.dmenut = '୨୧ '
global.dmenub = '┊ '
global.dmenub2 = '┊ '
global.dmenuf = '୨୧'

global.cmenut = '୨୧ '
global.cmenuh = ''
global.cmenub = '┊ ✿ '
global.cmenuf = '୨୧\n'
global.cmenua = '\n'

global.pmenus = '❏'

global.htki = '୨୧'
global.htka = '୨୧'

global.lopr = 'Ⓟ'
global.lolm = 'Ⓛ'

global.htjava = '♡'

global.hsquere = ['❀', '✿', '♡']

/*============= RESPON =============*/
global.wait = '✨ Please Wait...'
global.eror = 'Error!'

global.APIs = {
    faa: 'https://api-faa.my.id',
    deline: 'https://api.deline.web.id',
    nexray: 'https://api.nexray.eu.cc',
    theresav: 'https://api.blckrose.my.id',
    kyzzz: 'https://api.kyzzz.eu.cc'
    
}

global.APIKeys = {
    'https://api.blckrose.my.id': 'ISI_APIKEY', // isi apikey 
    'https://api.kyzzz.eu.cc': process.env.KYZZ_API_KEY || 'ISI_APIKEY'  // isi apikey 
}

global.flaaa2 = [
    "https://flamingtext.com/net-fu/proxy_form.cgi?&imageoutput=true&script=water-logo&script=water-logo&fontsize=90&doScale=true&scaleWidth=800&scaleHeight=500&fontsize=100&fillTextColor=%23000&shadowGlowColor=%23000&backgroundColor=%23000&text=",
    "https://flamingtext.com/net-fu/proxy_form.cgi?&imageoutput=true&script=crafts-logo&fontsize=90&doScale=true&scaleWidth=800&scaleHeight=500&text=",
    "https://flamingtext.com/net-fu/proxy_form.cgi?&imageoutput=true&script=amped-logo&doScale=true&scaleWidth=800&scaleHeight=500&text=",
    "https://www6.flamingtext.com/net-fu/proxy_form.cgi?&imageoutput=true&script=sketch-name&doScale=true&scaleWidth=800&scaleHeight=500&fontsize=100&fillTextType=1&fillTextPattern=Warning!&text=",
    "https://www6.flamingtext.com/net-fu/proxy_form.cgi?&imageoutput=true&script=sketch-name&doScale=true&scaleWidth=800&scaleHeight=500&fontsize=100&fillTextType=1&fillTextPattern=Warning!&fillColor1Color=%23f2aa4c&fillColor2Color=%23f2aa4c&fillColor3Color=%23f2aa4c&fillColor4Color=%23f2aa4c&fillColor5Color=%23f2aa4c&fillColor6Color=%23f2aa4c&fillColor7Color=%23f2aa4c&fillColor8Color=%23f2aa4c&fillColor9Color=%23f2aa4c&fillColor10Color=%23f2aa4c&fillOutlineColor=%23f2aa4c&fillOutline2Color=%23f2aa4c&backgroundColor=%23101820&text="
]
global.fla = [
    "https://flamingtext.com/net-fu/proxy_form.cgi?&imageoutput=true&script=water-logo&script=water-logo&fontsize=90&doScale=true&scaleWidth=800&scaleHeight=500&fontsize=100&fillTextColor=%23000&shadowGlowColor=%23000&backgroundColor=%23000&text=",
    "https://flamingtext.com/net-fu/proxy_form.cgi?&imageoutput=true&script=crafts-logo&fontsize=90&doScale=true&scaleWidth=800&scaleHeight=500&text=",
    "https://flamingtext.com/net-fu/proxy_form.cgi?&imageoutput=true&script=amped-logo&doScale=true&scaleWidth=800&scaleHeight=500&text=",
    "https://www6.flamingtext.com/net-fu/proxy_form.cgi?&imageoutput=true&script=sketch-name&doScale=true&scaleWidth=800&scaleHeight=500&fontsize=100&fillTextType=1&fillTextPattern=Warning!&text=",
    "https://www6.flamingtext.com/net-fu/proxy_form.cgi?&imageoutput=true&script=sketch-name&doScale=true&scaleWidth=800&scaleHeight=500&fontsize=100&fillTextType=1&fillTextPattern=Warning!&fillColor1Color=%23f2aa4c&fillColor2Color=%23f2aa4c&fillColor3Color=%23f2aa4c&fillColor4Color=%23f2aa4c&fillColor5Color=%23f2aa4c&fillColor6Color=%23f2aa4c&fillColor7Color=%23f2aa4c&fillColor8Color=%23f2aa4c&fillColor9Color=%23f2aa4c&fillColor10Color=%23f2aa4c&fillOutlineColor=%23f2aa4c&fillOutline2Color=%23f2aa4c&backgroundColor=%23101820&text="
]
/*============== EMOJI ==============*/
global.rpg = {
	emoticon(string) {
		string = string.toLowerCase()
		let emot = {
			level: '🧬',
			limit: '🌌',
			health: '❤️',
			exp: '✉️',
			money: '💵',
			potion: '🥤',
			diamond: '💎',
			common: '📦',
			uncommon: '🎁',
			mythic: '🗳️',
			legendary: '🗃️',
			pet: '🎁',
			trash: '🗑',
			armor: '🥼',
			sword: '⚔️',
			pickaxe: '⛏️',
			fishingrod: '🎣',
			bow: '🏹',
			wood: '🪵',
			rock: '🪨',
			string: '🕸️',
			horse: '🐎',
			cat: '🐈',
			dog: '🐕',
			fox: '🦊',
			wolf: '🐺',
			centaur: '🐎',
			phoenix: '🦜',
			dragon: '🐉',
			petfood: '🍖',
			iron: '⛓️',
			gold: '👑',
			emerald: '💚',
			bibitmangga: '🌾',
			bibitanggur: '🌾',
			bibitjeruk: '🌾',
			bibitpisang: '🌾',
			bibitapel: '🌾',
			mangga: '🥭',
			anggur: '🍇',
			jeruk: '🍊',
			pisang: '🍌',
			apel: '🍎',
			ayam: '🐔',
			kambing: '🐐',
			sapi: '🐄',
			kerbau: '🐃',
			babi: '🐖',
			harimau: '🐅',
			banteng: '🐂',
			monyet: '🐒',
			babihutan: '🐗',
			panda: '🐼',
			gajah: '🐘',
			buaya: '🐊',
			orca: '🐋',
			paus: '🐳',
			lumba: '🐬',
			hiu: '🦈',
			ikan: '🐟',
			lele: '🐟',
			bawal: '🐡',
			nila: '🐠',
			kepiting: '🦀',
			lobster: '🦞',
			gurita: '🐙',
			cumi: '🦑',
			udang: '🦐',
			steak: '🍝',
			sate: '🍢',
			rendang: '🍜',
			kornet: '🥣',
			nugget: '🍱',
			bluefin: '🍲',
			seafood: '🍛',
			sushi: '🍣',
			moluska: '🥘',
			squidprawm: '🍤',
			rumahsakit: '🏥',
			restoran: '🏭',
			pabrik: '🏯',
			tambang: '⚒️',
			pelabuhan: '🛳️'
		}
		let results = Object.keys(emot).map(v => [v, new RegExp(v, 'gi')]).filter(v => v[1].test(string))
		if (!results.length) return ''
		else return emot[results[0][0]]
	}
}

let file = fileURLToPath(import.meta.url)
watchFile(file, () => {
    unwatchFile(file)
    console.log(chalk.redBright("Update 'config.js'"))
    import(`${file}?update=${Date.now()}`)
})
