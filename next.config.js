/**
 * Static export for GitHub Pages. See PRD §13.
 * `basePath` must match the repository name.
 */
const isProd = process.env.NODE_ENV === 'production'
const basePath = isProd ? '/raft-simulator' : ''

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'export',
  basePath,
  assetPrefix: basePath || undefined,
  trailingSlash: true,
  images: { unoptimized: true },
  reactStrictMode: true,
  env: {
    NEXT_PUBLIC_BASE_PATH: basePath,
  },
}

module.exports = nextConfig
