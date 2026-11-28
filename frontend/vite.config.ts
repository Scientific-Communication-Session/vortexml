import fs from 'node:fs'
import path from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { defineConfig, type Connect, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

// Where the Flask backend lives. Override (e.g. VORTEX_BACKEND_URL=http://127.0.0.1:5051)
// to run a second instance next to the live one.
const backend = process.env.VORTEX_BACKEND_URL || 'http://127.0.0.1:5050'

// The one public hostname. Must match VORTEX_PUBLIC_URL on the backend.
const publicHost = 'vortexml.ro'

const dist = path.resolve(import.meta.dirname, 'dist')

const hostOf = (req: IncomingMessage) => req.headers.host?.split(':')[0]

// Cloudflare tells us how the visitor reached it; the tunnel itself is plain HTTP.
const cameOverHttp = (req: IncomingMessage) =>
  req.headers['x-forwarded-proto'] === 'http' || /"scheme":"http"/.test(String(req.headers['cf-visitor'] ?? ''))

// One origin only: https://vortexml.ro. www is an alias, and http:// is upgraded,
// so the login cookie and the sockets the backend accepts have a single home.
const canonicalOrigin: Connect.NextHandleFunction = (req, res, next) => {
  const host = hostOf(req)
  const www = host === `www.${publicHost}`
  if (!www && !(host === publicHost && cameOverHttp(req))) return next()
  res.writeHead(301, { Location: `https://${publicHost}${req.url ?? '/'}` })
  res.end()
}

const redirects = (): Plugin => ({
  name: 'vortex-canonical-origin',
  configureServer(server) { server.middlewares.use(canonicalOrigin) },
  configurePreviewServer(server) { server.middlewares.use(canonicalOrigin) },
})

// ─── The production server (`vite preview` over the built `dist/`) ───────────

// Scripts and styles come from this origin only; the build has no inline
// script. Inline `style` attributes stay allowed: the animation library and
// the prerendered pages use them.
// (Older Firefox and Safari do not count a same-origin WebSocket as 'self', so
// the live-training socket is named outright.)
const csp = (live: boolean) => [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "media-src 'self' blob:",
  `connect-src 'self' ${live ? `wss://${publicHost}` : 'ws: wss:'}`,
  "worker-src 'self' blob:",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  // HTTPS-only rules are for the public site; a copy on http://127.0.0.1 must still load.
  ...(live ? ['upgrade-insecure-requests'] : []),
].join('; ')

const SECURITY_HEADERS: Record<string, string> = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()',
  'Cross-Origin-Opener-Policy': 'same-origin',
}

// Routes the app knows, written by scripts/prerender.mjs. Anything else that
// asks for a page gets the "not found" page with a real 404 status, so search
// engines do not index made-up addresses.
let routesCache: { mtime: number; patterns: RegExp[] } | undefined
const knownRoute = (pathname: string): boolean => {
  try {
    const file = path.join(dist, 'routes.json')
    const mtime = fs.statSync(file).mtimeMs
    if (routesCache?.mtime !== mtime) {
      const routes: string[] = JSON.parse(fs.readFileSync(file, 'utf8'))
      routesCache = {
        mtime,
        patterns: routes.map((r) => new RegExp(`^${r.replace(/:[^/]+/g, '[^/]+')}/?$`)),
      }
    }
    return routesCache.patterns.some((p) => p.test(pathname))
  } catch {
    // No list (a build is in progress): let the app decide.
    return true
  }
}

const exists = (file: string) => fs.existsSync(path.join(dist, file))

/** Is this URL path a file in dist/? (Resolved first, so `..` cannot step outside.) */
const isFile = (pathname: string) => {
  try {
    const file = path.join(dist, path.normalize(decodeURIComponent(pathname)))
    return file.startsWith(dist + path.sep) && fs.statSync(file).isFile()
  } catch {
    return false
  }
}

/** Adjust the status and headers of a response the static file server is about to send. */
const onHead = (res: ServerResponse, adjust: (status: number, headers: Record<string, unknown>) => number) => {
  const writeHead = res.writeHead.bind(res) as (...args: unknown[]) => ServerResponse
  res.writeHead = ((status: number, ...rest: unknown[]) => {
    const headers = rest.find((r): r is Record<string, unknown> => typeof r === 'object' && r !== null) ?? {}
    return writeHead(adjust(status, headers), headers)
  }) as typeof res.writeHead
}

// The static file server leaves the character set off text files; ours are
// UTF-8 (names with diacritics, dashes) and readers should not have to guess.
const TEXT_TYPES: Record<string, string> = {
  '.md': 'text/markdown; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
}

// For crawlers and agents, on every page: where the site describes itself.
const SITE_LINKS = '</llms.txt>; rel="describedby"; type="text/plain", </sitemap.xml>; rel="sitemap"; type="application/xml"'

/** The Markdown twin of a page address (written by scripts/prerender.mjs), if it has one. */
const markdownTwin = (pathname: string) => {
  const file = pathname === '/' ? '/index.md' : `${pathname}.md`
  return isFile(file) ? file : undefined
}

const wantsMarkdown = (req: IncomingMessage) => /\btext\/markdown\b/.test(String(req.headers.accept ?? ''))

