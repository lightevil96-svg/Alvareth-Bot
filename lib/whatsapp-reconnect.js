import {
  getWhatsAppWebSocketState,
  isWhatsAppLoginPending,
  isWhatsAppRestartRequired,
  isWhatsAppSocketOpen
} from './whatsapp-connection.js'

/** Coordinate media watchdogs and Baileys close events without retry storms. */
export function createWhatsAppReconnectController({
  getSocket,
  reconnect,
  logger = console,
  maxAttempts = 8,
  handshakeTimeoutMs = 30_000,
  setTimer = setTimeout,
  clearTimer = clearTimeout
}) {
  let reconnectTimer = null
  let handshakeTimer = null
  let attempts = 0
  let inProgress = false
  let queued = null
  let blocked = false
  let authWarningShown = false

  function clearHandshake() {
    if (handshakeTimer !== null) clearTimer(handshakeTimer)
    handshakeTimer = null
  }

  function reset() {
    clearHandshake()
    if (reconnectTimer !== null) clearTimer(reconnectTimer)
    reconnectTimer = null
    queued = null
    attempts = 0
    blocked = false
    authWarningShown = false
  }

  function schedule(statusCode, reason = '') {
    if (isWhatsAppSocketOpen(getSocket())) {
      reset()
      return false
    }
    if (blocked || reconnectTimer !== null) return true
    if (inProgress) {
      queued = { statusCode, reason }
      return true
    }
    clearHandshake()
    if (attempts >= maxAttempts) {
      blocked = true
      queued = null
      logger.error(`❌ Reconnect otomatis dihentikan setelah ${maxAttempts} percobaan gagal. Periksa koneksi, sesi, dan login WhatsApp, lalu restart bot. Hasil render yang tersimpan tetap dipertahankan.`)
      return true
    }

    const baseDelay = isWhatsAppRestartRequired(statusCode) ? 1000 : statusCode === 405 ? 8000 : 3000
    const delay = Math.min(60000, baseDelay * (2 ** Math.min(attempts, 4)))
    attempts += 1
    const observedSocket = getSocket()
    logger.log(`⏳ Reconnect dijadwalkan ${Math.ceil(delay / 1000)} detik lagi (percobaan ${attempts}/${maxAttempts}).` +
      (reason ? ' Detail: ' + String(reason).slice(0, 160) : ''))

    reconnectTimer = setTimer(async () => {
      reconnectTimer = null
      // A late timer must never replace a newer or successfully logged-in socket.
      if (getSocket() !== observedSocket || isWhatsAppSocketOpen(getSocket()) || isWhatsAppLoginPending(getSocket())) {
        request(reason)
        return
      }
      inProgress = true
      try {
        await reconnect()
      } catch (error) {
        logger.error('Gagal membuat ulang socket WhatsApp:', error?.message || error)
        queued ||= { statusCode, reason: 'Pembuatan socket WhatsApp gagal.' }
      } finally {
        inProgress = false
        if (queued) {
          const next = queued
          queued = null
          schedule(next.statusCode, next.reason)
        } else {
          // Watch each replacement even when there is no active render waiter.
          request(reason)
        }
      }
    }, delay)
    reconnectTimer.unref?.()
    return true
  }

  function request(reason = '') {
    const socket = getSocket()
    if (isWhatsAppSocketOpen(socket)) {
      reset()
      return false
    }
    if (blocked) return true
    // QR/code entry is an intentional wait for the owner, not a failed login.
    // Closed transports still reconnect, even if an old pairingCode remains.
    if (isWhatsAppLoginPending(socket)) {
      clearHandshake()
      if (reconnectTimer !== null) clearTimer(reconnectTimer)
      reconnectTimer = null
      queued = null
      return true
    }
    const creds = socket?.authState?.creds
    if (creds?.registered === true && !creds.me?.id) {
      clearHandshake()
      if (!authWarningShown) {
        authWarningShown = true
        logger.error('❌ Kredensial WhatsApp terdaftar tidak memiliki creds.me.id. Pulihkan sesi dari backup atau pasangkan ulang; reconnect tidak memperbaiki kredensial ini.')
      }
      return true
    }
    if (reconnectTimer !== null || inProgress || queued) return true

    const transport = getWhatsAppWebSocketState(socket)
    if (transport === 'connecting' || transport === 'open') {
      if (handshakeTimer === null) {
        logger.warn(`⏳ Socket WhatsApp belum siap (transport=${transport}). Menunggu handshake ${Math.ceil(handshakeTimeoutMs / 1000)} detik.`)
        handshakeTimer = setTimer(() => {
          handshakeTimer = null
          if (getSocket() !== socket || isWhatsAppSocketOpen(socket) || isWhatsAppLoginPending(socket)) {
            request(reason)
            return
          }
          schedule(428, (reason || 'Socket WhatsApp belum siap.') + ' Batas waktu autentikasi tercapai.')
        }, handshakeTimeoutMs)
        handshakeTimer.unref?.()
      }
      return true
    }
    return schedule(428, reason || 'Socket WhatsApp terdeteksi tertutup.')
  }

  return { request, schedule, reset, clearHandshake }
}
