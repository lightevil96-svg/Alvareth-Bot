// Auto-download router: detect the platform from a shared URL, then route the
// message through that platform's existing downloader command so each service
// keeps its own resolver, validation, captions, and media handling.

const ROUTES = [
  { command: 'tt', label: 'TikTok', domains: ['tiktok.com'] },
  { command: 'fb', label: 'Facebook', domains: ['facebook.com', 'fb.watch', 'fb.com', 'fb.me'] },
  { command: 'igdl', label: 'Instagram', domains: ['instagram.com', 'instagr.am'] },
  { command: 'ytmp4', label: 'YouTube', domains: ['youtube.com', 'youtu.be', 'youtube-nocookie.com', 'youtubeeducation.com'] },
  { command: 'tw', label: 'X/Twitter', domains: ['x.com', 'twitter.com'] },
  { command: 'capcut', label: 'CapCut', domains: ['capcut.com'] },
  { command: 'pindl', label: 'Pinterest', domains: ['pinterest.com', 'pin.it'] },
  { command: 'videy', label: 'Videy', domains: ['videy.co'] },
  { command: 'mf', label: 'MediaFire', domains: ['mediafire.com'] },
  { command: 'gdrive', label: 'Google Drive', domains: ['drive.google.com', 'docs.google.com'] },
  { command: 'douyin', label: 'Douyin', domains: ['douyin.com'] },
  { command: 'bili', label: 'Bilibili', domains: ['bilibili.com', 'bilibili.tv'] },
  { command: 'scdl', label: 'SoundCloud', domains: ['soundcloud.com'] },
  { command: 'spotify', label: 'Spotify', domains: ['spotify.com', 'spotify.link'] },
  { command: 'applemp3', label: 'Apple Music', domains: ['music.apple.com'] },
  // Use the existing all-in-one provider for popular services without a
  // dedicated downloader plugin in this repository.
  {
    command: 'aio',
    label: 'All-in-One',
    domains: [
      'threads.net', 'threads.com', 'reddit.com', 'redd.it', 'vimeo.com', 'dailymotion.com',
      'twitch.tv', 'snapchat.com', 'likee.video', 'kwai.com', 'snackvideo.com',
      'streamable.com', 'loom.com'
    ]
  }
];

const RECENT_TTL_MS = 2 * 60 * 1000;
const MAX_RECENT_MESSAGES = 500;
const recentMessages = new Map();

function getMessageText(m) {
  const message = m?.message || {};
  return String(
    m?.text ||
    m?.caption ||
    message.conversation ||
    message.extendedTextMessage?.text ||
    message.imageMessage?.caption ||
    message.videoMessage?.caption ||
    message.documentMessage?.caption ||
    ''
  ).trim();
}

function extractUrls(input) {
  const candidates = String(input || '').match(/https?:\/\/[^\s<>"']+/gi) || [];
  const urls = [];
  for (const raw of candidates) {
    const clean = raw.replace(/[),\].!?;:]+$/g, '');
    try {
      const url = new URL(clean);
      if (url.protocol !== 'http:' && url.protocol !== 'https:') continue;
      urls.push(url);
    } catch {
      // Ignore malformed link and inspect the next URL.
    }
  }
  return urls;
}

function resolveRoute(url) {
  const host = url.hostname.toLowerCase().replace(/^www\./, '');
  return ROUTES.find(route =>
    route.domains.some(domain => host === domain || host.endsWith('.' + domain))
  ) || null;
}

// The normal handler dispatcher requires the configured prefix. Extract the
// first literal prefix from the common setprefix-generated RegExp; /^/ means
// the owner intentionally enabled no-prefix mode.
function getCommandPrefix(conn) {
  const configured = conn?.prefix ?? global.prefix;
  if (typeof configured === 'string') return configured;
  if (Array.isArray(configured)) {
    const literal = configured.find(value => typeof value === 'string' && value.length);
    if (literal) return literal;
    const regex = configured.find(value => value instanceof RegExp);
    if (regex) return getPrefixFromRegex(regex);
  }
  if (configured instanceof RegExp) return getPrefixFromRegex(configured);
  return '.';
}

