// ATS Checker (single deployable)
//
// This one file is BOTH the API and the web server for the built UI. That is the
// single-project deployment: the frontend and the backend are not two Vercel
// projects, so there is no CORS, no second build, and no cross-origin URL to keep
// in sync. The rewrite in the root vercel.json sends /api/* to this app.
//
// In development the two still run as separate dev servers for fast reloads:
//   npm --prefix backend run dev    the API on :5000
//   npm --prefix frontend run dev   Vite on :5173, proxying /api to :5000
// so the arrangement only collapses to one process in production and in
// `npm start`.

import express from 'express'
import helmet from 'helmet'
import { existsSync, realpathSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'
import routes from './routes/index.js'
import { corsMiddleware } from './middleware/cors.middleware.js'
import { handleUploadErrors } from './middleware/upload.middleware.js'
import { errorHandler, notFound } from './middleware/error.middleware.js'
import { PORT, IS_PRODUCTION, assertProductionConfig, describeCors, describeAi } from './config/env.js'
import { connectDB } from './database/connection.js'

const here = dirname(fileURLToPath(import.meta.url))

// The built UI. Not present until `npm run build` has run - which is the normal
// state during `npm --prefix backend run dev`, where Vite serves the frontend.
const DIST_DIR = join(here, '..', 'frontend', 'dist')

export function createApp() {
  const app = express()

  // Trusting one proxy hop makes req.ip and req.protocol correct behind Vercel
  // or any reverse proxy.
  app.set('trust proxy', 1)
  app.disable('x-powered-by')

  // Helmet's default CSP is aimed at server-rendered pages and is tighter than a
  // Vite bundle needs, so images and connections are opened up to self only.
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          ...helmet.contentSecurityPolicy.getDefaultDirectives(),
          'img-src': ["'self'", 'data:'],
          'connect-src': ["'self'"],
          // Helmet's default upgrades every http:// subresource to https://. On
          // http://localhost that makes Safari refuse to load the page's own JS
          // and CSS. Only production is served over https, so only production
          // gets the upgrade.
          'upgrade-insecure-requests': IS_PRODUCTION ? [] : null,
        },
      },
    }),
  )

  app.use(corsMiddleware)

  // JSON bodies are for any future JSON endpoint. A multipart upload is NOT
  // parsed here - multer handles that at the route, which is why the upload
  // route is unaffected by this line.
  app.use(express.json({ limit: '100kb' }))

  // Rate limiting on uploads is stubbed rather than omitted: parsing a PDF and
  // writing to the database is real work, and a public deploy should not accept
  // that unmetered.
  // TODO: mount express-rate-limit here before this goes public.

  // The API goes on FIRST, and only under /api. If the static handler were
  // mounted first it would answer /api/parse with the SPA fallback HTML, and the
  // frontend would report "the server replied in a shape the UI cannot read".
  app.use('/api', routes)

  // Serve the built UI when it exists.
  if (existsSync(DIST_DIR)) {
    app.use(express.static(DIST_DIR))

    // Any other GET is a client-side route, so hand back index.html and let the
    // app route it. This is what makes a refresh on a deep link work.
    app.get('*', (req, res, next) => {
      if (req.method !== 'GET' || req.path.startsWith('/api')) return next()
      res.sendFile(join(DIST_DIR, 'index.html'))
    })
  }

  // No build yet: say so, instead of a bare 404 that looks like a broken app.
  // This is the page people land on after `npm start` without `npm run build`.
  if (!existsSync(DIST_DIR)) {
    app.get('/', (req, res) => {
      if (req.accepts('json') && !req.accepts('html')) {
        return res.status(200).json({
          status: 'ok',
          message: 'ATS Checker API is running in standalone mode',
          health: '/api/health',
          parse: '/api/parse',
        })
      }
      res
        .status(200)
        .type('html')
        .send(
          '<!doctype html><meta charset="utf-8"><title>ATS Checker API</title>' +
            '<body style="font:16px/1.5 system-ui;max-width:42rem;margin:4rem auto;padding:0 1rem">' +
            '<h1>ATS Checker API is running</h1>' +
            '<p>Backend is operating in standalone API mode.</p>' +
            '<ul><li>For development UI, run <code>npm run dev</code> and open ' +
            '<a href="http://localhost:5173">http://localhost:5173</a>.</li>' +
            '<li>API health check: <a href="/api/health">/api/health</a></li>' +
            '<li>Upload endpoint: <code>POST /api/parse</code></li></ul></body>',
        )
    })
  }

  // Order matters. notFound runs for unmatched routes; handleUploadErrors only
  // sees multer's errors; errorHandler catches everything left. Both error
  // handlers take four arguments - that arity is what tells Express they are
  // error handlers rather than ordinary middleware.
  app.use(notFound)
  app.use(handleUploadErrors)
  app.use(errorHandler)

  return app
}

const app = createApp()
export default app

/**
 * Was this file run directly, or imported?
 *
 * The obvious check - comparing import.meta.url against a file:// URL built from
 * process.argv[1] - breaks on Windows in two ways: process.argv[1] uses
 * backslashes, and the path may be a short 8.3 name or behind a symlink.
 * Comparing realpath'd file URLs handles both, so `node server.js` does not
 * silently start no server, and importing the module does not silently start one.
 */
function isDirectRun() {
  const entry = process.argv[1]
  if (!entry) return false
  try {
    return import.meta.url === pathToFileURL(realpathSync(entry)).href
  } catch {
    return false
  }
}

if (isDirectRun()) {
  try {
    assertProductionConfig()
  } catch (err) {
    console.error(`[startup] ${err.message}`)
    process.exit(1)
  }

  const server = app.listen(PORT, () => {
    console.log(`Server listening on http://localhost:${PORT}`)
    console.log(describeCors())
    console.log(describeAi())

    if (!existsSync(DIST_DIR)) {
      console.log(
        'Backend running in standalone API mode (frontend/dist not present - UI served independently).',
      )
    }

    // Not awaited: a slow or unreachable database must not delay or prevent the
    // server from accepting requests. /api/parse connects lazily anyway, and a
    // DB failure there is reported in the response rather than crashing boot.
    connectDB()
      .then(() => console.log('MongoDB connected'))
      .catch((err) => console.warn(`MongoDB not connected: ${err.message}`))
  })

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`\n[startup error] Port ${PORT} is already in use by another running process.`)
      console.error(`To release port ${PORT} in PowerShell, run:`)
      console.error(`  Stop-Process -Id (Get-NetTCPConnection -LocalPort ${PORT}).OwningProcess -Force\n`)
    } else {
      console.error(`\n[startup error] Server failed to start:`, err.message)
    }
    process.exit(1)
  })
}
