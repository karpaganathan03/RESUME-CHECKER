// All routes, mounted once at /api.
//
// Nothing here may live outside /api. The frontend calls ${VITE_API_URL}/api/...
// and the Vercel rewrite in the root vercel.json only sends /api/* here, so a route
// registered as a bare /health would answer on localhost and 404 in production.

import { Router } from 'express'
import { parseResume, listScores } from '../controllers/score.controller.js'
import { upload } from '../middleware/upload.middleware.js'

const router = Router()

/** Liveness check. Deliberately cheap: no database, no PDF library. */
router.get('/health', (req, res) => {
  res.json({ status: 'ok', uptime: Math.round(process.uptime()) })
})

// upload.single() is the middleware that turns the multipart body into req.file.
// The field name "resume" must match what frontend/src/lib/api.js appends.
router.post('/parse', upload.single('resume'), parseResume)
router.get('/scores', listScores)

export default router
