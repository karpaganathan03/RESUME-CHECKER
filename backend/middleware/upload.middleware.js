// File upload handling.

import multer from 'multer'
import { httpError, isPdf } from '../utils.js'

export const MAX_FILE_MB = 5

// memoryStorage keeps the PDF in RAM as req.file.buffer for the length of the
// request. That is the right choice on Vercel, where the filesystem is read-only
// outside /tmp - diskStorage would fail there and work fine locally, which is
// the worst kind of bug to find late.
const storage = multer.memoryStorage()

export const upload = multer({
  storage,
  limits: {
    fileSize: MAX_FILE_MB * 1024 * 1024,
    files: 1,
  },
  fileFilter(req, file, cb) {
    if (!isPdf(file)) {
      cb(httpError(415, 'Only PDF files are accepted.'))
      return
    }
    cb(null, true)
  },
})

/**
 * Translate multer's own errors into the HTTP status they actually mean.
 * Left to the generic handler, a too-large file would surface as a 500.
 */
export function handleUploadErrors(err, req, res, next) {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ error: `That file is larger than ${MAX_FILE_MB} MB.` })
    }
    if (err.code === 'LIMIT_UNEXPECTED_FILE') {
      return res.status(400).json({ error: 'Send exactly one file, in a field named "resume".' })
    }
    return res.status(400).json({ error: `Upload failed: ${err.message}` })
  }
  return next(err)
}
