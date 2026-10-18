// Boot and HTTP smoke tests.
//
// Importing createApp() is itself the assertion that matters most here: it pulls
// in the controller, which pulls in pdf.service, which imports pdf-parse. If the
// pdf-parse import shape is wrong, this file fails to load - which is exactly the
// failure that would otherwise surface as a 500 on the first real upload.
//
// Run from backend/:  node --test

import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import app from '../server.js'
import { extractPdfText } from '../services/pdf.service.js'
import { closeDB } from '../database/connection.js'

let server
let base

before(async () => {
  // Port 0 asks the OS for a free port, so the test never collides with a dev
  // server already running on 5000.
  server = app.listen(0)
  await new Promise((resolve) => server.once('listening', resolve))
  base = `http://127.0.0.1:${server.address().port}`
})

after(async () => {
  await closeDB()
  if (server) await new Promise((resolve) => server.close(resolve))
})

test('the pdf-parse module exposes a callable export', () => {
  assert.equal(typeof extractPdfText, 'function')
})

test('GET /api/health answers', async () => {
  const res = await fetch(`${base}/api/health`)
  assert.equal(res.status, 200)

  const body = await res.json()
  assert.equal(body.status, 'ok')
})

test('POST /api/parse without a file is a 400, not a 500', async () => {
  const res = await fetch(`${base}/api/parse`, {
    method: 'POST',
    body: new FormData(),
  })

  assert.equal(res.status, 400)
  const body = await res.json()
  assert.match(body.error, /resume/i)
})

test('POST /api/parse rejects a non-PDF upload', async () => {
  const form = new FormData()
  form.append('resume', new Blob(['not a pdf at all'], { type: 'text/plain' }), 'notes.txt')

  const res = await fetch(`${base}/api/parse`, { method: 'POST', body: form })
  assert.equal(res.status, 415)
})

test('a file that is not a real PDF fails as 422, not as a crash', async () => {
  // Valid mime type so the file filter lets it through, then the parser fails.
  // The point is that a broken PDF is a client error with a readable message,
  // rather than a stack trace and a 500.
  const form = new FormData()
  form.append('resume', new Blob(['%PDF-1.4 not really'], { type: 'application/pdf' }), 'broken.pdf')

  const res = await fetch(`${base}/api/parse`, { method: 'POST', body: form })
  assert.equal(res.status, 422)
  const body = await res.json()
  assert.match(body.error, /pdf/i)
})

test('an unknown route returns JSON, not an HTML error page', async () => {
  const res = await fetch(`${base}/api/nope`)
  assert.equal(res.status, 404)

  const body = await res.json()
  assert.ok(body.error)
})
