// Map supported public post/file links to the existing downloader plugins.
// Unknown hosts and multi-link messages are ignored. No link previews are injected.
function isPlatformHost(host, base) { return host === base || host.endsWith('.' + base) }
export function resolveAutoDownload(text) {
  const source=String(text||'').trim();
  if(!source||source.length>10000||/^[.!/#?$%+-][a-z][\w-]*(?:\s|$)/i.test(source))return null;
  const matches=source.match(/https?:\/\/[^\s<>"'`]+/gi)||[];
  if(matches.length!==1)return null;
  const urlText=matches[0].replace(/[)\]},;.!?:]+$/g,'');
  let parsed;try{parsed=new URL(urlText)}catch{return null}
  if(!['http:','https:'].includes(parsed.protocol)||parsed.username||parsed.password||
    (parsed.port&&!['80','443'].includes(parsed.port)))return null;
  parsed.protocol='https:';
  const host=parsed.hostname.toLowerCase(),path=parsed.pathname,url=parsed.toString();
  const route=(platform,plugin,command,input=url)=>({platform,plugin:'downloader/'+plugin+'.js',command,input});
  if(isPlatformHost(host,'tiktok.com')&&(/^(vt|vm)\.tiktok\.com$/.test(host)||/^\/(@[^/]+\/(video|photo)\/|t\/|video\/|photo\/|v\/)/i.test(path)))return route('TikTok','tiktok','tt');
  if((isPlatformHost(host,'instagram.com')||host==='instagr.am')&&/^\/(p|reel|reels|tv|stories)\//i.test(path))return route('Instagram','ig','ig');
  if((host==='fb.watch'||isPlatformHost(host,'facebook.com')||host==='fb.com')&&
    (host==='fb.watch'||/(?:^|\/)(?:videos|reel|reels|posts|watch|share|story\.php|permalink\.php)(?:\/|$)/i.test(path)||parsed.searchParams.has('v')))
    return route('Facebook','facebook','fb');
  if((isPlatformHost(host,'x.com')||isPlatformHost(host,'twitter.com'))&&/^\/[^/]+\/status\/\d+/i.test(path))return route('X/Twitter','twitter','twitter');
  if(host==='youtu.be'||isPlatformHost(host,'youtube.com')){
    const video=host==='youtu.be'?/^\/[^/]+/.test(path):
      (/^\/(shorts|live|embed|v)\/[^/]+/i.test(path)||(/^\/watch\/?$/i.test(path)&&!!parsed.searchParams.get('v')));
    if(video)return host==='music.youtube.com'?route('YouTube Music','ytmp3','ytmp3',url+'|320'):route('YouTube','ytmp4','ytmp4',url+'|720');
  }
  if((host==='pin.it'||isPlatformHost(host,'pinterest.com'))&&(host==='pin.it'||/^\/pin\/\d+/i.test(path)))return route('Pinterest','pindl','pindl');
  if(host==='open.spotify.com'&&/^\/track\/[a-zA-Z0-9]+(?:\/|$)/.test(path))return route('Spotify','spotify','spotify');
  if(host==='on.soundcloud.com'||isPlatformHost(host,'soundcloud.com')){
    const parts=path.split('/').filter(Boolean);
    if(host==='on.soundcloud.com'||(parts.length>=2&&!['discover','stream','you','search','charts','sets'].includes(parts[0].toLowerCase())&&parts[1]!=='sets'))
      return route('SoundCloud','soundcloud','scdl');
  }
  if(isPlatformHost(host,'capcut.com')&&/^\/(t|tv2|template-detail)\//i.test(path))return route('CapCut','capcut','capcut');
  if(isPlatformHost(host,'mediafire.com')&&(/^\/file\/[^/]+/i.test(path)||!!parsed.search||parsed.searchParams.has('file')))return route('MediaFire','mediafire','mediafire');
  if((host==='sfile.co'||host==='www.sfile.co')&&path!=='/'&&path.length>1)return route('Sfile','sfile','sfiledl');
  if(host==='github.com'){
    const segments=path.split('/').filter(Boolean);
    if(segments.length===2&&segments.every(s=>/^[\w.-]+$/.test(s))){
      const [owner,rawRepo]=segments,repository=rawRepo.replace(/\.git$/i,'');
      if(!(owner.toLowerCase()==='lightevil96-svg'&&repository.toLowerCase()==='alvareth-bot'))
        return route('GitHub','gitclone','gitclone','https://github.com/'+owner+'/'+repository);
    }
  }
  return null;
}
export function findAutoDownloadPrefix(configured) {
  if(Array.isArray(configured)){
    for(const item of configured){const p=findAutoDownloadPrefix(item);if(p!==null)return p}
    return null;
  }
  if(typeof configured==='string')return configured.length?configured:null;
  if(!(configured instanceof RegExp))return null;
  const pattern=new RegExp(configured.source,configured.flags.replace(/[gy]/g,''));
  for(const p of ['.','!','/','#','?','-','+','x','X']){
    const match=pattern.exec(p+'ytmp4');
    if(match&&match.index===0&&match[0]===p)return p;
  }
  return null;
}

const recentMessageIds = new Map()
const RECENT_TTL_MS = 5 * 60 * 1000
export function claimAutoDownloadMessage(m) {
  const id = String(m?.key?.id || m?.id || '').trim()
  if (!id) return true
  const key = String(m?.chat || '') + '|' + String(m?.sender || '') + '|' + id
  const now = Date.now()
  for (const [oldKey, at] of recentMessageIds) {
    if (now - at > RECENT_TTL_MS) recentMessageIds.delete(oldKey)
  }
  if (recentMessageIds.has(key)) return false
  recentMessageIds.set(key, now)
  while (recentMessageIds.size > 500) recentMessageIds.delete(recentMessageIds.keys().next().value)
  return true
}

// Limit large downloads to two parallel jobs with a bounded, timed queue.
const MAX_ACTIVE = 2
const MAX_QUEUED = 8
const MAX_WAIT_MS = 3 * 60 * 1000
let active = 0
const queue = []
export async function runAutoDownloadJob(task) {
  if (typeof task !== 'function') throw new TypeError('AutoDL requires a job function')
  if (active >= MAX_ACTIVE) {
    if (queue.length >= MAX_QUEUED) throw new Error('Antrean downloader otomatis penuh. Coba lagi nanti.')
    await new Promise((resolve, reject) => {
      const ticket = { resolve: null }
      const timer = setTimeout(() => {
        const index = queue.indexOf(ticket)
        if (index !== -1) queue.splice(index, 1)
        reject(new Error('Antrean downloader otomatis terlalu lama. Coba lagi nanti.'))
      }, MAX_WAIT_MS)
      ticket.resolve = () => { clearTimeout(timer); resolve() }
      queue.push(ticket)
    })
  } else {
    active += 1
  }
  try { return await task() }
  finally {
    if (queue.length) queue.shift().resolve()
    else active -= 1
  }
}


// A link typed by the owner on the linked WhatsApp account is also fromMe.
// Accept only standalone plain-text link messages, not media captions, quotes,
// bot output, or arbitrary explanatory text with URLs.
export function isStandaloneOwnLinkMessage(message) {
  const text = String(message?.text || '').trim()
  if (!/^https?:\/\/[^\s<>"'\x60]+$/i.test(text)) return false

  const raw = message?.rawMessage?.message || message?.message || {}
  if (typeof raw.conversation === 'string') {
    return raw.conversation.trim() === text
  }
  const extended = raw.extendedTextMessage
  if (typeof extended?.text === 'string' && !extended.contextInfo?.quotedMessage) {
    return extended.text.trim() === text
  }
  return false
}

// Track messages generated by the bot to distinguish them from a URL pasted
// by the owner on the same WhatsApp account. Keys are IDs, not message bodies,
// so user URLs do not need to be retained or logged.
const botSentIds = new Map()
const BOT_SENT_TTL_MS = 10 * 60 * 1000
const BOT_SENT_MAX = 2000
function botSentMessageKey(message) {
  const id = String(message?.key?.id || message?.id || '').trim()
  const jid = String(message?.key?.remoteJid || message?.chat || '').trim()
  return id ? jid + '|' + id : ''
}
function pruneBotSentIds(now) {
  for (const [key, at] of botSentIds) {
    if (now - at > BOT_SENT_TTL_MS) botSentIds.delete(key)
  }
  while (botSentIds.size > BOT_SENT_MAX) {
    botSentIds.delete(botSentIds.keys().next().value)
  }
}
export function markBotSentMessage(message) {
  const key = botSentMessageKey(message)
  if (!key) return
  const now = Date.now()
  botSentIds.set(key, now)
  pruneBotSentIds(now)
}
export function wasBotSentMessage(message) {
  const key = botSentMessageKey(message)
  if (!key) return false
  const at = botSentIds.get(key)
  if (at === undefined) return false
  if (Date.now() - at > BOT_SENT_TTL_MS) {
    botSentIds.delete(key)
    return false
  }
  return true
}
