// Keep the per-project copies of the skill list in step with the source of truth.
//
// Why copies exist at all, rather than one shared file imported by both sides:
// Vite refuses to import files from outside frontend/ in dev, and the serverless
// function only ships what it can trace from backend/. A ../shared/ import works
// in one place and breaks in another - the worst possible ordering for that
// failure. So the data is duplicated on purpose, and this script makes keeping
// it identical automatic: `npm run build` runs it, and `npm test` fails if the
// copies have drifted.
//
// Run: npm run sync:skills
//      npm run check:skills   (exits non-zero if anything has drifted)

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, relative } from 'node:path'

// This file lives in <root>/scripts/, so the root is one level up.
const root = dirname(dirname(fileURLToPath(import.meta.url)))

const SOURCE = join(root, 'shared', 'skills.txt')
const TARGETS = [
  join(root, 'backend', 'skills.txt'),
  join(root, 'frontend', 'src', 'lib', 'skills.txt'),
]

// shared/skills.txt explains the arrangement in prose at the top. Only the part
// from the first "# ---" heading on is data, and only that part is copied.
function dataSection(raw) {
  const lines = raw.split(/\r?\n/)
  const start = lines.findIndex((line) => line.trim().startsWith('# ---'))
  const body = start === -1 ? lines : lines.slice(start)
  return body.join('\n').trim() + '\n'
}

const check = process.argv.includes('--check')
const generated = dataSection(readFileSync(SOURCE, 'utf8'))
let drifted = false

for (const target of TARGETS) {
  const label = relative(root, target).split('\\').join('/')

  let current = null
  try {
    current = readFileSync(target, 'utf8')
  } catch {
    // A missing file counts as drift, and is fixed by the write below.
  }

  if (current === generated) {
    console.log(`ok    ${label}`)
    continue
  }

  drifted = true
  if (check) {
    console.error(`DRIFT ${label}`)
    continue
  }

  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(target, generated)
  console.log(`wrote ${label}`)
}

if (drifted && check) {
  console.error('\nSkill lists have drifted from shared/skills.txt. Run: npm run sync:skills')
  process.exit(1)
}
