// The single place the frontend talks to the backend.
//
// The frontend and the API are deployed as ONE Vercel project: the root
// vercel.json rewrites /api/* to backend/server.js. So the browser calls the API
// on its own origin, no cross-origin request happens, and no CORS applies.
//
// VITE_API_URL is therefore an override, not a requirement. Leave it unset for
// the normal case, where a relative "/api/parse" reaches the rewrite in
// production and the Vite proxy in development (see vite.config.js). Set it to
// an absolute URL only if the API genuinely lives somewhere else.

// Empty string means same-origin, which is a valid base - not "no backend".
const ORIGIN = (import.meta.env.VITE_API_URL || '').replace(/\/+$/, '')

// Every call is built from this. For the same-origin case it is "/api", so a
// request goes to "/api/parse" and never "/api/api/parse".
const API_ROOT = `${ORIGIN}/api`

/** Shown in the UI so the active backend is visible at a glance. */
export const API_BASE = ORIGIN || 'same-origin'

// Kept as a named export because App.jsx reads it. It stays true: "/api" is a
// real path in every deployment of this project, so the UI should always try the
// API. If the backend is down the request fails and the caller falls back to
// offline scoring, which App.jsx already handles.
export const hasApi = true

const OFFLINE_HINT = 'The backend was not reachable, so these numbers are the offline estimate.'

/**
 * Send a resume + JD and get a score back. The timeout at the call site has to
 * outlast the SERVER's own patience: with a labd key set, /api/parse waits up to
 * LABD_TIMEOUT_MS (45s) for labd before falling back to the keyword score, so a
 * shorter client timeout would throw away an answer that was about to arrive.
 *
 * @param {{ file: File, jobDescription: string, signal?: AbortSignal, timeoutMs?: number }} args
 * @returns {Promise<{ ok: true, data: object } | { ok: false, error: string }>}
 */
export async function parseResume({ file, jobDescription, signal, timeoutMs = 60000 }) {
  const form = new FormData()
  // The field names must match what upload.single() and the controller read.
  form.append('resume', file)
  form.append('jobDescription', jobDescription || '')

  // Own controller so a timeout can abort the request without waiting on the
  // caller's signal to fire.
  const timer = new AbortController()
  const onAbort = () => timer.abort()
  signal?.addEventListener('abort', onAbort)
  const timeout = setTimeout(() => timer.abort(), timeoutMs)

  try {
    const res = await fetch(`${API_ROOT}/parse`, {
      method: 'POST',
      body: form,
      signal: timer.signal,
    })

    // A 502/504 from a serverless function is usually a cold start or a crashed
    // function, and its body is often HTML rather than JSON - so parse
    // defensively instead of letting res.json() throw.
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
