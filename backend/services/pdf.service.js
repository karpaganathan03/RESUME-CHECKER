// Reads text out of an uploaded PDF.
//
// pdf-parse has shipped two very different module shapes. v1 was a callable
// CommonJS function; v2 is ESM with a named export. Importing the wrong one
// fails at request time with "pdfParse is not a function", which is a confusing
// error to meet in production, so the shape is resolved once here.

import * as pdfParseModule from 'pdf-parse'

const candidates = [
  pdfParseModule.pdfParse,
  pdfParseModule.parse,
  pdfParseModule.default,
  pdfParseModule,
]

const extract = candidates.find((fn) => typeof fn === 'function')

/**
 * Extract plain text from a PDF buffer.
 * @param {Buffer} buffer
 * @returns {Promise<string>}
 */
export async function extractPdfText(buffer) {
  if (!extract) {
    throw new Error('pdf-parse did not expose a callable export - check its installed version.')
  }

  const result = await extract(buffer)

  // v2 returns { text, total, ... }; be forgiving about a bare string too.
  if (typeof result === 'string') return result
  return result?.text ?? ''
}
