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
 * Split a vocabulary line - "Postgres | PostgreSQL | pg" style - into its
 * canonical name (the first entry) and every spelling that counts as a match.
 */
export function parseSkillEntry(entry) {
  const names = String(entry)
    .split('|')
    .map((n) => n.trim())
    .filter(Boolean)
  return { name: names[0] || '', spellings: names }
}

/** The name the report shows for a vocabulary line. */
export function canonicalSkill(entry) {
  return parseSkillEntry(entry).name
}

/**
 * Does `haystack` (already lower-cased) contain `spelling` as a whole term?
 *
 * \b is the obvious tool and the wrong one: it only exists between a word
 * character and a non-word character, so it can never match around the "+" in
 * "C++", the "#" in "C#", or the leading "." in ".NET". Lookarounds say what is
 * actually meant - "not glued to another letter or digit on either side", and
 * not the tail of a dotted name (so the alias "JS" does not fire inside
 * "Node.js") - and still reject "Git" in "digital", "Java" in "JavaScript" and "SQL" in "MySQL".
 */
function containsTerm(haystack, spelling) {
  const term = escapeRegex(spelling.toLowerCase())
  return new RegExp(`(?<![a-z0-9_])(?<![a-z0-9_]\\.)${term}(?![a-z0-9_])`).test(haystack)
}

/**
 * The vocabulary lines (aliases intact) that `text` mentions. Callers that go on
 * to match again - the resume against the job description's skills - need the
 * full lines back, not just the display names.
 */
export function matchingEntries(text, skills) {
  const haystack = String(text || '').toLowerCase()
  if (!haystack) return []
  return skills.filter((entry) =>
    parseSkillEntry(entry).spellings.some((s) => containsTerm(haystack, s)),
  )
}

/**
 * Which of `skills` appear in `text`, returned by canonical name.
 * Each entry may carry aliases ("JavaScript | JS"); any one of them counts.
 */
export function findSkills(text, skills) {
  return matchingEntries(text, skills).map(canonicalSkill)
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
