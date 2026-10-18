// Vercel's entry point for the whole backend.
//
// Vercel only runs serverless functions from a top-level api/ folder, so a
// rewrite pointing at backend/server.js (the old vercel.json) never executed
// anything. This one-line file hands every /api/* request, forwarded here by the
// rewrite in vercel.json, to the same Express app that `npm start` runs locally.
//
// The app is exported, not started: server.js only calls listen() when run
// directly, so importing it here does not open a port.

import app from '../backend/server.js'

export default app