const production = (): Plugin => ({
  name: 'vortex-production-server',
  configurePreviewServer(server) {
    server.middlewares.use((req: IncomingMessage, res: ServerResponse, next: Connect.NextFunction) => {
      for (const [name, value] of Object.entries(SECURITY_HEADERS)) res.setHeader(name, value)
      const live = hostOf(req) === publicHost
      res.setHeader('Content-Security-Policy', csp(live))
      if (live) res.setHeader('Strict-Transport-Security', 'max-age=63072000')

      const [pathname, query = ''] = (req.url ?? '/').split('?')
      if (/^\/(api|socket\.io)\//.test(pathname)) return next()

      if (path.extname(pathname) && !pathname.endsWith('.html')) {
        // A file. A missing one is a plain 404, never the app shell: a browser
        // asking for a script must not be handed (and cache) a page.
        if (!isFile(pathname)) {
          res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' })
          return res.end('Not found')
        }
        res.setHeader('Cache-Control', pathname.startsWith('/assets/')
          // Content-hashed by the build: a new deploy means new names.
          ? 'public, max-age=31536000, immutable'
          // From public/ (icons, the preview image, tutorial clips, robots.txt…)
          : 'public, max-age=14400')
        const type = TEXT_TYPES[path.extname(pathname)]
        if (type) onHead(res, (status, headers) => { headers['Content-Type'] = type; return status })
        if (pathname.endsWith('.md')) {
          // A page's Markdown twin: rebuilt with the page, and the page is the
          // address to index (/index.md is the home page's).
          const page = pathname === '/index.md' ? '/' : pathname.slice(0, -3)
          res.setHeader('Cache-Control', 'no-cache')
          res.setHeader('Link', `<https://${publicHost}${page}>; rel="canonical"`)
          res.setHeader('X-Robots-Tag', 'noindex')
        }
        return next()
      }

      // A page. One address each: /privacy/ is /privacy.
      if (pathname.length > 1 && pathname.endsWith('/')) {
        res.writeHead(301, { Location: pathname.replace(/\/+$/, '') + (query ? `?${query}` : '') })
        return res.end()
      }
      // Never cached: it names the current build's hashed files.
      res.setHeader('Cache-Control', 'no-cache')
      const rewrite = (file: string) => { req.url = file + (query ? `?${query}` : '') }
      // The same address answers with Markdown when that is what was asked for.
      res.setHeader('Vary', 'Accept')
      const twin = markdownTwin(pathname)
      if (twin && wantsMarkdown(req)) {
        res.setHeader('Link', `<https://${publicHost}${pathname}>; rel="canonical"`)
        res.setHeader('X-Robots-Tag', 'noindex')
        onHead(res, (status, headers) => { headers['Content-Type'] = TEXT_TYPES['.md']; return status })
        rewrite(twin)
        return next()
      }
      res.setHeader('Link', twin ? `${SITE_LINKS}, <${twin}>; rel="alternate"; type="text/markdown"` : SITE_LINKS)
      // A page address answers with the page whatever the client says it accepts
      // (the file server's fallback to the app shell insists on text/html).
      if (req.headers.accept && !/text\/html|\*\/\*/.test(req.headers.accept)) req.headers.accept = 'text/html'
      if (pathname === '/') {
        // dist/index.html stays the empty shell that unknown-to-the-build routes
        // (e.g. /profile) start from; the prerendered home page is its own file.
        if (exists('_home.html')) rewrite('/_home.html')
      } else if (!pathname.endsWith('.html') && !knownRoute(pathname) && exists('404.html')) {
        rewrite('/404.html')
        onHead(res, () => 404)
      }
      next()
    })
  },
})

// ─── The dev server (`vite`, hot reload) ─────────────────────────────────────

// Cloudflare caches by file extension: it turned Vite's `no-cache` on .css (but
// not on .tsx) into a 4-hour browser cache, so visitors ran new markup against
// old styles. `private` keeps dev responses out of that cache if a dev server is
// ever put behind the tunnel again. Hashed deps stay immutable.
const noEdgeCache = (): Plugin => ({
  name: 'vortex-no-edge-cache',
  configureServer(server) {
    server.middlewares.use((req, res, next) => {
      if (/^\/(api|socket\.io)\//.test(req.url ?? '')) return next()
      const setHeader = res.setHeader.bind(res)
      res.setHeader = (name, value) =>
        setHeader(name, name.toLowerCase() === 'cache-control' && value === 'no-cache' ? 'private, no-cache' : value)
      // Set up front so a 304 carries it too and updates what the edge stored.
      setHeader('Cache-Control', 'private, no-cache')
      next()
    })
  }
})

const proxy = {
  '/api': backend,
  '/socket.io': {
    target: backend,
    ws: true
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), redirects(), production(), noEdgeCache()],
  build: {
    // One stylesheet for the whole site, linked from every page's <head>: a
    // prerendered page is styled before any script runs.
    cssCodeSplit: false,
    // Lists each page's script chunk, so prerendered pages can preload theirs.
    manifest: true,
    // Keep the previous build's hashed files: a tab opened before a deploy
    // still finds the chunks it asks for. scripts/prerender.mjs prunes old ones.
    emptyOutDir: false,
  },
  server: {
    // Vite rejects unknown Host headers; allow the public tunnel domain
    // (www only gets as far as the redirect above).
    allowedHosts: [publicHost, `www.${publicHost}`, 'localhost', '127.0.0.1'],
    proxy,
  },
  preview: {
    // Bind all interfaces so the Cloudflare tunnel (→ 192.168.x.x:5173) reaches us.
    host: true,
    port: 5173,
    strictPort: true,
    allowedHosts: [publicHost, `www.${publicHost}`, 'localhost', '127.0.0.1'],
    proxy,
  },
})
