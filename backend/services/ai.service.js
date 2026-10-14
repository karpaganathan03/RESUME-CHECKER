// Optional AI comparison, not wired up yet.
//
// Exists as a seam: the controller calls `summarizeGap()` today, gets null, and
// the response carries aiSummary: null. When the key arrives, only this file
// changes - no route, controller or response shape moves.

import { AI_API_KEY } from '../config/env.js'

export const aiEnabled = Boolean(AI_API_KEY)

/**
 * Plain-language comment on the gap between a resume and a JD.
 *
 * @returns {Promise<string|null>} null whenever the AI step is off or fails -
 * the heuristic score is always the answer, and AI is decoration on top of it.
 */
export async function summarizeGap({ resumeText, jobDescription, missing }) {
  if (!aiEnabled) return null

  try {
    // The real call goes here once the provider is chosen, e.g.
    //   const res = await fetch(..., { headers: { Authorization: `Bearer ${AI_API_KEY}` } })
    // Deliberately left unimplemented rather than guessed at: a half-written
    // call to an unknown provider is worse than an obvious gap.
    void resumeText
    void jobDescription
    void missing
    return null
  } catch {
    // A failed AI step must never fail the request.
    return null
  }
}
