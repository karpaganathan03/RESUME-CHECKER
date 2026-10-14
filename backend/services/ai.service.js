// The labd AI step: read the resume against the job description and return a
// score plus a plain-language verdict.
//
// Design rules that matter more than the prompt itself:
//
// 1. The key never leaves this process. It is attached to the outbound request
//    only, and never appears in a response, a log line, or an error message.
// 2. The AI is an ENHANCEMENT, not a dependency. Every failure path returns null
//    and the caller falls back to the built-in rules, so a rate limit, a timeout
//    or a malformed reply degrades the score rather than breaking the request.
// 3. The reply is untrusted text. It is parsed defensively and validated field by
//    field before anything from it reaches the database or the UI.

import { LABD_API_KEY, LABD_API_URL, LABD_MODEL, LABD_TIMEOUT_MS } from '../config/env.js'

export const aiEnabled = Boolean(LABD_API_KEY)

// Token control. A resume is ~2 pages and a JD is rarely longer; sending more
// than this costs money and slows the request without improving the answer.
const MAX_RESUME_CHARS = 12000
const MAX_JD_CHARS = 8000

function clip(text, max) {
  const value = String(text || '')
  if (value.length <= max) return value
  return `${value.slice(0, max)}\n\n[truncated]`
}

/**
 * Pull the assistant's text out of whatever shape the endpoint replies with.
 *
 * A generic client, because the exact envelope is the one thing most likely to
 * differ between deployments: OpenAI-style choices, a bare content string, or a
 * content array all appear in the wild. Returning "" rather than throwing keeps
 * the caller's fallback path simple.
 */
export function extractReplyText(payload) {
  if (!payload) return ''
  if (typeof payload === 'string') return payload
  if (typeof payload.reply === 'string') return payload.reply
  if (typeof payload.content === 'string') return payload.content
  if (typeof payload.message?.content === 'string') return payload.message.content

  // Anthropic-style: content is an array of blocks.
  if (Array.isArray(payload.content)) {
    return payload.content
      .map((block) => (typeof block === 'string' ? block : block?.text || ''))
      .join('')
  }

  // OpenAI-style: choices[0].message.content
  const choice = payload.choices?.[0]
  if (typeof choice?.message?.content === 'string') return choice.message.content
  if (typeof choice?.text === 'string') return choice.text

  return ''
}

/**
 * Read the first JSON object out of a model reply.
 *
 * Models wrap JSON in prose or a ```json fence even when told not to, so the
 * braces are located rather than the whole string being trusted. Returns null
 * when there is no usable object, which the caller treats as "no AI answer".
 */
