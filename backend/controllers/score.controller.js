// The upload endpoint: PDF + job description in, score out.
//
// Two scorers are involved, and the order matters:
//
//   1. scoreResume() always runs. It is pure, instant, and cannot fail - it is
//      the floor the answer is built on.
//   2. scoreWithAI() runs when a labd key is configured. It reviews the resume
//      against the same skill list and returns a score, a written verdict, and
//      a corrected skills breakdown.
//
// The AI result is preferred when it arrives, and the built-in result is used
// whenever it does not. That is the whole reliability story: a rate limit, a
// timeout, or a malformed reply costs the learner a nicer answer, never the
// answer itself.

import path from 'node:path'
import { Score } from '../database/models/score.model.js'
import { extractPdfText } from '../services/pdf.service.js'
import { scoreResume, buildChecks } from '../services/scoring.service.js'
import { scoreWithAI, aiEnabled } from '../services/ai.service.js'
import { connectDB, isDbConnected } from '../database/connection.js'
import { httpError, isPdf, normalizeText } from '../utils.js'
import { MAX_FILE_MB } from '../middleware/upload.middleware.js'

const MAX_JD_CHARS = 20000

/**
 * Combine the AI verdict with the built-in pass.
 *
 * Written as a pure function so it can be reasoned about and tested on its own:
 * given the same two inputs it always produces the same answer, and it never
 * throws on a partial AI result.
 */
export function mergeResults({ heuristic, ai }) {
  // No usable AI answer - the built-in result stands as-is.
  if (!ai) {
    return {
      score: heuristic.score,
      role: heuristic.role,
      present: heuristic.present,
      missing: heuristic.missing,
      checks: heuristic.checks,
      aiSummary: null,
      engine: 'heuristic',
    }
  }

  // Trust the AI's skill lists only when it actually returned some. A reply with
  // a good score and empty arrays should not blank out a correct breakdown.
  const useAiSkills = ai.present.length > 0 || ai.missing.length > 0
  const present = useAiSkills ? ai.present : heuristic.present
  const missing = useAiSkills
    ? ai.missing.length > 0
      ? ai.missing
      : heuristic.missing
    : heuristic.missing

  // The checklist is rebuilt rather than taken from the model: contact details,
  // measurable impact and resume length are things we can check exactly, and a
  // model's opinion about them is worse than a regex's. The skill-match rule does
  // move, because it now counts the AI's list.
  const targetCount = present.length + missing.length
  const checks = buildChecks({
    role: heuristic.role,
    present,
    signals: { ...heuristic.signals, targetCount },
  })

  return {
    // The AI's number replaces the heuristic one - that is the point of the AI
    // step. It has already been clamped to 0-100 and checked to be a number.
    score: ai.score,
    role: heuristic.role,
    present,
    missing,
    checks,
    aiSummary: ai.summary,
    engine: 'ai',
  }
}

/**
 * POST /api/parse
 * multipart/form-data: resume (PDF, file), jobDescription (string, optional)
 */
export async function parseResume(req, res, next) {
  try {
    if (!req.file) {
      throw httpError(400, 'No resume was uploaded. Send the file in a field named "resume".')
    }
    if (!isPdf(req.file)) {
      throw httpError(415, 'The resume must be a PDF.')
    }
    if (req.file.size === 0) {
      throw httpError(400, 'The uploaded file is empty.')
    }

    const jobDescription = String(req.body?.jobDescription ?? '')
    if (jobDescription.length > MAX_JD_CHARS) {
      throw httpError(413, `That job description is too long (${MAX_JD_CHARS} characters max).`)
    }

    // multer with memoryStorage gives a Buffer, so there is no temp file to clean
    // up and nothing to leak on disk.
    let resumeText = ''
    try {
      resumeText = normalizeText(await extractPdfText(req.file.buffer))
    } catch (err) {
      // A scanned or password-protected PDF is a user problem, not a 500.
      throw httpError(422, `Could not read text from that PDF: ${err.message}`)
    }

    if (resumeText.length < 50) {
      throw httpError(
        422,
        'No readable text found in that PDF. If it is a scan or a photo, export it as a text-based PDF first.',
      )
    }

    const heuristic = scoreResume(resumeText, jobDescription)

    // The AI call is awaited but never allowed to fail the request: scoreWithAI
    // returns null on every error path rather than throwing.
    const ai = await scoreWithAI({
      resumeText,
      jobDescription: jobDescription.trim(),
      heuristic: { score: heuristic.score, missing: heuristic.missing },
    })

    const merged = mergeResults({ heuristic, ai })

    // Persisting is best-effort on purpose: the learner asked for a score, and a
    // database hiccup must not take that away from them.
    let saved = null
    try {
      await connectDB()
      saved = await Score.create({
        // basename strips any path a crafted filename might carry.
        fileName: path.basename(req.file.originalname || 'resume.pdf'),
        fileSize: req.file.size,
        role: merged.role,
        score: merged.score,
        present: merged.present,
        missing: merged.missing,
        checks: merged.checks,
        jobDescriptionExcerpt: jobDescription.slice(0, 500),
        engine: merged.engine,
        aiSummary: merged.aiSummary,
      })
    } catch (dbErr) {
      console.warn('[parse] could not save the score:', dbErr.message)
    }

    res.status(201).json({
      id: saved?._id?.toString() ?? null,
      fileName: req.file.originalname,
      fileSize: req.file.size,
      role: merged.role,
      score: merged.score,
      present: merged.present,
      missing: merged.missing,
      checks: merged.checks,
      aiSummary: merged.aiSummary,
      engine: merged.engine,
      aiEnabled,
      persisted: Boolean(saved),
      createdAt: saved?.createdAt ?? new Date().toISOString(),
    })
  } catch (err) {
    next(err)
  }
}

/** GET /api/scores - recent results, newest first. */
export async function listScores(req, res, next) {
  try {
    // Parse, then clamp, then default. `?limit=abc` and `?limit=9999` both have
    // to become something safe rather than NaN or an unbounded query.
    const requested = Number.parseInt(req.query.limit, 10)
    const limit = Number.isFinite(requested) ? Math.min(Math.max(requested, 1), 50) : 10

    if (!isDbConnected()) {
      try {
        await connectDB()
      } catch {
        return res.json({ scores: [], persisted: false })
      }
    }

    const scores = await Score.find({}).sort({ createdAt: -1 }).limit(limit).lean()
    res.json({ scores, persisted: true })
  } catch (err) {
    next(err)
  }
}

export { MAX_FILE_MB }
