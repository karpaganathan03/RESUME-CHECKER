// The last middleware in the chain: every error becomes one JSON shape.
//
// The important behaviour is the 4-argument signature. Express decides a
// middleware is an error handler by `fn.length === 4`, so writing it with three
// parameters silently turns it into a normal middleware that never runs.

import { IS_PRODUCTION } from '../config/env.js'

export function notFound(req, res) {
  res.status(404).json({ error: `No route for ${req.method} ${req.originalUrl}` })
}

// eslint-disable-next-line no-unused-vars -- the 4th arg is what marks this as an error handler
export function errorHandler(err, req, res, next) {
  // A body-parser size limit also surfaces as a 413-shaped problem.
  const status =
    err.status ||
    err.statusCode ||
    (err.type === 'entity.too.large' ? 413 : 500)

  if (status >= 500) {
    // Log the stack server-side, but never ship it to the client: stack traces
    // leak file paths and library versions.
    console.error('[error]', err)
  }

  const body = {
    error: status >= 500 ? 'Something went wrong on the server.' : err.message,
  }
  // Extra detail is useful while developing and noisy - and leaky - in production.
  if (!IS_PRODUCTION && status >= 500) body.stack = err.stack

  res.status(status).json(body)
}
