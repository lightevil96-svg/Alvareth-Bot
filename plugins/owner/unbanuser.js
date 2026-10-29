const normalizePhone = value => String(value || '').replace(/\D/g, '');

let handler = async (m, { conn, text }) => {
  const input = String(text || '').trim();
  const tokens = input.split(/\s+/).filter(Boolean);
  const mention = Array.isArray(m.mentionedJidPN) && m.mentionedJidPN.length
    ? m.mentionedJidPN[0]
    : Array.isArray(m.mentionedJid) && m.mentionedJid.length
      ? m.mentionedJid[0]
      : '';
  const number = normalizePhone(mention || tokens[0]);

  if (number.length < 8 || number.length > 15) {
    throw 'Format: .unbanuser 628xxxxxxxxxx\nContoh: .unbanuser 628123456789';
  }

  const settings = global.db.data.settings || (global.db.data.settings = {});
  const phoneBans = settings.phoneBans || (settings.phoneBans = {});
  const hadNumberBan = Boolean(phoneBans[number]);
  delete phoneBans[number];

  // Also clear the legacy per-user ban flag if the database uses a phone JID.
  let clearedLegacy = false;
  for (const [jid, data] of Object.entries(global.db.data.users || {})) {
    const savedNumber = normalizePhone(String(jid).split('@')[0].split(':')[0]);
    if (savedNumber === number && data && typeof data === 'object') {
      data.banned = false;
      data.banReason = '';
      clearedLegacy = true;
    }
  }

  if (!hadNumberBan && !clearedLegacy) {
    return conn.sendMessage(m.chat, {
      text: 'ℹ️ Nomor ' + number + ' tidak ditemukan dalam daftar ban.'
    }, { quoted: m });
  }

  await global.db.write?.();
  return conn.sendMessage(m.chat, {
    text: '✅ *BAN DICABUT*\n\nNomor: ' + number + '\nAkses bot sudah dibuka kembali.'
  }, { quoted: m });
};

handler.help = ['unbanuser <nomor>'];
handler.tags = ['owner'];
handler.command = /^(unban|unbanuser)$/i;
handler.rowner = true;

export default handler;
