import { askFreeAi, aiErrorMessage } from '../../lib/ai-chat.js'

let handler = async (m, { args }) => {
  let query = args.join(' ')

  if (!query) return m.reply('Mau Tanya Apa\n\nContoh: .perplexity apa itu AI?')

  try {
    m.reply(await askFreeAi(query))
  } catch (e) {
    console.error(e)
    m.reply(aiErrorMessage(e))
  }
}

handler.help = ['perplexity']

handler.command = ['perplexity', 'plx']

handler.tags = ['ai']

export default handler
