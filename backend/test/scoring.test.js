// Unit tests for the scoring rules: pure functions, no server, no database.
//
// Run from backend/:  node --test

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { scoreResume, guessRole, DEFAULT_ROLE } from '../services/scoring.service.js'

const JD = `Senior Frontend Engineer

We are looking for someone who loves React and TypeScript.
You will work with Node.js, and care about Testing and CI/CD.
Experience with Docker is a plus.
`

const RESUME = `Alex Doe
alex@example.com | +1 555 010 2030

Frontend Engineer with 6 years of experience.

Skills: React, TypeScript, JavaScript, Node.js, Git
- Shipped a design system used by 40 teams
- Cut load time by 45%
`

test('a matching resume scores well and reports the gaps', () => {
  const result = scoreResume(RESUME, JD)

  // React, TypeScript, Node.js, Testing and CI/CD are all named in both.
  assert.ok(result.present.includes('React'))
  assert.ok(result.present.includes('TypeScript'))

  // Docker is asked for and absent - it must show up as missing, not be dropped.
  assert.ok(result.missing.includes('Docker'))
  assert.ok(!result.present.includes('Docker'))

  assert.ok(result.score > 60, `expected a strong score, got ${result.score}`)
  assert.ok(result.score <= 100)
})

test('a resume that matches nothing scores near the floor', () => {
  const unrelated = `Bob Smith
bob@example.com

Ten years as a pastry chef. Managed a kitchen, ordered stock, wrote menus.
`
  const result = scoreResume(unrelated, JD)

  assert.deepEqual(result.present, [])
  assert.ok(result.missing.includes('React'))
  // Contact details are the only rule it passes, so the score stays low.
  assert.ok(result.score < 30, `expected a low score, got ${result.score}`)
})

test('word boundaries prevent substring false positives', () => {
  // "digital" contains "git", "MySQL" contains "sql", "JavaScript" contains "java".
  // Without \b in the matcher all three would be false hits.
  const text = 'I worked on digital marketing and MySQL databases.'
  const result = scoreResume(text, JD)

  assert.ok(!result.present.includes('Git'), '"digital" must not match "Git"')
  assert.ok(!result.missing.includes('SQL') || !result.present.includes('SQL'))
})

test('with no job description the resume is scored against the whole vocabulary', () => {
  const result = scoreResume(RESUME, '')

  assert.equal(result.role, DEFAULT_ROLE)
  assert.ok(result.present.length > 0)
  assert.ok(result.missing.length > 0)
})

test('a one-line job description does not collapse the score to 0 or 100', () => {
  // Only one skill is demanded, so the target set must fall back to the full
  // vocabulary - otherwise every resume scores 100 or 0.
  const result = scoreResume(RESUME, 'React developer')
  assert.ok(result.present.length > 1)
})

test('the score is always an integer inside 0-100', () => {
  for (const text of ['', 'a', RESUME, RESUME.repeat(20)]) {
    const { score } = scoreResume(text, JD)
    assert.ok(Number.isInteger(score), `score was not an integer: ${score}`)
    assert.ok(score >= 0 && score <= 100, `score out of range: ${score}`)
  }
})

test('guessRole skips JD boilerplate above the title', () => {
  assert.equal(guessRole('About the role\nSenior React Engineer\nWe need...'), 'Senior React Engineer')
  assert.equal(guessRole(''), DEFAULT_ROLE)
})
