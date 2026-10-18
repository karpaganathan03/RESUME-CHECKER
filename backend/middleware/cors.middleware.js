// Cross-origin rules.
//
// Two things here are easy to get wrong and painful to debug:
//
// 1. No trailing slash. An origin is scheme + host + port - "https://app.com/",
//    with the slash, never matches the Origin header the browser sends, and the
//    failure looks like a CORS problem with a correct-looking config.
//
// 2. A request with no Origin header (curl, a server-to-server call, a health
//    check) is not a browser and has nothing to protect, so it is allowed.
//    Rejecting it makes the endpoint unusable from a terminal.

import cors from 'cors'
import { CLIENT_ORIGINS, IS_PRODUCTION } from '../config/env.js'

function stripTrailingSlash(origin) {
  return origin.replace(/\/+$/, '')
}

export const corsOptions = {
  origin(origin, callback) {
    if (!origin) return callback(null, true)

    // Allow all origins when CLIENT_ORIGINS is empty or includes wildcard '*'
    if (CLIENT_ORIGINS.length === 0 || CLIENT_ORIGINS.includes('*')) {
      return callback(null, true)
    }

    const cleanOrigin = stripTrailingSlash(origin)
    const allowed = CLIENT_ORIGINS.some((entry) => {
      const cleanEntry = stripTrailingSlash(entry)
      if (cleanEntry === cleanOrigin) return true
      if (cleanEntry.startsWith('*.') && cleanOrigin.endsWith(cleanEntry.slice(1))) return true
      return false
    })

    if (allowed) return callback(null, true)

    // Not an Error: a browser just needs the header to be absent. Throwing here
    // would turn a blocked request into a 500 in the logs.
    return callback(null, false)
  },
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: false,
  maxAge: 86400,
}

export const corsMiddleware = cors(corsOptions)
