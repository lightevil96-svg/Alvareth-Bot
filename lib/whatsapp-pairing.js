const defaultWait = ms => new Promise(resolve => setTimeout(resolve, ms))

/** Normalize a WhatsApp phone number to international digits-only format. */
export function normalizePairingPhoneNumber(value) {
  const input = String(value ?? '').trim()
  const normalized = input.replace(/^\\+/, '').replace(/[\\s().-]/g, '')
  return /^[1-9]\\d{7,14}$/.test(normalized) ? normalized : ''
}

/**
 * Create a one-attempt-per-socket pairing-code requester.
 * The delay follows the Baileys fork's documented pairing handshake timing.
 */
export function createPairingCodeRequester({ phoneNumber, delayMs = 1500, wait = defaultWait } = {}) {
  const normalizedPhoneNumber = normalizePairingPhoneNumber(phoneNumber)
  const attempts = new WeakMap()

  return async function requestPairingCodeForSocket(socket, isCurrentSocket = () => true) {
    if (!socket || (typeof socket !== 'object' && typeof socket !== 'function')) {
      return { status: 'invalid-socket' }
    }

    if (attempts.has(socket)) {
      return { status: 'already-attempted', previous: attempts.get(socket) }
    }

    if (socket.authState?.creds?.registered) {
      attempts.set(socket, 'already-registered')
      return { status: 'already-registered' }
    }

    if (!normalizedPhoneNumber) {
      attempts.set(socket, 'invalid-phone')
      return { status: 'invalid-phone' }
    }

    if (typeof socket.requestPairingCode !== 'function') {
      attempts.set(socket, 'unsupported')
      return { status: 'unsupported' }
    }

    attempts.set(socket, 'pending')

    try {
      await wait(delayMs)

      if (typeof isCurrentSocket === 'function' && !isCurrentSocket(socket)) {
        attempts.set(socket, 'cancelled')
        return { status: 'cancelled' }
      }

      if (socket.authState?.creds?.registered) {
        attempts.set(socket, 'already-registered')
        return { status: 'already-registered' }
      }

      const code = await socket.requestPairingCode(normalizedPhoneNumber)
      if (typeof code !== 'string' || !code.trim()) {
        throw new Error('WhatsApp tidak mengembalikan pairing code yang valid.')
      }

      attempts.set(socket, 'generated')
      return { status: 'generated', code: code.trim() }
    } catch (error) {
      attempts.set(socket, 'failed')
      return { status: 'failed', error }
    }
  }
}
