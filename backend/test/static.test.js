// Proves the single-project arrangement actually works: one server answers both
// the API and the built UI, on the same origin, with no CORS involved.
//
// Skips itself when frontend/dist is missing, so `npm test` still passes on a
// fresh clone before anyone has run a build.
//
// Run from backend/:  node --test test/static.test.js

import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import app from '../server.js'

const here = dirname(fileURLToPath(import.meta.url))
const DIST = join(here, '..', '..', 'frontend', 'dist')
const hasBuild = existsSync(join(DIST, 'index.html'))

let server
let base

before(async () => {
  if (!hasBuild) return
  server = app.listen(0)
  await new Promise((resolve) => server.once('listening', resolve))
  base = `http://127.0.0.1:${server.address().port}`
})

after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve))
})

test('the built UI is served from the same origin as the API', { skip: !hasBuild && 'run npm run build first' }, async () => {
  const res = await fetch(`${base}/`)

  assert.equal(res.status, 200)
  assert.match(res.headers.get('content-type') || '', /text\/html/)

  const html = await res.text()
  // The Vite bundle is referenced by the served HTML - proof this is the built
  // app and not the API's 404 page.
  assert.match(html, /<div id="root">/)
})

test('the API still answers correctly alongside the static handler', { skip: !hasBuild && 'run npm run build first' }, async () => {
  const res = await fetch(`${base}/api/health`)

  assert.equal(res.status, 200)
  const body = await res.json()
  assert.equal(body.status, 'ok')
})

test('an /api route is never swallowed by the SPA fallback', { skip: !hasBuild && 'run npm run build first' }, async () => {
  // This is the ordering bug the mount order in server.js exists to prevent: if
  // static/fallback were mounted before the API, an unknown /api path would
  // return index.html and the frontend would fail with "cannot read" instead.
  const res = await fetch(`${base}/api/definitely-not-a-route`)
  assert.equal(res.status, 404)

  const body = await res.json()
  assert.ok(body.error, 'expected JSON from the API, not HTML from the SPA fallback')
})

test('a deep link returns the app, not a 404', { skip: !hasBuild && 'run npm run build first' }, async () => {
  // A refresh on a client-side route has to hand back index.html, or the app
  // breaks the moment someone reloads.
  const res = await fetch(`${base}/some/client/route`)

  assert.equal(res.status, 200)
  assert.match(res.headers.get('content-type') || '', /text\/html/)
})
