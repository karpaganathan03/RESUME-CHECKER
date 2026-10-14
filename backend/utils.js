// Small helpers with no home of their own.

/** An Error carrying an HTTP status, so the error handler knows what to reply. */
export function httpError(status, message) {
  const err = new Error(message)
  err.status = status
  return err
}

/** Escape a string so it can be dropped into a RegExp as literal text. */
export function escapeRegex(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Collapse runs of whitespace, which is how most PDF extractors arrive. */
export function normalizeText(text) {
  return String(text || '')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/**
 * Which of `skills` appear as whole words in `text`.
 *
 * The word boundary matters: without it "Git" matches "digital", "Java" matches
 * "JavaScript", and "SQL" matches "MySQL" - the classic false positives in naive
 * keyword scoring.
 */
export function findSkills(text, skills) {
  const haystack = String(text || '').toLowerCase()
  if (!haystack) return []
  return skills.filter((skill) =>
    new RegExp(`\\b${escapeRegex(skill.toLowerCase())}\\b`).test(haystack),
  )
}

/** Is this upload plausibly a PDF? */
export function isPdf({ mimetype, originalname }) {
  if (mimetype === 'application/pdf') return true
  // Some browsers and OSes leave mimetype empty (drag from a network drive, or
  // a file with no registry entry) - fall back to the extension.
  if (!mimetype || mimetype === 'application/octet-stream') {
    return /\.pdf$/i.test(originalname || '')
  }
  return false
}
