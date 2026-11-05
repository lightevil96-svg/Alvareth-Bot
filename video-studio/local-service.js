// Media inference is deliberately restricted to services on this Linux host.
export function localServiceUrl(value, path = "") {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || !['127.0.0.1', '[::1]'].includes(url.hostname) || url.username || url.password || url.search || url.hash) {
    throw new Error('Layanan media harus memakai alamat loopback numerik (127.0.0.1 atau [::1]), tanpa kredensial.');
  }
  return new URL(path.replace(/^\//, ''), url.href.replace(/\/?$/, '/')).href;
}
export async function localJson(url, options = {}, timeout = 90000) {
  const response = await fetch(url, { ...options, redirect: 'error', signal: AbortSignal.timeout(timeout) });
  if (!response.ok) throw new Error('Layanan lokal HTTP ' + response.status);
  const text = await response.text();
  if (text.length > 16 * 1024 * 1024) throw new Error('Respons layanan lokal terlalu besar.');
  return JSON.parse(text);
}
