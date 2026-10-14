// The scoring rules.
//
// This is the deterministic keyword pass: a resume and a JD are compared against
// the vocabulary in skills.txt. It runs on every request, including the ones
// where labd AI also answers, because it is the floor the AI result is merged
// onto. If the AI is off, unreachable, or replies with nonsense, this is what
// the learner gets.
//
// Everything here is pure: text in, result out, no network, no database. That
// makes it the cheap part to unit test.

import { findSkills } from '../utils.js'
import { loadSkillVocabulary } from '../config/skills.js'

export const DEFAULT_ROLE = 'Software Engineer'

// Lines that appear above the job title in a pasted JD ("About the role",
// "Remote"), so the first line is not automatically the role.
const ROLE_NOISE = /^(about|job|role|position|location|remote|hybrid|full[- ]time|contract|we are|our )/i

// How much each input counts towards the final 0-100. These sum to 1, which is
// what keeps the score naturally in range and each rule independently testable.
export const WEIGHTS = {
  skills: 0.65,
  contact: 0.15,
  impact: 0.1,
  length: 0.1,
}

// A resume with every keyword and no way to contact its author should not score
// 100, so skill matching is not the whole score.
const EMAIL = /[\w.+-]+@[\w-]+\.[\w.]+/
const PHONE = /(\+?\d[\d\s().-]{7,}\d)/
// The trailing \b belongs on each word alternative, not after the group: a "%"
// is not a word character, so /\d+\s*(%|...)\b/ can never match "45%" at all.
const QUANTIFIED = /\b\d+\s*(?:%|percent\b|x\b|users\b|customers\b|requests\b|ms\b|hours\b|days\b|weeks\b)/i

/** Pull a plausible job title out of the job description. */
export function guessRole(jobDescription) {
  const lines = String(jobDescription || '')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 2 && l.length <= 70)

  const title = lines.find((l) => !l.endsWith('.') && !ROLE_NOISE.test(l) && /[a-z]/.test(l))
  return title || DEFAULT_ROLE
}

/**
 * Which skills the resume is judged against.
 *
 * Exported because the AI prompt is given the same list: the AI should review
 * the same comparison the rules made, or the two answers are not comparable.
 */
export function targetSkills(jobDescription) {
  const vocabulary = loadSkillVocabulary()
  const demanded = findSkills(String(jobDescription || ''), vocabulary)
  // The "< 3" guard stops a one-line JD ("we use React") from producing a
  // meaningless 0-or-100 score against a single skill.
  return demanded.length >= 3 ? demanded : vocabulary
}

/**
 * The checklist shown next to the score.
 *
 * Separate from scoreResume because the controller rebuilds it after an AI reply
 * replaces the skill lists: the contact/impact/length rules come from the resume
 * text and do not change, but the skill-match rule has to be recalculated.
 */
export function buildChecks({ role, present, signals }) {
  const { hasContact, hasQuantifiedImpact, lengthOk, targetCount } = signals
  const skillMatch = targetCount ? present.length / targetCount : 0

  return [
    { label: 'Contact details found', pass: hasContact },
    { label: `Matched at least 60% of ${role}'s skills`, pass: skillMatch >= 0.6 },
    { label: 'Measurable impact in bullet points', pass: hasQuantifiedImpact },
    { label: 'Resume text is a sensible length', pass: lengthOk },
    {
      label: `Compared against ${targetCount} skill${targetCount === 1 ? '' : 's'}`,
      pass: targetCount > 0,
    },
  ]
}

/**
 * Score extracted resume text against a job description with the built-in rules.
 *
 * @param {string} resumeText
 * @param {string} jobDescription
 * @returns {{ score: number, role: string, present: string[], missing: string[], checks: object[], signals: object }}
 */
export function scoreResume(resumeText, jobDescription) {
  const jd = String(jobDescription || '').trim()
  const role = jd ? guessRole(jd) : DEFAULT_ROLE

  const targets = targetSkills(jd)
  const present = findSkills(resumeText, targets)
  const missing = targets.filter((skill) => !present.includes(skill))

  const skillMatch = targets.length ? present.length / targets.length : 0
  const hasContact = EMAIL.test(resumeText) || PHONE.test(resumeText)
  const hasQuantifiedImpact = QUANTIFIED.test(resumeText)
  const lengthOk = resumeText.length > 200 && resumeText.length < 6000

  const weighted =
    WEIGHTS.skills * skillMatch +
    WEIGHTS.contact * (hasContact ? 1 : 0) +
    WEIGHTS.impact * (hasQuantifiedImpact ? 1 : 0) +
    WEIGHTS.length * (lengthOk ? 1 : 0)

  const score = Math.max(0, Math.min(100, Math.round(100 * weighted)))

  const signals = {
    hasContact,
    hasQuantifiedImpact,
    lengthOk,
    targetCount: targets.length,
  }

  return {
    score,
    role,
    present,
    missing,
    checks: buildChecks({ role, present, signals }),
    // Used by the controller, not sent to the client.
    signals,
  }
}
