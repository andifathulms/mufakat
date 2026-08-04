/**
 * Serve ./out under the production basePath, so the exported site is verified
 * exactly as GitHub Pages will serve it. See PRD §13.
 */
import { createServer } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { join, extname, normalize } from 'node:path'

const BASE_PATH = '/mufakat'
const ROOT = join(process.cwd(), 'out')
const PORT = Number(process.env.PORT ?? 4321)

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.ico': 'image/x-icon',
}

async function resolveFile(pathname) {
  const candidates = [pathname, join(pathname, 'index.html'), `${pathname}.html`]
  for (const candidate of candidates) {
    const full = join(ROOT, normalize(candidate))
    if (!full.startsWith(ROOT)) continue
    try {
      const s = await stat(full)
      if (s.isFile()) return full
    } catch {
      /* try next candidate */
    }
  }
  return null
}

createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://localhost:${PORT}`)
  if (url.pathname === '/') {
    res.writeHead(302, { Location: `${BASE_PATH}/` })
    res.end()
    return
  }
  if (!url.pathname.startsWith(BASE_PATH)) {
    res.writeHead(404, { 'Content-Type': 'text/plain' })
    res.end(`Not found. The site is served under ${BASE_PATH}/`)
    return
  }
  const rel = url.pathname.slice(BASE_PATH.length) || '/'
  const file = await resolveFile(rel)
  if (!file) {
    const notFound = await resolveFile('/404.html')
    res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' })
    res.end(notFound ? await readFile(notFound) : 'Not found')
    return
  }
  res.writeHead(200, { 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream' })
  res.end(await readFile(file))
}).listen(PORT, () => {
  console.log(`Preview: http://localhost:${PORT}${BASE_PATH}/`)
})