export function parseJsonReply(text) {
  const raw = String(text || '').trim()
  if (!raw) return null

  // Try the whole string first - the common case when the model obeys.
  try {
    return JSON.parse(raw)
  } catch {
    // Fall through to the slice-out approach below.
  }

  // Strip a fenced block if there is one, then take the outermost {...}.
  const withoutFence = raw.replace(/```(?:json)?/gi, '')
  const start = withoutFence.indexOf('{')
  const end = withoutFence.lastIndexOf('}')
  if (start === -1 || end === -1 || end <= start) return null

  try {
    return JSON.parse(withoutFence.slice(start, end + 1))
  } catch {
    return null
  }
}

/** Keep only strings, trimmed, de-duplicated, with a sane cap. */
function cleanStringArray(value, max = 30) {
  if (!Array.isArray(value)) return []
  const seen = new Set()
  const out = []
  for (const item of value) {
    if (typeof item !== 'string') continue
    const trimmed = item.trim()
    if (!trimmed || seen.has(trimmed.toLowerCase())) continue
    seen.add(trimmed.toLowerCase())
    out.push(trimmed)
    if (out.length >= max) break
  }
  return out
}

/**
 * Validate a parsed AI reply against the shape the controller needs.
 *
 * Every field is optional and independently checked, so a reply that gets the
 * score right but the skills wrong is still useful. Returns null when there is
 * nothing usable at all.
 */
export function validateAiScore(parsed) {
  if (!parsed || typeof parsed !== 'object') return null

  const rawScore = Number(parsed.score)
  if (!Number.isFinite(rawScore)) return null

  // Clamp rather than reject: a model returning 87.5 or 105 is being sloppy, not
  // adversarial, and a clamped score is still the right answer.
  const score = Math.max(0, Math.min(100, Math.round(rawScore)))

  const summary =
    typeof parsed.summary === 'string' && parsed.summary.trim()
      ? parsed.summary.trim().slice(0, 1200)
      : null

  const present = cleanStringArray(parsed.present ?? parsed.skillsPresent)
  const missing = cleanStringArray(parsed.missing ?? parsed.skillsMissing)

  // A reply with only a score and no detail is still worth using, but not if it
  // has nothing at all beyond the number - then the heuristic is more useful.
  if (!summary && present.length === 0 && missing.length === 0) return null

  return { score, summary, present, missing }
}

/** The instruction sent to the model. Kept here so it is easy to review. */
function buildMessages({ resumeText, jobDescription, heuristic }) {
  const system =
    'You are a meticulous technical recruiter. You compare a candidate resume ' +
    'with a job description and reply with STRICT JSON only - no prose, no ' +
    'markdown fences. The JSON object must have exactly these keys: ' +
    '"score" (integer 0-100, how well the resume matches the role), ' +
    '"present" (array of the job description\'s important skills found on the resume), ' +
    '"missing" (array of its important skills NOT on the resume), and ' +
    '"summary" (2-4 sentences: the strongest match, the biggest gap, and one ' +
    'concrete improvement). Judge only from the text provided. Never invent ' +
    'experience the resume does not show.'

  const user = [
    'JOB DESCRIPTION:',
    clip(jobDescription || '(none provided)', MAX_JD_CHARS),
    '',
    'RESUME:',
    clip(resumeText, MAX_RESUME_CHARS),
    '',
    // Giving the deterministic result as a starting point measurably steadies the
    // score, and makes the AI a reviewer of the rules rather than a blind guess.
    `A keyword pass already scored this ${heuristic?.score ?? 'unknown'}/100, ` +
      `with these skills missing: ${(heuristic?.missing || []).join(', ') || 'none'}. ` +
      'Use that as a starting point, correct it where the resume text says otherwise, ' +
      'and reply with the JSON object only.',
  ].join('\n')

  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ]
}

/**
 * Ask labd to score the resume.
 *
 * @returns {Promise<{score: number, summary: string|null, present: string[], missing: string[]}|null>}
 *   null whenever the AI is off, unreachable, too slow, or replies with
 *   something unusable - never throws.
 */
export async function scoreWithAI({ resumeText, jobDescription, heuristic }) {
  if (!aiEnabled) return null

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), LABD_TIMEOUT_MS)

  try {
    const body = { messages: buildMessages({ resumeText, jobDescription, heuristic }) }
    if (LABD_MODEL) body.model = LABD_MODEL

    const res = await fetch(LABD_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${LABD_API_KEY}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    })

    if (!res.ok) {
      // Status only. The response body could echo request data, and the key is
      // never included in any message we write.
      console.warn(`[ai] labd replied ${res.status}; using the built-in score`)
      return null
    }

    const payload = await res.json().catch(() => null)
    const text = extractReplyText(payload)
    const parsed = parseJsonReply(text)
    const validated = validateAiScore(parsed)

    if (!validated) {
      console.warn('[ai] labd reply was not usable; using the built-in score')
      return null
    }
    return validated
  } catch (err) {
    const reason = err?.name === 'AbortError' ? 'timed out' : err?.message
    console.warn(`[ai] labd call failed (${reason}); using the built-in score`)
    return null
  } finally {
    clearTimeout(timeout)
  }
}

// Kept for the old call site's name, so nothing else has to change at once.
export const summarizeGap = scoreWithAI
