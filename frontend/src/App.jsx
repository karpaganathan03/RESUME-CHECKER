import { useRef, useState } from 'react'
import { parseResume as callApi, hasApi, API_BASE } from './lib/api.js'
import { scoreLocally } from './lib/scoring.js'

// Must match MAX_FILE_MB in backend/middleware/upload.middleware.js. It is 4, not
// 5, because Vercel rejects request bodies over ~4.5 MB before Express sees them.
const MAX_FILE_MB = 4

export default function App() {
  const [file, setFile] = useState(null)
  const [jobDescription, setJobDescription] = useState('')
  const [result, setResult] = useState(null)
  const [dragging, setDragging] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const inputRef = useRef(null)
  const abortRef = useRef(null)
  // Tracks how many results are already in flight, so a slow earlier request
  // cannot overwrite a newer one that came back first (a race).
  const runIdRef = useRef(0)

  function accept(candidate) {
    setError('')
    setNotice('')
    if (!candidate) return

    // The mime type can be empty for files picked from a network drive or on
    // some platforms, so fall back to the extension rather than rejecting them.
    const looksPdf = candidate.type ? candidate.type === 'application/pdf' : /\.pdf$/i.test(candidate.name)
    if (!looksPdf) {
      setError(`${candidate.name} is not a PDF.`)
      return
    }
    if (candidate.size > MAX_FILE_MB * 1024 * 1024) {
      setError(`${candidate.name} is larger than ${MAX_FILE_MB} MB.`)
      return
    }

    setFile(candidate)
    setResult(null)
  }

  function onDrop(event) {
    event.preventDefault()
    setDragging(false)
    accept(event.dataTransfer.files?.[0])
  }

  async function score() {
    if (!file) {
      setError('Choose a PDF first.')
      return
    }

    // Cancel a previous run, and stamp this one so its result is the only one
    // allowed to land.
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    const runId = (runIdRef.current += 1)

    setBusy(true)
    setError('')
    setNotice('')

    try {
      if (hasApi) {
        const response = await callApi({
          file,
          jobDescription,
          signal: controller.signal,
        })

        if (runId !== runIdRef.current) return // superseded by a newer run

        if (response.ok) {
          setResult({ ...response.data, source: 'api' })
          return
        }

        if (response.error === 'Cancelled.') return

        // The backend answered and said no ("not a PDF", "no readable text"). That
        // is a real answer: show it. Inventing a score here would hide the cause.
        if (!response.unreachable) {
          setError(response.error)
          return
        }

        // Only a backend that cannot be reached at all falls back to the demo.
        setNotice(`${response.error} Showing a demo estimate instead.`)
      }

      const local = scoreLocally(file, jobDescription)
      if (runId === runIdRef.current) setResult(local)
    } finally {
      if (runId === runIdRef.current) setBusy(false)
    }
  }

  function reset() {
    abortRef.current?.abort()
    runIdRef.current += 1
    setFile(null)
    setJobDescription('')
    setResult(null)
    setError('')
    setNotice('')
    setBusy(false)
    if (inputRef.current) inputRef.current.value = ''
  }

  return (
    <div className="page">
      <header className="hero">
        <span className="badge">Applicant Tracking System</span>
        <h1>ATS Checker</h1>
        <p>Upload your PDF resume and paste the job description. You get an ATS match score, the skills your resume has, and the ones it is missing.</p>
      </header>

      <main className="card">
        {!result && (
          <>
            <div
              className={dragging ? 'dropzone dragging' : 'dropzone'}
              onDragOver={(e) => {
                e.preventDefault()
                setDragging(true)
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={onDrop}
            >
              <p className="dropzone-title">Drop your resume here</p>
              <p className="dropzone-sub">PDF only, up to {MAX_FILE_MB} MB</p>
              <button className="btn" type="button" onClick={() => inputRef.current?.click()}>
                Choose a PDF
              </button>
              <input
                ref={inputRef}
                className="sr-only"
                type="file"
                accept="application/pdf"
                onChange={(e) => accept(e.target.files?.[0])}
              />
              {file && !error && <p className="dropzone-sub">Selected: {file.name}</p>}
            </div>

            <label className="field">
              <span className="field-label">Job description</span>
              <textarea
                className="textarea"
                rows={8}
                placeholder="Paste the job description here to compare your resume against it."
                value={jobDescription}
                onChange={(e) => setJobDescription(e.target.value)}
              />
            </label>

            {error && <p className="error">{error}</p>}
            {notice && <p className="notice">{notice}</p>}

            <div className="actions">
              <button className="btn" type="button" onClick={score} disabled={busy || !file}>
                {busy ? 'Scoring...' : 'Score my resume'}
              </button>
              <span className="hint">
                {hasApi ? `Backend: ${API_BASE}` : 'No backend configured - scoring happens offline.'}
              </span>
            </div>
          </>
        )}

        {result && (
          <section className="report">
            <div className="report-head">
              <div>
                <p className="eyebrow">Scored for {result.role}</p>
                <h2>{result.fileName}</h2>
              </div>
              <button className="btn ghost" type="button" onClick={reset}>
                Score another
              </button>
            </div>

            <div className="score-row">
              <ScoreDial score={result.score} />
              <ul className="checks">
                {result.checks.map((check) => (
                  <li key={check.label} className={check.pass ? 'pass' : 'fail'}>
                    <span aria-hidden="true">{check.pass ? '\u2713' : '\u2715'}</span> {check.label}
                  </li>
                ))}
              </ul>
            </div>

            {result.source === 'offline' && (
              <p className="notice">
                Demo estimate: the backend could not be reached, so this score is a placeholder
                and is <strong>not</strong> based on what your resume says. Start the server and
                try again for a real result.
              </p>
            )}

            {result.aiSummary && (
              <div className="verdict">
                <h3>AI verdict</h3>
                <p>{result.aiSummary}</p>
              </div>
            )}

            <div className="skills">
              <SkillList title="Skills present" tone="good" items={result.present} />
              <SkillList title="Skills missing" tone="bad" items={result.missing} />
            </div>
          </section>
        )}
      </main>

      <footer className="foot">
        {footerText(result)}
      </footer>
    </div>
  )
}

function footerText(result) {
  if (!result) return 'Your resume is read on the server and the PDF itself is never stored.'
  if (result.source === 'offline') return 'Demo estimate only. Nothing was read from your PDF.'
  const saved = result.persisted ? ' Result saved.' : ''
  if (result.engine === 'ai') return `Scored by labd AI, checked against the built-in ATS rules.${saved}`
  return `Scored by the built-in ATS rules. Set LABD_API_KEY on the server to add the AI verdict.${saved}`
}

function ScoreDial({ score }) {
  const tone = score >= 75 ? 'high' : score >= 50 ? 'mid' : 'low'
  return (
    <div className={`dial ${tone}`} style={{ '--score': score }}>
      <span className="dial-value">{score}</span>
      <span className="dial-label">out of 100</span>
    </div>
  )
}

function SkillList({ title, tone, items }) {
  return (
    <div className={tone === 'good' ? 'skill-col good' : 'skill-col bad'}>
      <h3>{title}</h3>
      {items.length === 0 ? (
        <p className="empty">None.</p>
      ) : (
        <ul className="chips">
          {items.map((skill) => (
            <li key={skill}>{skill}</li>
          ))}
        </ul>
      )}
    </div>
  )
}
