// The help form reports which build a problem was seen on (C17). Set
// NEXT_PUBLIC_APP_VERSION in CI/deploys; a checkout falls back to its commit.
function appVersion() {
  if (process.env.NEXT_PUBLIC_APP_VERSION) return process.env.NEXT_PUBLIC_APP_VERSION
  try {
    return require('child_process').execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim()
  } catch {
    return 'dev'
  }
}

const { securityHeaders } = require('./lib/securityHeaders')

/** @type {import('next').NextConfig} */
const nextConfig = {
  env: { NEXT_PUBLIC_APP_VERSION: appVersion() },
  images: {
    domains: ['images.unsplash.com', 'via.placeholder.com'],
  },
  // Q52: static security headers on every route, CSP in report-only mode.
  async headers() {
    return securityHeaders()
  },
}
module.exports = nextConfig
