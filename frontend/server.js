// The frontend's HTTP server: Next.js with one addition (D20). The browser
// reaches the API through this origin (`/backend/*`, proxied by the rewrite
// in next.config.js), so every request the backend sees comes from this
// process, and its rate limiter needs the real client's address. Next's own
// proxy forwards `X-Forwarded-For` exactly as the client sent it — it never
// appends the socket's address, and `request.ip` is empty when self-hosted
// (both verified in D20) — so this server appends it before Next handles the
// request: the rightmost entry is then always the peer that connected here,
// which is what the backend reads from a trusted proxy
// (RATE_LIMIT_TRUSTED_PROXIES=frontend in Compose). Everything else is Next's
// standard custom-server shape; `npm run dev` and `npm run start` both go
// through here (package.json), in the container and natively.
const { createServer } = require('node:http')
const { parse } = require('node:url')
const next = require('next')
const { appendForwardedFor } = require('./lib/backendProxy')

const dev = process.env.NODE_ENV !== 'production'
const port = Number(process.env.PORT || 3000)
const hostname = process.env.HOSTNAME || '0.0.0.0'

const app = next({ dev, hostname, port })
const handle = app.getRequestHandler()
const upgrade = app.getUpgradeHandler()

app.prepare().then(() => {
  const server = createServer((req, res) => {
    const forwarded = appendForwardedFor(req.headers['x-forwarded-for'], req.socket.remoteAddress)
    if (forwarded) req.headers['x-forwarded-for'] = forwarded
    handle(req, res, parse(req.url || '/', true))
  })
  // The dev server's HMR socket and anything else Next upgrades.
  server.on('upgrade', (req, socket, head) => upgrade(req, socket, head))
  server.listen(port, hostname, () => {
    console.log(`> ${dev ? 'dev' : 'production'} server on http://${hostname}:${port}`)
  })
})
