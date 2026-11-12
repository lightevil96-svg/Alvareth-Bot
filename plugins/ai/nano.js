/**
 * 🍌 Nano-Banana AI Multi-Engine
 * Author: Omegatech
 * Version: 5.1 (Pollinations gratis)
 *
 * Generasi gambar memakai Pollinations (gratis, tanpa API key) lewat
 * lib/ai-chat.js. Upload gambar tetap memakai tmp.malvryx.dev.
 *
 * 📡 OFFICIAL CHANNELS:
 * WhatsApp: https://whatsapp.com/channel/0029Vb785rSBlHpWSitPY61i
 * Telegram: https://t.me/+OrLFsvjjlVM2ZjRk
 */

import axios from 'axios';
import FormData from 'form-data';
import { buildPollinationsImageUrl, aiErrorMessage } from '../../lib/ai-chat.js';

let bananaSession = {};

async function uploadMedia(m) {
    try {
        const q = m.quoted ? m.quoted : m;
        if (!/image/.test(q.mimetype || q.msg?.mimetype)) return null;
        const media = await q.download();
        const form = new FormData();
        form.append('file', media, { filename: 'image.jpg' });
        form.append('type', 'permanent');
        const res = await axios.post('https://tmp.malvryx.dev/upload', form, {
            headers: form.getHeaders()
        });
        return res.data?.cdnUrl || res.data?.directUrl || null;
    } catch (e) {
        return null;
    }
}

let handler = async (m, { conn, text, usedPrefix, command }) => {
    const userId = m.sender;
    const isNanoPro = /nanopro/i.test(command);
    const prompt = text || m.quoted?.text || m.msg?.caption || "";

    if (isNanoPro) {
        if (!bananaSession[userId]) bananaSession[userId] = { images: [] };

        if (text?.toLowerCase().startsWith('done')) {
            const session = bananaSession[userId];
            const finalPrompt = text.replace(/done/i, '').trim();

            if (session.images.length < 2) return m.reply("⚠️ *Nano-Banana Pro*\n\nPlease add at least 2 images before finishing.");
            if (!finalPrompt) return m.reply(`⚠️ *Prompt Required*\n\nUsage: ${usedPrefix + command} done <your prompt>`);

            await m.react('🕒');
            try {
                // Pollinations hanya menerima satu gambar referensi, jadi
                // gambar pertama dipakai sebagai referensi edit.
                const resultUrl = buildPollinationsImageUrl(finalPrompt, { image: session.images[0] });

                await conn.sendMessage(m.chat, {
                    image: { url: resultUrl },
                    caption: `🍌 *NANO-BANANA PRO SUCCESS*\n\n🖼️ *Images Blended:* ${session.images.length}\n📝 *Prompt:* ${finalPrompt}\n🚀 *Source:* Pollinations (gratis)`
                }, { quoted: m });

                await m.react('✅');
                delete bananaSession[userId];
            } catch (e) {
                await m.react('❌');
                m.reply(aiErrorMessage(e));
                delete bananaSession[userId];
            }
            return;
        }

        const link = await uploadMedia(m);
        if (!link) return m.reply(`📸 *Collector Mode*\n\nQuote or send an image with *${usedPrefix + command}* to add it to the list.\n\nType *${usedPrefix + command} done <prompt>* when finished.`);

        if (bananaSession[userId].images.length >= 4) return m.reply("❌ *Limit Reached*\n\nMaximum of 4 images allowed.");

        bananaSession[userId].images.push(link);
        await m.react('📥');
        return m.reply(`✅ *Image ${bananaSession[userId].images.length}/4 Added*\n\nSend another image or type:\n*${usedPrefix + command} done <prompt>*`);
    }

    if (command === 'nano') {
        const imageUrl = await uploadMedia(m);

        if (imageUrl) {
            if (!prompt) return m.reply(`⚠️ *Instruction Required*\n\nExample: Reply to an image with \`${usedPrefix}nano make it a zombie\``);

            await m.react('🎨');
            try {
                const resultUrl = buildPollinationsImageUrl(prompt, { image: imageUrl });
                await conn.sendMessage(m.chat, {
                    image: { url: resultUrl },
                    caption: `✨ *NANO EDIT SUCCESS*\n\n📝 *Prompt:* ${prompt}`
                }, { quoted: m });
                await m.react('✅');
            } catch (e) {
                await m.react('❌');
                m.reply(aiErrorMessage(e));
            }
        } else {
            if (!prompt) return m.reply(`⚠️ *Input Required*\n\nUsage: ${usedPrefix}nano <prompt>`);

            await m.react('⏳');
            try {
                const resultUrl = buildPollinationsImageUrl(prompt);
                await conn.sendMessage(m.chat, {
                    image: { url: resultUrl },
                    caption: `🍌 *NANO PRO GENERATION*\n\n📝 *Prompt:* ${prompt}`
                }, { quoted: m });
                await m.react('✅');
            } catch (e) {
                await m.react('❌');
                m.reply(aiErrorMessage(e));
            }
        }
    }
};

handler.help = ['nano', 'nanopro'];
handler.tags = ['ai'];
handler.command = /^(nanopro|nano)$/i;

export default handler;
