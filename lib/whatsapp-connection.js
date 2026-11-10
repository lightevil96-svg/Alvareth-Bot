const DEFAULT_POLL_INTERVAL_MS = 1000
const connectionStates = new WeakMap()

function hasIdentity(socket) {
  const identity = socket?.user?.id || socket?.authState?.creds?.me?.id
  return typeof identity === 'string' && Boolean(identity.trim())
}

/** Saved pairing credentials, not proof that this socket has logged in yet. */
export function hasLinkedWhatsAppSession(creds) {
  const identity = creds?.me?.id
  if (typeof identity !== 'string' || !identity.trim()) return false
  // QR pairing in @itsliaaa/baileys 0.3.18-final saves the signed account
  // without setting registered=true. requestPairingCode only sets a temporary me.
  return creds.registered === true || Boolean(
    creds.account?.details?.length &&
    creds.account?.accountSignature?.length &&
    creds.account?.deviceSignature?.length
  )
}

/** Attach immediately after socket creation, before any asynchronous startup work. */
export function trackWhatsAppSocket(socket) {
  if (!socket?.ev?.on || connectionStates.has(socket)) return socket
  const state = { connection: 'connecting', awaitingLogin: false }
  connectionStates.set(socket, state)
  socket.ev.on('connection.update', update => {
    if (update.connection) {
      state.connection = update.connection
      state.awaitingLogin = false
    }
    if (update.qr) state.awaitingLogin = true
    if (update.isNewLogin) state.awaitingLogin = false
  })
  return socket
}

export function isWhatsAppLoginPending(socket) {
  const state = connectionStates.get(socket)
  if (state?.connection === 'open' || state?.connection === 'close' || hasLinkedWhatsAppSession(socket?.authState?.creds)) return false
  const transport = getWhatsAppWebSocketState(socket)
  return (transport === 'open' || transport === 'connecting') &&
    Boolean(state?.awaitingLogin || socket?.authState?.creds?.pairingCode)
}

function createCancelledError() {
  const error = new Error('Menunggu koneksi WhatsApp dibatalkan.')
  error.code = 'RENDER_SCRIPT_CANCELLED'
  return error
}

function waitDelay(milliseconds, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(createCancelledError())
      return
    }

    let settled = false
    const finish = callback => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      callback()
    }
    const onAbort = () => finish(() => reject(createCancelledError()))
    const timer = setTimeout(() => finish(resolve), milliseconds)

    signal?.addEventListener('abort', onAbort, { once: true })
    if (signal?.aborted) onAbort()
  })
}

function notify(callback, details) {
  if (typeof callback !== 'function') return
  try {
    callback(details)
  } catch (error) {
    console.warn('[WA-CONNECTION] Callback status koneksi gagal:', error?.message || error)
  }
}

/**
 * Normalize transport state across @itsliaaa/baileys' WebSocketClient wrapper
 * (isOpen/isConnecting/isClosing/isClosed) and standard ws readyState values.
 */
export function getWhatsAppWebSocketState(socket) {
  const ws = socket?.ws
  if (!ws) return 'unavailable'

  const readyState = Number.isInteger(ws.readyState) ? ws.readyState : null
  if (ws.isOpen === true || readyState === 1) return 'open'
  if (ws.isConnecting === true || readyState === 0) return 'connecting'
  if (ws.isClosed === true || readyState === 3) return 'closed'
  if (ws.isClosing === true || readyState === 2) return 'closing'
  return 'unknown'
}

export function isWhatsAppSocketOpen(socket) {
  const creds = socket?.authState?.creds
  const state = connectionStates.get(socket)

  return Boolean(
    socket &&
    typeof socket.sendMessage === 'function' &&
    getWhatsAppWebSocketState(socket) === 'open' &&
    hasIdentity(socket) &&
    // Baileys emits connection.update/open after server login success. Its
    // registered flag belongs to code pairing, not the current login state.
    // Keep compatibility for callers supplying an untracked socket.
    (state ? state.connection === 'open' : creds?.registered !== false)
  )
}

