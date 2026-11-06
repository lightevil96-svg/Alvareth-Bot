import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";

// Media inference is deliberately restricted to services on this Linux host.
export function localServiceUrl(value, path = "") {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || !['127.0.0.1', '[::1]'].includes(url.hostname) || url.username || url.password || url.search || url.hash) {
    throw new Error('Layanan media harus memakai alamat loopback numerik (127.0.0.1 atau [::1]), tanpa kredensial.');
  }
  return new URL(path.replace(/^\\//, ''), url.href.replace(/\\/?$/, '/')).href;
}

function requestWithoutTimeout(url, options = {}) {
  const target = new URL(url);
  const transport = target.protocol === "https:" ? httpsRequest : httpRequest;
  return new Promise((resolve, reject) => {
    const request = transport(target, {
      method: options.method || "GET",
      headers: options.headers,
      signal: options.signal
    }, response => {
      const chunks = [];
      let size = 0;
      response.on("data", chunk => {
        size += chunk.length;
        if (size > 16 * 1024 * 1024) {
          request.destroy(new Error("Respons layanan lokal terlalu besar."));
          return;
        }
        chunks.push(chunk);
      });
      response.on("error", reject);
      response.on("end", () => {
        const status = Number(response.statusCode || 0);
        const body = Buffer.concat(chunks).toString("utf8");
        resolve({
          ok: status >= 200 && status < 300,
          status,
          text: async () => body
        });
      });
    });
    request.on("error", reject);
    if (options.body !== undefined && options.body !== null) request.write(options.body);
    request.end();
  });
}

export async function localJson(url, options = {}, timeout = 90000) {
  const noTimeout = timeout === null || timeout === Infinity || timeout === 0;
  const response = noTimeout
    ? await requestWithoutTimeout(url, options)
    : await fetch(url, {
      ...options,
      redirect: 'error',
      signal: options.signal || AbortSignal.timeout(timeout)
    });
  if (!response.ok) throw new Error('Layanan lokal HTTP ' + response.status);
  const text = await response.text();
  if (text.length > 16 * 1024 * 1024) throw new Error('Respons layanan lokal terlalu besar.');
  return JSON.parse(text);
}