function getPrefixFromRegex(regex) {
  const source = regex.source;
  if (source === '^' || source === '(?:)' || source === '') return '';
  const grouped = source.match(/^\^\((.*)\)$/);
  if (grouped) {
    // setprefix creates an escaped list such as ^(\\.|!|#). The first option
    // is enough because any configured prefix is accepted by the dispatcher.
    const first = grouped[1].split('|')[0];
    return first.replace(/\\(.)/g, '$1');
  }

  // The startup CLI uses a character class such as ^[.!#]. Prefer a familiar
  // dot prefix when allowed; otherwise use the first actual configured char.
  const characterClass = source.match(/^\^\[([\s\S]*)\]$/);
  if (characterClass) {
    const chars = characterClass[1];
    if (chars.includes('\\.')) return '.';
    const escapedFirst = chars.match(/^\\(.)/);
    if (escapedFirst) return escapedFirst[1];
    return Array.from(chars)[0] || '.';
  }

  const literal = source.match(/^\^((?:\\.|[A-Za-z0-9_-])+)/);
  return literal ? literal[1].replace(/\\(.)/g, '$1') : '.';
}

function claimMessage(m) {
  const id = String(m?.key?.id || m?.id || '').trim();
  const chat = String(m?.chat || m?.key?.remoteJid || '').trim();
  if (!id || !chat) return true;

  const now = Date.now();
  for (const [key, expiresAt] of recentMessages) {
    if (expiresAt <= now) recentMessages.delete(key);
  }

  const key = chat + ':' + id;
  if (recentMessages.has(key)) return false;
  recentMessages.set(key, now + RECENT_TTL_MS);
  while (recentMessages.size > MAX_RECENT_MESSAGES) {
    const oldestKey = recentMessages.keys().next().value;
    if (oldestKey === undefined) break;
    recentMessages.delete(oldestKey);
  }
  return true;
}

const handler = {};
handler.before = async (m, { conn }) => {
  try {
    if (!m || !m.chat || m.chat === 'status@broadcast') return false;

    const originalText = getMessageText(m);
    if (!originalText || /^[.#!\/]/.test(originalText)) return false;

    const chats = global.db?.data?.chats;
    if (!chats) return false;
    const chat = chats[m.chat];
    const links = extractUrls(originalText);
    if (!links.length) return false;

    let selected = null;
    for (const url of links) {
      const route = resolveRoute(url);
      if (route) {
        selected = { route, url: url.toString() };
        break;
      }
    }
    if (!selected) return false;
    // The bot owner often pastes a link from the linked WhatsApp account itself,
    // so that message is marked fromMe. Only auto-route an exact TikTok URL in
    // that case; never route arbitrary bot-generated text/captions.
    const isPlainTikTokLink = /^https?:\/\/(?:[a-z0-9-]+\.)*tiktok\.com\/[^\s]+$/i.test(originalText.replace(/[),\].!?;:]+$/g, ''));
    if (m.fromMe && !(selected.route.command === 'tt' && isPlainTikTokLink)) return false;
    // TikTok links are routed automatically even when AutoDL is off; other platforms keep their opt-in.
    if (!chat?.autodl && selected.route.command !== 'tt') return false;
    if (!claimMessage(m)) return true;

    const prefix = getCommandPrefix(conn);
    const safeUrl = selected.url;
    // The existing command pipeline performs its normal permission checks,
    // per-user limits, and execution. Only the text is rewritten; URL parameters
    // are preserved and unrelated message text is intentionally omitted.
    m.autoDownloadRoute = selected.route.label;
    m.autoDownloadOriginalText = originalText;
    m.text = prefix + selected.route.command + ' ' + safeUrl;
    console.log('[AutoDL Router] ' + selected.route.label + ' -> ' + selected.route.command + ' | ' + m.chat);
    return true;
  } catch (error) {
    console.error('[AutoDL Router] Error:', error?.stack || error);
    return false;
  }
};

export default handler;
