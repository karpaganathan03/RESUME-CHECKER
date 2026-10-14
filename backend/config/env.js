// Environment values, read once and validated in one place.
//
// Reading process.env directly all over the codebase means a missing variable
// shows up as `undefined` at the moment of use - deep inside a request, on a
// serverless cold start. Failing loudly at import time is much easier to debug.

import 'dotenv/config'

const NODE_ENV = process.env.NODE_ENV || 'development'
const isProduction = NODE_ENV === 'production'

export const PORT = Number(process.env.PORT) || 5000

// Where the browser is allowed to call us from.
//
// CLIENT_ORIGINS is a comma-separated list. An empty list in development means
// "reflect whatever origin asked", which keeps a local Vite port that moved from
// 5173 to 5174 working. In production an empty list is a locked door, so it is
// required there instead of silently allowing nothing.
const rawOrigins = (process.env.CLIENT_ORIGINS || '')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean)

export const CLIENT_ORIGINS = rawOrigins

export const MONGODB_URI = process.env.MONGODB_URI || ''

// Optional. When unset, every request is scored by the heuristic in
// services/scoring.service.js and aiSummary comes back null.
export const AI_API_KEY = process.env.AI_API_KEY || ''

export const NODE_ENV_VAR = NODE_ENV
export const IS_PRODUCTION = isProduction

/**
 * A comma-separated list is the one string shape that breaks CORS silently:
 * pasting both the preview and production URL into a single value causes the
 * header to echo an origin the browser never sent, and the preflight fails.
 * Reading it back here makes that visible on boot.
 */
export function describeCors() {
  if (CLIENT_ORIGINS.length > 0) return `CORS allowing: ${CLIENT_ORIGINS.join(', ')}`
  if (IS_PRODUCTION) {
    return 'CORS: no CLIENT_ORIGINS set in production - browsers will be blocked from calling this API'
  }
  return 'CORS: no CLIENT_ORIGINS set, allowing any origin (development only)'
}

/** Called once at startup so a bad production config fails at boot, not at request time. */
export function assertProductionConfig() {
  if (!IS_PRODUCTION) return
  if (!MONGODB_URI) throw new Error('MONGODB_URI is required in production.')
  if (CLIENT_ORIGINS.length === 0) {
    throw new Error('CLIENT_ORIGINS is required in production (comma-separated frontend URLs).')
  }
}
