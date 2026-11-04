# Cloudflare Tunnel — LightJurnal Video Studio

Production hostname: https://video.lightjurnal.my.id

Cloudflare resources provisioned for this integration:

- Tunnel: `lightjurnal-video-studio` (remotely managed).
- Public hostname: `video.lightjurnal.my.id`.
- Origin service: `http://127.0.0.1:2132` (the Alvareth HTTP server).
- DNS: proxied CNAME to the dedicated tunnel UUID.
- Existing SSH tunnel `chromebook-lightjurnal` is separate and remains unchanged.

## One-time server credential setup

A remotely-managed Cloudflare Tunnel requires its tunnel token to run. The token is a credential: never commit it, paste it into the LightJurnal browser, or print it in logs.

1. Open Cloudflare Zero Trust → Networks → Tunnels.
2. Open `lightjurnal-video-studio` and choose **Add a replica**.
3. Copy the installation command into a private text editor; do not run it as-is. Copy only the token value after `--token`.
4. In Pterodactyl → Startup/Environment, set `VIDEO_STUDIO_TUNNEL_TOKEN` to that value, then restart Alvareth.
5. Alternatively, create `~/.alvareth-bot-data/video-studio/tunnel-token` on the server, put only the token in the file, and set file permissions to `0600`.

On startup, Alvareth writes an environment token into the persistent token file with owner-only permissions. It finds an existing cloudflared binary or downloads the official Linux x64/ARM64 release and verifies the SHA-256 digest published by GitHub Releases. The tunnel starts after the HTTP server listens and retries with bounded exponential backoff if the connector exits.

## Verification

After restart, check the terminal for:

- `[VIDEO STUDIO TUNNEL] cloudflared ... terpasang dan SHA-256 terverifikasi` (only if a download was needed).
- `[VIDEO STUDIO TUNNEL] Koneksi Cloudflare aktif` after the connector registers.
- Cloudflare dashboard status **Healthy** for `lightjurnal-video-studio`.
- `https://video.lightjurnal.my.id/health` returns JSON with `status: "ok"`.
- `https://video.lightjurnal.my.id/api/video-studio/health` returns the Video Studio readiness response.

The public health endpoint does not reveal the API key. In LightJurnal, the API URL is prefilled; enter the separate `VIDEO_STUDIO_API_KEY` once. Creative settings remain prompt-only.

## Important boundaries

- The bot process must listen on port 2132, or the Cloudflare remote ingress origin must be updated to the actual Pterodactyl allocation port.
- The tunnel is inactive until its token is installed on the server. DNS and ingress configuration alone do not create a running connector.
- No changes are made to the main website DNS records or the existing SSH tunnel.
