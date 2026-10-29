const normalizePhone = value => String(value || '').replace(/\D/g, '');

let handler = async (m, { conn, text }) => {
  const input = String(text || '').trim();
  if (!input) {
    throw 'Format: .banuser 628xxxxxxxxxx alasan\nContoh: .banuser 628123456789 spam bot';
  }

  const tokens = input.split(/\s+/);
  const mention = Array.isArray(m.mentionedJidPN) && m.mentionedJidPN.length
    ? m.mentionedJidPN[0]
    : Array.isArray(m.mentionedJid) && m.mentionedJid.length
      ? m.mentionedJid[0]
      : '';
  const number = normalizePhone(mention || tokens[0]);
  const reason = (mention ? tokens : tokens.slice(1)).join(' ').trim().slice(0, 300);

  if (number.length < 8 || number.length > 15) {
    throw 'Nomor tidak valid. Gunakan kode negara, contoh: .banuser 628123456789 spam bot';
  }

  const settings = global.db.data.settings || (global.db.data.settings = {});
  const phoneBans = settings.phoneBans || (settings.phoneBans = {});
  const users = global.db.data.users || {};
  const now = Date.now();

  phoneBans[number] = {
    number,
    reason,
    bannedAt: now,
    bannedBy: normalizePhone(m.senderPN || m.sender),
    source: 'owner-command'
  };

  // Preserve the old per-user flag when a matching phone-number JID exists.
  for (const [jid, data] of Object.entries(users)) {
    const savedNumber = normalizePhone(String(jid).split('@')[0].split(':')[0]);
    if (savedNumber === number && data && typeof data === 'object') {
      data.banned = true;
      data.banReason = reason;
    }
  }

  await global.db.write?.();
  await conn.sendMessage(m.chat, {
    text: '⛔ *NOMOR BERHASIL DI-BAN*\\n\\n' +
      '📵 Nomor: ' + number + '\\n' +
      '🔒 Akses bot: DITOLAK\\n' +
      '📝 Alasan: ' + (reason || 'Tidak dicantumkan') + '\\n\\n' +
      'Jika nomor ini mencoba menggunakan perintah atau AutoDL, bot akan menolak aksesnya.'
  }, { quoted: m });
};

handler.help = ['banuser <nomor> <alasan>'];
handler.tags = ['owner'];
handler.command = /^(ban|banuser)$/i;
handler.rowner = true;

export default handler;
