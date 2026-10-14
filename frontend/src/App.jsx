import { useRef, useState } from 'react'
import { parseResume as callApi, hasApi, API_BASE } from './lib/api.js'
import { scoreLocally } from './lib/scoring.js'

// Shared by the controller and the UI so a mismatch cannot drift.
const MAX_FILE_MB = 5

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

        // A reached-but-failed backend is worth surfacing; fall back meanwhile.
        setNotice(`${response.error} Showing the offline estimate.`)
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
        <span className="badge">0 to shipped</span>
        <h1>Resume Parser</h1>
        <p>Upload a PDF resume and paste the job description. You get a match score, the skills you have, and the ones you are missing.</p>
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
        {result && result.engine === 'ai' ? 'Scored by labd AI, reviewed against the built-in rules.' : 'Scored by the built-in rules. Add LABD_API_KEY to enable the AI verdict.'}
      </footer>
    </div>
  )
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
