# 0 to shipped - Resume Parser

Upload a resume PDF, paste a job description, get a match score out of 100, the
skills present on the resume, and the skills missing from it.

Scoring runs twice, and the built-in pass is the floor. A deterministic keyword
pass always scores the resume; with `LABD_API_KEY` set, labd reviews the same
resume against the same job description and its score, skills and written verdict
replace the keyword ones. With no key the app behaves exactly as before, which is
why nothing here needs an API key to run or to test.

**One deployable.** Express serves the API *and* the built React UI from the same
process, on the same origin. There is no second Vercel project, no CORS, and no
cross-origin URL to keep in sync.

## Structure

```
package.json        root scripts: build, start, test, sync:skills
vercel.json         the single deploy config: install, build, /api rewrite

backend/          the API and the web server - Express, MongoDB
  database/       Database: the connection and the models, together
    connection.js   cached mongoose connection
    models/         one file per collection
  server.js       Server: builds the app, serves the API and the built UI
  routes/         path -> controller
  controllers/    request in, response out
  services/       the actual work (PDF text, scoring, labd AI)
  config/         env vars, the skill vocabulary loader
  middleware/     CORS, uploads, error handling
  utils.js        small shared helpers
  test/           node:test suites

frontend/         the UI - React + Vite, built into frontend/dist
  src/
    App.jsx         the page: upload, job description, report
    lib/api.js      the only place the backend is called
    lib/scoring.js  offline scoring, used when the API is unreachable
    lib/skills.txt  generated - do not edit

shared/skills.txt   the one skill vocabulary both sides use
scripts/            sync-skills.mjs - copies shared/ into each project
```

## The flow

Read the project in this order: it runs the same way.

**backend → Database → Server → Frontend**

