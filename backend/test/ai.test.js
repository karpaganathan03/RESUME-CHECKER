// Tests for the labd AI layer and the merge with the built-in score.
//
// Nothing here makes a network call. The interesting behaviour in this module is
// all in the failure paths - a model wrapping JSON in prose, returning a score of
// 140, returning prose with no JSON at all, or the endpoint being down - and
// those are exactly the cases that are hard to trigger against a live service and
// trivial to test directly.
//
// Run from backend/:  node --test test/ai.test.js

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { extractReplyText, parseJsonReply, validateAiScore } from '../services/ai.service.js'
import { mergeResults } from '../controllers/score.controller.js'
import { scoreResume } from '../services/scoring.service.js'

const JD = `Senior Frontend Engineer

We need React, TypeScript, Node.js, Testing, CI/CD and Docker.
`

const RESUME = `Alex Doe
alex@example.com

Frontend Engineer, 6 years.
Skills: React, TypeScript, Node.js
- Cut load time by 45%
`

// --- extractReplyText ------------------------------------------------------

test('extractReplyText handles the common response envelopes', () => {
  assert.equal(extractReplyText({ reply: 'hello' }), 'hello')
  assert.equal(extractReplyText({ content: 'hello' }), 'hello')
  assert.equal(extractReplyText({ message: { content: 'hello' } }), 'hello')
  assert.equal(extractReplyText({ choices: [{ message: { content: 'hello' } }] }), 'hello')
  // Anthropic-style content blocks.
  assert.equal(extractReplyText({ content: [{ text: 'he' }, { text: 'llo' }] }), 'hello')
  // Unknown shape must be empty, not a crash.
  assert.equal(extractReplyText({ somethingElse: 1 }), '')
  assert.equal(extractReplyText(null), '')
})

// --- parseJsonReply -------------------------------------------------------

test('parseJsonReply reads a bare JSON object', () => {
  const parsed = parseJsonReply('{"score": 72, "summary": "ok"}')
  assert.equal(parsed.score, 72)
})

test('parseJsonReply digs JSON out of a markdown fence', () => {
  // The single most common real-world failure: the model ignores "JSON only" and
  // wraps the object in a fence. This must not be treated as a broken reply.
  const reply = 'Here is the result:\n```json\n{"score": 80, "summary": "good"}\n```\nHope that helps!'
  const parsed = parseJsonReply(reply)
  assert.equal(parsed.score, 80)
})

test('parseJsonReply reads JSON surrounded by prose with no fence', () => {
  const parsed = parseJsonReply('Sure! {"score": 55, "present": ["React"]} Let me know.')
  assert.equal(parsed.score, 55)
})

test('parseJsonReply returns null when there is no JSON at all', () => {
  assert.equal(parseJsonReply('I cannot help with that.'), null)
  assert.equal(parseJsonReply(''), null)
  assert.equal(parseJsonReply(null), null)
})

// --- validateAiScore ------------------------------------------------------

test('validateAiScore clamps a score out of range instead of rejecting it', () => {
  // A model returning 140 is sloppy, not adversarial; a clamped 100 is still the
  // right answer, and discarding the whole reply would be wasteful.
  assert.equal(validateAiScore({ score: 140, summary: 'x' }).score, 100)
  assert.equal(validateAiScore({ score: -20, summary: 'x' }).score, 0)
  assert.equal(validateAiScore({ score: 87.6, summary: 'x' }).score, 88)
})

test('validateAiScore rejects a reply with no usable score', () => {
  assert.equal(validateAiScore(null), null)
  assert.equal(validateAiScore({ summary: 'no score here' }), null)
  assert.equal(validateAiScore({ score: 'high' }), null)
})

test('validateAiScore rejects a score with no supporting detail', () => {
  // A number on its own is less useful than the built-in breakdown, so it is
  // treated as no answer rather than replacing a real one.
  assert.equal(validateAiScore({ score: 70 }), null)
})

test('validateAiScore accepts the camelCase aliases and cleans the arrays', () => {
  const result = validateAiScore({
    score: 70,
    skillsPresent: ['React', 'React', ' TypeScript '],
    skillsMissing: ['Docker'],
    summary: 'A verdict.',
  })

  assert.deepEqual(result.present, ['React', 'TypeScript'])
  assert.deepEqual(result.missing, ['Docker'])
  assert.equal(result.summary, 'A verdict.')
})

test('validateAiScore drops non-strings from the skill arrays', () => {
  const result = validateAiScore({ score: 60, present: ['React', 42, null, { a: 1 }], summary: 's' })
  assert.deepEqual(result.present, ['React'])
})

// --- mergeResults ---------------------------------------------------------

const heuristicFor = (resume = RESUME, jd = JD) => scoreResume(resume, jd)

test('with no AI result the built-in score passes through untouched', () => {
  const heuristic = heuristicFor()
  const merged = mergeResults({ heuristic, ai: null })

  assert.equal(merged.score, heuristic.score)
  assert.equal(merged.engine, 'heuristic')
  assert.equal(merged.aiSummary, null)
  assert.deepEqual(merged.checks, heuristic.checks)
})

test('an AI result replaces the score and adds a summary', () => {
  const heuristic = heuristicFor()
  const merged = mergeResults({
    heuristic,
    ai: { score: 91, summary: 'Strong match.', present: ['React', 'TypeScript'], missing: ['Docker'] },
  })

  assert.equal(merged.score, 91)
  assert.equal(merged.engine, 'ai')
  assert.equal(merged.aiSummary, 'Strong match.')
  assert.deepEqual(merged.present, ['React', 'TypeScript'])
  assert.deepEqual(merged.missing, ['Docker'])
})

test('the role and the text-level checks stay ours, not the model\'s', () => {
  const heuristic = heuristicFor()
  const merged = mergeResults({
    heuristic,
    ai: { score: 50, summary: null, present: ['React'], missing: ['Docker'] },
  })

  // The role comes from the JD either way.
  assert.equal(merged.role, heuristic.role)

  // Contact details / measurable impact / length are exact checks on the text, so
  // they must keep their original verdicts even though the skill list moved.
  const byLabel = Object.fromEntries(merged.checks.map((c) => [c.label, c.pass]))
  const original = Object.fromEntries(heuristic.checks.map((c) => [c.label, c.pass]))
  assert.equal(byLabel['Contact details found'], original['Contact details found'])
  assert.equal(
    byLabel['Measurable impact in bullet points'],
    original['Measurable impact in bullet points'],
  )
  assert.equal(byLabel['Resume text is a sensible length'], original['Resume text is a sensible length'])
})

test('empty AI skill arrays do not blank out a correct breakdown', () => {
  const heuristic = heuristicFor()
  const merged = mergeResults({
    heuristic,
    ai: { score: 80, summary: 'Good.', present: [], missing: [] },
  })

  // The score is still the AI's, but the breakdown falls back rather than
  // rendering two empty columns.
  assert.equal(merged.score, 80)
  assert.deepEqual(merged.present, heuristic.present)
  assert.deepEqual(merged.missing, heuristic.missing)
})

test('the merged score is always a valid integer in range', () => {
  const heuristic = heuristicFor()
  for (const score of [0, 55, 100]) {
    const merged = mergeResults({ heuristic, ai: { score, summary: 's', present: ['React'], missing: [] } })
    assert.ok(Number.isInteger(merged.score))
    assert.ok(merged.score >= 0 && merged.score <= 100)
  }
})
