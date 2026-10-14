// The single place the frontend talks to the backend.
//
// VITE_API_URL comes from .env.local, e.g. VITE_API_URL=http://localhost:5000.
// Note the VITE_ prefix: Vite only exposes env vars that start with it, so a
// variable without the prefix is defined but reads as undefined in the browser.
//
// This module only ever calls paths under /api, never a bare /health or /parse.
// That is deliberate: the routes must live under the same prefix the Vercel
// rewrites use, or every proxied request 404s in production while working fine
// on localhost.

const RAW_BASE = import.meta.env.VITE_API_URL || ''
export const API_BASE = RAW_BASE.replace(/\/+$/, '')

/** Is a backend configured at all? */
export const hasApi = API_BASE.length > 0

const OFFLINE_HINT = 'The backend was not reachable, so these numbers are the offline estimate.'

/**
 * Send a resume + JD and get a score back.
 *
 * @param {{ file: File, jobDescription: string, signal?: AbortSignal, timeoutMs?: number }} args
 * @returns {Promise<{ ok: true, data: object, offline?: string } | { ok: false, error: string }>}
 */
export async function parseResume({ file, jobDescription, signal, timeoutMs = 20000 }) {
  if (!hasApi) return { ok: false, error: 'No VITE_API_URL is configured.' }

  const form = new FormData()
  // The field names must match what upload.single() and the controller read.
  form.append('resume', file)
  form.append('jobDescription', jobDescription || '')

  // The learner never sees this value, so never build a message that includes it.
  const timer = new AbortController()
  const onAbort = () => timer.abort()
  signal?.addEventListener('abort', onAbort)
  const timeout = setTimeout(() => timer.abort(), timeoutMs)

  try {
    const res = await fetch(`${API_BASE}/api/parse`, {
      method: 'POST',
      body: form,
      signal: timer.signal,
    })

    // A 502/504 from a serverless function is usually CORS or a cold start, and
    // its body is often HTML rather than JSON - so parse defensively.
    const payload = await res.json().catch(() => null)

    if (!res.ok) {
      return { ok: false, error: payload?.error || `Request failed (${res.status}).` }
    }
    if (!payload || typeof payload.score !== 'number') {
      return { ok: false, error: 'The server replied in a shape the UI cannot read.' }
    }
    return { ok: true, data: payload }
  } catch (err) {
    if (signal?.aborted) return { ok: false, error: 'Cancelled.' }
    if (err?.name === 'AbortError') return { ok: false, error: 'The server took too long to answer.' }
    return { ok: false, error: OFFLINE_HINT }
  } finally {
    clearTimeout(timeout)
    signal?.removeEventListener('abort', onAbort)
  }
}
