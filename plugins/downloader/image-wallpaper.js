import { wallpaper } from "../../lib/scrape.js";

let handler = async (m, { conn, command, text, usedPrefix }) => {
    let query = text
    if (!query) throw `Input *URL*`;
    await m.reply(wait);
    try {
        let wallpapers = await wallpaper(query);
        if (!Array.isArray(wallpapers) || wallpapers.length === 0) throw new Error('Wallpaper tidak ditemukan.');
        let randomWallpaper = wallpapers[Math.floor(Math.random() * wallpapers.length)];
        let cap = "Source: wallpaperflare.com";
        const sent = await conn.sendMessage(m.chat, { image: { url: randomWallpaper }, caption: cap }, { quoted: m, noAlvarethPreview: true });
        if (!sent?.key?.id) throw new Error('WhatsApp tidak mengembalikan ID pesan wallpaper.');
    } catch (e) {
        console.log(e);
        m.reply(`Error`);
    }
};

handler.help = ['wallpaper' + ' <query>']
handler.tags = ['downloader']
handler.command = /^wallpaper$/i

export default handler

