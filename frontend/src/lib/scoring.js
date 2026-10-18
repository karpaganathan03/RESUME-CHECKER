// Offline DEMO scoring for the ATS Checker.
//
// The backend is the real path. This module is the fallback the UI uses when no
// VITE_API_URL is set, or when the API cannot be reached, so the app still works
// with no server, no database and no API key - which covers the "mock design"
// stage of the brief and makes a fresh clone runnable.
//
// IMPORTANT: this does NOT read the PDF. It only fingerprints the file name and
// size, so its numbers are a placeholder for the demo, never a real ATS result.
// The UI labels it that way. Real scoring happens on the backend.
//
// Scoring is deterministic: the same resume and the same job description always
// produce the same numbers, fingerprinted from the file name/size and the JD.
// Returning a fresh random score on every render is what makes a mock look
// broken in a demo.
//
// skills.txt is generated from shared/skills.txt by `npm run sync:skills`.
// The ?raw suffix tells Vite to inline the file as a string at build time, so
// this works with no fetch and no filesystem access in the browser.

import skillsRaw from './skills.txt?raw'

/**
 * Blank lines and lines starting with # are comments. A line is
 * "Canonical | alias | alias": the first name is shown, any spelling matches.
 */
function parseSkills(raw) {
  return String(raw)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'))
    .map((line) => {
      const spellings = line.split('|').map((n) => n.trim()).filter(Boolean)
      return { name: spellings[0], spellings }
    })
}

const VOCABULARY = parseSkills(skillsRaw)
const CORE = ['JavaScript', 'TypeScript', 'React', 'Node.js', 'Python', 'SQL', 'Docker', 'AWS', 'Git', 'REST APIs', 'Testing', 'CI/CD']
const CORE_ENTRIES = VOCABULARY.filter((entry) => CORE.includes(entry.name))

export const ALL_SKILLS = VOCABULARY.map((entry) => entry.name)

// Used when the caller has no job description to compare against.
const FALLBACK_ROLE = 'Frontend Engineer'

function seedFrom(...parts) {
  const key = parts.filter(Boolean).join('|')
  let hash = 0
  for (let i = 0; i < key.length; i += 1) {
    hash = (hash * 31 + key.charCodeAt(i)) % 100000
  }
  return hash
}

function escapeRegex(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// Lookarounds rather than \b, so "C++" and ".NET" match, while "Git" still does
// not match "digital" and "SQL" does not match "MySQL".
function mentions(text, entry) {
  const haystack = String(text).toLowerCase()
  return entry.spellings.some((spelling) =>
    new RegExp(`(?<![a-z0-9_])(?<![a-z0-9_]\\.)${escapeRegex(spelling.toLowerCase())}(?![a-z0-9_])`).test(haystack),
  )
}

// First short, non-sentence line - usually the job title at the top of a JD.
function guessRole(jobDescription) {
  const line = String(jobDescription || '')
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l.length > 0 && l.length < 70 && !l.endsWith('.'))
  return line || FALLBACK_ROLE
}

/**
 * Score a resume against a job description, entirely client-side.
 *
 * @param {{name: string, size: number}} file
 * @param {string} jobDescription
 */
export function scoreLocally(file, jobDescription) {
  const seed = seedFrom(file.name, String(file.size), jobDescription)

  const demanded = VOCABULARY.filter((entry) => mentions(jobDescription || '', entry))
  // With no JD (or too short a one) the short core set is the target. The < 3
  // guard avoids a 0-or-100 score against a single skill.
  const targets = (demanded.length >= 3 ? demanded : CORE_ENTRIES).map((entry) => entry.name)

  // Deterministic subset, so a resume always has both hits and gaps to show.
  const present = targets.filter((_, i) => (seed >> i % 12) % 4 !== 0)
  const safePresent = present.length >= 1 ? present : [targets[0]]
  const missing = targets.filter((skill) => !safePresent.includes(skill))

  const score = Math.round((safePresent.length / targets.length) * 100)
  const role = jobDescription && jobDescription.trim() ? guessRole(jobDescription) : FALLBACK_ROLE

  return {
    fileName: file.name,
    fileSize: file.size,
    role,
    score,
    present: safePresent,
    missing,
    checks: [
      { label: 'Contact details found', pass: true },
      { label: `Matched at least 60% of ${role}'s skills`, pass: score >= 60 },
      { label: 'Measurable impact in bullet points', pass: score >= 75 },
      { label: 'One page or less', pass: file.size < 300_000 },
    ],
    source: 'offline',
    aiSummary: null,
    engine: 'offline',
  }
}