export function isWhatsAppRestartRequired(error) {
  const statusCode = typeof error === 'number'
    ? error
    : Number(error?.output?.statusCode || error?.statusCode || error?.status || 0)
  return statusCode === 515
}

export function isWhatsAppConnectionClosedError(error) {
  const status = Number(
    error?.statusCode ||
    error?.output?.statusCode ||
    error?.status ||
    error?.cause?.statusCode ||
    error?.cause?.output?.statusCode ||
    0
  )
  const code = String(error?.code || error?.cause?.code || '')
  const message = String(error?.message || error || '')

  return status === 428 ||
    code === 'WA_SOCKET_NOT_OPEN' ||
    code === 'WA_SOCKET_UNAVAILABLE' ||
    /connection closed|precondition required|websocket.*closed|socket.*closed/i.test(message)
}

/**
 * Wait without an arbitrary timeout until the current WhatsApp socket is authenticated and open.
 * The caller can always stop waiting through AbortSignal (for example .render cancel).
 */
export async function waitForWhatsAppSocket(getSocket, {
  signal = null,
  pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
  onWait = null
} = {}) {
  if (typeof getSocket !== 'function') {
    throw new TypeError('getSocket harus berupa fungsi.')
  }

  const parsedInterval = Number(pollIntervalMs)
  const interval = Number.isSafeInteger(parsedInterval) && parsedInterval > 0
    ? Math.min(parsedInterval, 10000)
    : DEFAULT_POLL_INTERVAL_MS
  let firstWait = true

  while (true) {
    if (signal?.aborted) throw createCancelledError()

    let socket = null
    try {
      socket = getSocket()
    } catch (error) {
      notify(onWait, { reason: 'socket-lookup-failed', error })
    }

    if (isWhatsAppSocketOpen(socket)) return socket

    notify(onWait, {
      reason: firstWait ? 'waiting-for-connection' : 'connection-still-unavailable',
      socket,
      readyState: Number.isInteger(socket?.ws?.readyState) ? socket.ws.readyState : null,
      transportState: getWhatsAppWebSocketState(socket),
      authenticated: hasIdentity(socket) && (
        connectionStates.has(socket)
          ? connectionStates.get(socket).connection === 'open'
          : socket?.authState?.creds?.registered !== false
      )
    })
    firstWait = false

    await waitDelay(interval, signal)
  }
}

/**
 * Wait for an authenticated socket before sending. Retry only a preflight
 * WA_SOCKET_NOT_OPEN error, which occurs before any media upload starts.
 * Never retry an ambiguous 428 thrown during upload: WhatsApp may have accepted
 * the message before the acknowledgement was lost.
 */
export async function sendWithWhatsAppReconnect({
  getSocket,
  send,
  signal = null,
  pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
  onWait = null,
  onReconnectRequired = null
} = {}) {
  if (typeof send !== 'function') {
    throw new TypeError('send harus berupa fungsi.')
  }

  let retryUsed = false

  while (true) {
    const socket = await waitForWhatsAppSocket(getSocket, {
      signal,
      pollIntervalMs,
      onWait
    })

    try {
      return await send(socket)
    } catch (error) {
      let currentSocket = null
      try { currentSocket = getSocket() } catch {}

      const socketClosed = !isWhatsAppSocketOpen(socket)
      const socketReplaced = Boolean(currentSocket && currentSocket !== socket)
      const failedBeforeUpload = error?.code === 'WA_SOCKET_NOT_OPEN' &&
        error?.stage === 'preflight'
      const canSafelyRetry = !retryUsed &&
        failedBeforeUpload &&
        (socketClosed || socketReplaced)

      if (!canSafelyRetry) throw error

      retryUsed = true
      notify(onReconnectRequired, {
        socket: currentSocket,
        previousSocket: socket,
        error
      })
      notify(onWait, {
        reason: 'retry-after-disconnect',
        socket: currentSocket,
        previousSocket: socket,
        error
      })
    }
  }
}
