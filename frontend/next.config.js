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
const { cacheHeaders } = require('./lib/cacheHeaders')
const { robotsHeaders } = require('./lib/robotsHeaders')

/** @type {import('next').NextConfig} */
const nextConfig = {
  env: { NEXT_PUBLIC_APP_VERSION: appVersion() },
  images: {
    domains: ['images.unsplash.com', 'via.placeholder.com'],
  },
  // Q52: static security headers on every route, CSP in report-only mode;
  // P2.1: the brand set is immutable; S2.1: the private surface is noindex.
  async headers() {
    return [...securityHeaders(), ...cacheHeaders(), ...robotsHeaders()]
  },
}

// P1.1: `ANALYZE=1 npm run build` writes the bundle treemaps to .next/analyze/.
// Required lazily so a production build never loads the dev dependency.
const withBundleAnalyzer =
  process.env.ANALYZE === '1' ? require('@next/bundle-analyzer')({ enabled: true, openAnalyzer: false }) : (config) => config

module.exports = withBundleAnalyzer(nextConfig)
