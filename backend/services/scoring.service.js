// The scoring rules.
//
// Today this is deterministic keyword matching: a resume and a JD are compared
// against the vocabulary in skills.txt. There is no AI call, which is
// deliberate - the AI comparison is a later step, and this layer is written so
// it can be extended without touching the controller or the response shape.
//
// Everything here is pure: text in, result out, no network, no database. That
// makes this the cheap part to unit test, and it is where the AI step will graft
// on later.

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
// 100, so the score is not only skill matching.
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
 * Score extracted resume text against a job description.
 *
 * @param {string} resumeText
 * @param {string} jobDescription
 * @returns {{ score: number, role: string, present: string[], missing: string[], checks: {label: string, pass: boolean}[] }}
 */
export function scoreResume(resumeText, jobDescription) {
  const vocabulary = loadSkillVocabulary()
  const jd = String(jobDescription || '').trim()
  const role = jd ? guessRole(jd) : DEFAULT_ROLE

  // Which skills are we judging against?
  //   - With a JD: the skills the JD asks for.
  //   - Without one: the whole vocabulary, so a resume is scored on its own.
  // The "< 3" guard stops a one-line JD ("we use React") from producing a
  // meaningless 0-or-100 score against a single skill.
  const demanded = findSkills(jd, vocabulary)
  const targets = demanded.length >= 3 ? demanded : vocabulary

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

  const score = Math.round(100 * weighted)

  return {
    score: Math.max(0, Math.min(100, score)),
    role,
    present,
    missing,
    checks: [
      { label: 'Contact details found', pass: hasContact },
      { label: `Matched at least 60% of ${role}'s skills`, pass: skillMatch >= 0.6 },
      { label: 'Measurable impact in bullet points', pass: hasQuantifiedImpact },
      { label: 'Resume text is a sensible length', pass: lengthOk },
      {
        label: `Compared against ${targets.length} skill${targets.length === 1 ? '' : 's'}`,
        pass: targets.length > 0,
      },
    ],
  }
}
