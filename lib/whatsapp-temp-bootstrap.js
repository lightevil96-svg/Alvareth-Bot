import { configureWhatsAppTempDir } from './whatsapp-temp-dir.js'

// This side-effect module must be imported before Baileys in main.js.
configureWhatsAppTempDir()
