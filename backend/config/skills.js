// Loads the skill vocabulary for the backend.
//
// It reads backend/skills.txt - a file inside backend/ - and not
// shared/skills.txt. The serverless function ships what it can trace from
// backend/ (vercel.json lists skills.txt under includeFiles), so a read that
// reaches above that folder would work on localhost and fail after deploy.
//
// Lines look like "Postgres | PostgreSQL | pg": the first name is canonical, the
// rest are aliases. See shared/skills.txt.
//
// shared/skills.txt is the copy a human edits, and `npm run sync:skills` copies
// it here. One source of truth, one mechanical copy step, and nothing at build
// time that has to resolve across project roots.
//
// The matching helpers (findSkills, escapeRegex) live in ../utils.js, so this
// module has exactly one job: turn skills.txt into an array.

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url)) // -> backend/config
const SKILLS_FILE = join(here, '..', 'skills.txt') // -> backend/skills.txt

// Used only if the text file is missing entirely, so a stripped-down deploy
// still scores instead of returning a 500 on every request.
const FALLBACK = [
  'JavaScript',
  'TypeScript',
  'React',
  'Node.js',
  'Python',
  'SQL',
  'Docker',
  'AWS',
  'Git',
  'REST APIs',
  'Testing',
  'CI/CD',
]

// What a resume is judged against when the job description names too few skills
// to be a fair target. Scoring a resume against the ENTIRE vocabulary (130+
// skills across every field) would cap every score near zero, so this short
// general-purpose set stands in instead.
export const CORE_SKILLS = [
  'JavaScript', 'TypeScript', 'React', 'Node.js', 'Python', 'SQL',
  'Docker', 'AWS', 'Git', 'REST APIs', 'Testing', 'CI/CD',
]

let cached = null

/** Blank lines and lines starting with # are comments, not skills. */
export function parseSkillLines(raw) {
  return String(raw)
    .split(/\r?\n/) // handles CRLF and LF alike
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'))
}

/** The core subset, as full vocabulary lines (aliases included). */
export function loadCoreSkills() {
  const wanted = new Set(CORE_SKILLS.map((n) => n.toLowerCase()))
  const core = loadSkillVocabulary().filter((line) =>
    wanted.has(line.split('|')[0].trim().toLowerCase()),
  )
  return core.length > 0 ? core : loadSkillVocabulary()
}

/** @returns {string[]} the skill vocabulary, cached for the life of the process */
export function loadSkillVocabulary() {
  if (cached) return cached
  try {
    const skills = parseSkillLines(readFileSync(SKILLS_FILE, 'utf8'))
    cached = skills.length > 0 ? skills : FALLBACK
  } catch (err) {
    console.warn(`[skills] could not read ${SKILLS_FILE}, using the built-in list: ${err.message}`)
    cached = FALLBACK
  }
  return cached
}
