const DEFAULT_POLL_INTERVAL_MS = 1000

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

export function isWhatsAppSocketOpen(socket) {
  return Boolean(
    socket &&
    typeof socket.sendMessage === 'function' &&
    socket.ws &&
    socket.ws.readyState === 1 &&
    socket.user?.id
  )
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
 * Wait without an arbitrary timeout until the current WhatsApp socket is open.
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
      readyState: socket?.ws?.readyState ?? null,
      authenticated: Boolean(socket?.user?.id)
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
