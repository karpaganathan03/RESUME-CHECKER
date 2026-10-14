// Environment values, read once and validated in one place.
//
// Reading process.env directly all over the codebase means a missing variable
// shows up as `undefined` at the moment of use - deep inside a request, on a
// serverless cold start. Failing loudly at import time is much easier to debug.

import 'dotenv/config'

const NODE_ENV = process.env.NODE_ENV || 'development'
const isProduction = NODE_ENV === 'production'

export const PORT = Number(process.env.PORT) || 5000

// Where else the browser is allowed to call the API from.
//
// This is OPTIONAL now, and that is the single-project deployment correction.
// The frontend and this API are one Vercel project, so the browser calls the API
// on its own origin and no CORS applies at all. CLIENT_ORIGINS only needs a value
// if you also call the API from a DIFFERENT origin - another site, a mobile app,
// or a Vercel preview URL.
//
// Comma-separated, and no trailing slash: an origin is scheme + host + port, so
// "https://app.com/" never matches the Origin header the browser sends.
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

/** Printed on boot, so the CORS posture is never a guess. */
export function describeCors() {
  if (CLIENT_ORIGINS.length > 0) return `CORS allowing: ${CLIENT_ORIGINS.join(', ')}`
  return 'CORS: same-origin only (the UI is served by this same app)'
}

/**
 * Called once at startup so a bad production config fails at boot rather than on
 * the first request.
 *
 * CLIENT_ORIGINS is deliberately NOT required here. It used to be, back when the
 * frontend was a separate Vercel project and every API call was cross-origin. In
 * the single-project deploy the UI and the API share an origin, so demanding it
 * would refuse to boot a perfectly correct deployment.
 */
export function assertProductionConfig() {
  if (!isProduction) return
  if (!MONGODB_URI) throw new Error('MONGODB_URI is required in production.')
}