1. **backend/** is the deployable app. It is the only thing that talks to
   MongoDB; nothing above the database layer imports mongoose directly.
2. **Database/** (`backend/database/`) is the connection and the models. The
   connection is cached on `globalThis`, because a serverless function reuses one
   warm instance for many requests and reconnecting per request exhausts Atlas.
3. **Server/** (`backend/server.js`) mounts the API under `/api`, then serves
   `frontend/dist` and falls back to `index.html` for client-side routes.
4. **Frontend/** calls `/api` relatively. Because one server answers both, the
   request is same-origin and CORS never applies.

The mount order in step 3 is load-bearing: the API is registered **before** the
static handler. Reversed, an unknown `/api` path would return the SPA's HTML and
the UI would report "the server replied in a shape the UI cannot read".
`backend/test/static.test.js` exists to keep that true.

## Running it

Development runs two processes for fast reloads - Vite for the UI, Node for the
API. Production runs one.

```bash
npm run install:all

# terminal 1
npm --prefix backend run dev     # API on http://localhost:5000

# terminal 2
npm --prefix frontend run dev    # UI on http://localhost:5173, proxying /api
```

To run exactly what deploys - one process, one port:

```bash
npm run build     # builds the UI into frontend/dist
npm start         # http://localhost:5000 serves the UI and the API
```

With no `MONGODB_URI` the server still starts and scores resumes; the result just
is not saved. If the API is unreachable the UI falls back to scoring in the
browser, which is the original "mock design" behaviour.

Config:

```bash
cp backend/example.env backend/.env
```

## The skill list

The vocabulary lives once, in `shared/skills.txt`. It cannot be imported directly
by both projects, because Vercel builds the two from separate roots and a build
cannot resolve a file above its own root - so a `../shared/` import works locally
and breaks in the deploy. It is copied instead:

```bash
npm run sync:skills    # write the copies
npm run check:skills   # fail if they have drifted - use this in CI
```

Edit `shared/skills.txt`, then run the sync. Do not edit the generated copies.

## API

| Method | Path          | Purpose                                       |
| ------ | ------------- | --------------------------------------------- |
| GET    | `/api/health` | Liveness. No database, no PDF library.         |
| POST   | `/api/parse`  | Multipart: `resume` (PDF), `jobDescription`.   |
| GET    | `/api/scores` | Recent results, `?limit=` up to 50.            |

Everything is mounted under `/api`, and it has to stay that way: the rewrite in
the root `vercel.json` only sends `/api/*` to the app, and the frontend calls
`/api/...` relative paths.

`POST /api/parse` returns 201 with the score, `present`, `missing`, `checks`,
`engine` (`heuristic` or `ai`) and `aiSummary` (null unless the labd key is set).
It returns 415 for a non-PDF, 413 for a file over 5 MB, and 422 for a PDF with no
extractable text - a scan or an image, which is a user problem rather than a
server error.

Storage is deliberate: the score and the matched skills are saved, the resume
text and the raw PDF are not. A resume is full of personal data, and keeping text
we do not need turns a scoring app into a liability.

## Tests

```bash
npm test
```

- `backend/test/scoring.test.js` - the scoring rules, pure functions
- `backend/test/api.test.js` - HTTP behaviour and the pdf-parse import shape
- `backend/test/ai.test.js` - the labd reply parsing, validation and the merge
  with the built-in score; no network calls
- `backend/test/static.test.js` - one server serves the UI and the API; skips
  itself when `frontend/dist` does not exist yet

## Deploying to Vercel (one project)

Import the repository as a **single** Vercel project with the **root directory**
left at the repo root. `vercel.json` then handles everything:

- `installCommand` installs both `frontend/` and `backend/`
- `buildCommand` builds the UI into `frontend/dist`
- `outputDirectory` is that folder
- the rewrite sends `/api/*` to `backend/server.js`, which Vercel runs as a
  serverless function

Environment variables (Vercel dashboard, not a committed file):

- `MONGODB_URI` - **required**
- `CLIENT_ORIGINS` - **optional now**. Only needed if something on a different
  origin calls the API. Comma-separated, no trailing slash, because a trailing
  slash never matches the `Origin` header the browser sends.
- `LABD_API_KEY` - optional. Absent, every resume is scored by the built-in
  keyword pass. Set, labd adds the score, the written verdict and a corrected
  skill breakdown, and the request is merely slow rather than broken if labd is
  unreachable or rate-limited. Made at learn.thedevlabs.io/settings#api-keys.
  `AI_API_KEY` is still read as a fallback.

The server refuses to boot in production without `MONGODB_URI`, so a missing
database fails loudly at boot rather than on the first request.

Do **not** set `VITE_API_URL` for this setup. Leave it unset so the UI calls
`/api` on its own origin.

## The labd AI step

`backend/services/ai.service.js` calls labd at
`https://agent.thedevlabs.io/v1/api/chat` with the resume text, the job
description and the keyword pass's own result.

Two rules shape that call. **The key stays on the server**: the browser calls our
own `/api/parse`, and the key is attached only to the outbound labd request - it
is never a `VITE_` variable, because Vite inlines those into the JS bundle anyone
can read. And **the AI is an enhancement, not a dependency**: no key, a timeout,
a rate limit, prose instead of JSON or a score of 140 all fall back to the
built-in result rather than failing the request. The reply is untrusted text, so
it is parsed defensively and validated field by field before it reaches the
database or the UI.

Contact details, measurable impact and resume length are checked by regex and keep
their verdicts even when labd answers - those are exact questions a model has no
advantage on. Only the score, the skills and the verdict come from labd.

Optional overrides: `LABD_API_URL`, `LABD_MODEL` (the endpoint's own default is
the right choice), and `LABD_TIMEOUT_MS` (45000 - generous, because a slow answer
still beats no answer, as long as we do not hang forever).

## Not built yet

Rate limiting on uploads is stubbed with a TODO in `server.js`. Parsing a PDF,
calling labd and writing to the database is real work - and `/api/parse` is where
an anonymous visitor spends your labd allowance - so a public deploy should not
accept that unmetered.

## Line endings

Every file was committed as CRLF, which puts a `^M` at the end of every line,
makes diffs noisy, and breaks shell scripts and Docker contexts in ways that are
hard to trace back. `.gitattributes` fixes it going forward (`* text=auto eol=lf`,
with `*.bat` kept on CRLF because cmd.exe needs it).

To normalise what is already there, once, with a clean working tree:

```bash
git add --renormalize .
git status
```

Check `git status` before committing - that command can touch every file in the
repo, and you want to see what it did. A `.vscode/settings.json` with
`"files.eol": "\n"` stops new files from arriving as CRLF in the first place.
