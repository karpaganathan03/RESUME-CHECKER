// Real-PDF tests. The other suites only ever sent fake PDFs, which is how a
// completely broken PDF reader once passed every test: "not a PDF" and "reader
// is broken" both produced the same 422. These build a genuine PDF in memory and
// push it through the reader and the whole /api/parse route.
//
// Run from backend/:  node --test test/pdf.test.js

import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import app from '../server.js'
import { extractPdfText } from '../services/pdf.service.js'
import { closeDB } from '../database/connection.js'

/** A minimal but valid one-page PDF whose text layer holds `lines`. */
function makePdf(lines) {
  const escape = (t) => t.replace(/[\\()]/g, '\\$&')
  const stream =
    'BT /F1 11 Tf 14 TL 50 740 Td\n' + lines.map((l) => `(${escape(l)}) Tj T*`).join('\n') + '\nET'
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ]
  let pdf = '%PDF-1.4\n'
  const offsets = []
  objects.forEach((body, i) => {
    offsets.push(pdf.length)
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`
  })
  const xref = pdf.length
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  offsets.forEach((o) => {
    pdf += `${String(o).padStart(10, '0')} 00000 n \n`
  })
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`
  return Buffer.from(pdf, 'latin1')
}

const RESUME_LINES = [
  'Jane Doe',
  'jane.doe@example.com | +1 415 555 0134',
  'Full Stack Developer',
  'Built React and Node.js apps with TypeScript and JavaScript.',
  'Designed REST APIs with MongoDB and PostgreSQL. Wrote C++ services.',
  'Reduced page load time by 45% and served 20000 users.',
  'Used Docker, Git, AWS and CI/CD pipelines. Wrote Testing suites.',
]

const JD = `Full Stack Engineer
We need React, Node.js, TypeScript, Docker, Kubernetes and GraphQL experience.`

let server
let base

before(async () => {
  server = app.listen(0)
  await new Promise((resolve) => server.once('listening', resolve))
  base = `http://127.0.0.1:${server.address().port}`
})

after(async () => {
  await closeDB()
  if (server) await new Promise((resolve) => server.close(resolve))
})

test('extractPdfText reads the text out of a real PDF', async () => {
  const text = await extractPdfText(makePdf(RESUME_LINES))
  assert.match(text, /Jane Doe/)
  assert.match(text, /React and Node\.js/)
  assert.match(text, /45%/)
})

test('extractPdfText rejects bytes that are not a PDF', async () => {
  await assert.rejects(() => extractPdfText(Buffer.from('%PDF-1.4 not really')))
})

test('POST /api/parse scores a real PDF against a job description', async () => {
  const form = new FormData()
  form.append('resume', new Blob([makePdf(RESUME_LINES)], { type: 'application/pdf' }), 'resume.pdf')
  form.append('jobDescription', JD)

  const res = await fetch(`${base}/api/parse`, { method: 'POST', body: form })
  assert.equal(res.status, 201)

  const body = await res.json()
  assert.equal(body.engine, 'heuristic')
  assert.ok(Number.isInteger(body.score) && body.score > 0 && body.score <= 100)

  // On the resume and in the JD:
  for (const skill of ['React', 'Node.js', 'TypeScript', 'Docker']) {
    assert.ok(body.present.includes(skill), `${skill} should be present`)
  }
  // In the JD, not on the resume - the "missing" half of the feature:
  for (const skill of ['Kubernetes', 'GraphQL']) {
    assert.ok(body.missing.includes(skill), `${skill} should be missing`)
  }
  assert.equal(body.role, 'Full Stack Engineer')
  assert.ok(body.checks.length >= 4)
})

test('a PDF with no text layer is a 422 with a readable message', async () => {
  const form = new FormData()
  form.append('resume', new Blob([makePdf([])], { type: 'application/pdf' }), 'blank.pdf')

  const res = await fetch(`${base}/api/parse`, { method: 'POST', body: form })
  assert.equal(res.status, 422)
  assert.match((await res.json()).error, /readable text|PDF/i)
})

test('aliases and symbol-heavy names match: JS, Postgres, C++, K8s', async () => {
  const { scoreResume } = await import('../services/scoring.service.js')
  const resume = 'Wrote JS and C++ services on Postgres, deployed to K8s. Email a@b.co. '.repeat(4)
  const jd = 'Engineer\nJavaScript, C++, PostgreSQL, Kubernetes and Rust required.'
  const result = scoreResume(resume, jd)

  assert.deepEqual(result.present.sort(), ['C++', 'JavaScript', 'Kubernetes', 'PostgreSQL'].sort())
  assert.deepEqual(result.missing, ['Rust'])
})

test('substring look-alikes still do not match', async () => {
  const { scoreResume } = await import('../services/scoring.service.js')
  const resume = 'Digital marketing with JavaScript and MySQL. Contact a@b.co. '.repeat(4)
  const jd = 'Engineer\nGit, Java, SQL and JavaScript'
  const result = scoreResume(resume, jd)

  assert.ok(result.present.includes('JavaScript'))
  for (const wrong of ['Git', 'Java', 'SQL']) {
    assert.ok(!result.present.includes(wrong), `${wrong} must not match`)
  }
})

test('an alias is not read out of a dotted name: "JS" inside "Node.js"', async () => {
  const { targetSkills } = await import('../services/scoring.service.js')
  const wanted = targetSkills('Engineer\nReact.js, Node.js and Vue.js experience, plus .NET').map((e) => e.split('|')[0].trim())

  assert.ok(wanted.includes('React'))
  assert.ok(wanted.includes('Node.js'))
  assert.ok(wanted.includes('Vue'))
  assert.ok(wanted.includes('.NET'))
  assert.ok(!wanted.includes('JavaScript'), 'JavaScript was never asked for')
})
