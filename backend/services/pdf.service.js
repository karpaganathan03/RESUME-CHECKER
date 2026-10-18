// Reads text out of an uploaded PDF.
//
// pdf-parse has shipped two very different module shapes:
//
//   v1  a callable CommonJS function:   pdfParse(buffer) -> { text }
//   v2  an ESM class with named export:  new PDFParse({ data }).getText() -> { text }
//
// This project installs v2 (see backend/package.json). The first version of this
// file looked for a callable export, found none, and every upload failed with
// "pdf-parse did not expose a callable export" - which the UI then hid behind a
// fake offline score. The class is used directly now, and v1's function shape is
// kept as a fallback so a downgrade does not break the app.

import * as pdfParseModule from 'pdf-parse'

// The PDF.js worker is imported statically from 'pdf-parse/worker' instead of
// being discovered from disk at runtime. On Vercel a file that is only found by a
// dynamic path is not traced into the serverless bundle, which works on localhost
// and fails after deploy; a static import is traced like any other module.
let workerReady = false
async function ensureWorker() {
  if (workerReady || typeof pdfParseModule.PDFParse?.setWorker !== 'function') return
  workerReady = true
  try {
    const { getData } = await import('pdf-parse/worker')
    pdfParseModule.PDFParse.setWorker(getData())
  } catch (err) {
    // Not fatal: PDF.js falls back to locating its own worker.
    console.warn(`[pdf] could not preload the PDF worker: ${err.message}`)
  }
}

// v1 shapes only. v2 has no callable export, so this is undefined there.
const legacyFn = [pdfParseModule.pdfParse, pdfParseModule.parse, pdfParseModule.default].find(
  (fn) => typeof fn === 'function',
)

/**
 * Extract plain text from a PDF buffer.
 * @param {Buffer} buffer
 * @returns {Promise<string>}
 */
export async function extractPdfText(buffer) {
  const { PDFParse } = pdfParseModule

  if (typeof PDFParse === 'function') {
    await ensureWorker()

    // PDF.js wants a plain Uint8Array, and it takes ownership of the memory it is
    // given - so hand it a copy rather than multer's own Buffer.
    const parser = new PDFParse({ data: new Uint8Array(buffer) })
    try {
      const result = await parser.getText({ pageJoiner: '\n' })
      return typeof result === 'string' ? result : (result?.text ?? '')
    } finally {
      // Always release the document, or every upload leaks a PDF.js instance.
      await parser.destroy().catch(() => {})
    }
  }

  if (legacyFn) {
    const result = await legacyFn(buffer)
    return typeof result === 'string' ? result : (result?.text ?? '')
  }

  throw new Error('pdf-parse exposed neither PDFParse nor a callable export - check its installed version.')
}
