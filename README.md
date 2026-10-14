# 0 to shipped - Resume Parser

Upload a resume PDF, paste a job description, get a match score out of 100, the
skills present on the resume, and the skills missing from it.

The AI comparison is a later step. Today the score comes from deterministic
keyword matching, so the whole thing runs with no API key and no AI cost.

## Structure

```
backend/          the API - Express, MongoDB
  database/       Database: the connection and the models, together
    connection.js   cached mongoose connection
    models/         one file per collection
  server.js       Server: builds the Express app, starts the listener
  routes/         path -> controller
  controllers/    request in, response out
  services/       the actual work (PDF text, scoring, AI seam)
  config/         env vars, the skill vocabulary loader
  middleware/     CORS, uploads, error handling
  utils.js        small shared helpers
  test/           node:test suites

frontend/         the UI - React + Vite
  src/
    App.jsx         the page: upload, job description, report
    lib/api.js      the only place the backend is called
    lib/scoring.js  offline scoring, used when there is no backend
    lib/skills.txt  generated - do not edit

shared/skills.txt   the one skill vocabulary both sides use
scripts/            sync-skills.mjs - copies shared/ into each project
```

## The flow

Read the project in this order: it runs the same way.

**backend → Database → Server → Frontend**

1. **backend/** is the deployable API. It is the only thing that talks to
   MongoDB. Nothing above the database layer imports mongoose directly.
2. **Database/** (`backend/database/`) is the connection and the models. The
   connection is cached on `globalThis`, because a serverless function reuses one
   warm instance for many requests and reconnecting per request exhausts Atlas.
3. **Server/** (`backend/server.js`) builds the Express app and mounts every
   route under `/api`. It exports the app for Vercel and only binds a port when
   run directly.
4. **Frontend/** calls it. `VITE_API_URL` decides where; unset means it scores in
   the browser and works with no backend at all.

## Running it

```bash
npm run install:all            # installs frontend/ and backend/

npm --prefix backend run dev   # API on http://localhost:5000
npm --prefix frontend run dev  # UI  on http://localhost:5173
```

With no configuration the frontend still works - it scores in the browser and
says so on the page. That is the "mock design" stage: no server, no database, no
API key. Point `VITE_API_URL` at the backend to switch to real PDF parsing.

Copy an env example to start configuring:

```bash
cp backend/example.env backend/.env
cp frontend/example.env frontend/.env.local
```

## The skill list

The vocabulary lives once, in `shared/skills.txt`. It cannot be imported directly
by both projects, because Vercel deploys `frontend/` and `backend/` from two
separate roots, and a build cannot resolve a file above its own root - so a
`../shared/` import works locally and breaks in production, which is the worst
possible ordering. It is copied instead:

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

Everything is mounted under `/api`, and it has to stay that way: the frontend
calls `/api/...` and the Vercel rewrite only proxies `/api/*`, so a route at a
bare `/health` would answer on localhost and 404 in production.

`POST /api/parse` returns 201 with the score, `present`, `missing`, `checks` and
`aiSummary` (null until the AI step is wired up). It returns 415 for a non-PDF,
413 for a file over 5 MB, and 422 for a PDF with no extractable text - a scan or
an image, which is a user problem rather than a server error.

Storage is deliberate: the score and the matched skills are saved, the resume
text and the raw PDF are not. A resume is full of personal data, and keeping text
we do not need turns a scoring app into a liability.

## Tests

```bash
npm --prefix backend test
```

Pure scoring rules in `backend/test/scoring.test.js`, and HTTP behaviour plus the
pdf-parse import shape in `backend/test/api.test.js`.

## Deploying to Vercel (two projects)

**Backend** - root directory `backend`. Environment variables:

- `MONGODB_URI` - required
- `CLIENT_ORIGINS` - required, comma-separated, **no trailing slash**. A trailing
  slash never matches the `Origin` header the browser sends, and the failure
  looks like a mystery CORS error with a config that reads correctly.
- `AI_API_KEY` - optional, leave unset for now

The server refuses to boot in production without `MONGODB_URI` and
`CLIENT_ORIGINS`, so a bad config fails immediately instead of on the first
request.

**Frontend** - root directory `frontend`. Set `frontend/vercel.json`'s rewrite
`destination` to your backend URL, and `VITE_API_URL=/api` so the browser calls
same-origin and no CORS applies at all.

That rewrite is the piece to get right: `VITE_API_URL=/api` plus the rewrite
means one code path in dev and in production. Pointing `VITE_API_URL` straight at
the backend URL also works, but then CORS is load-bearing and `CLIENT_ORIGINS`
has to be exactly right.

## Not built yet

The AI comparison. `backend/services/ai.service.js` is a seam that returns null,
so the response already carries `aiSummary` - filling it in touches that one file
and no route, controller or response shape.

Rate limiting on uploads is stubbed with a TODO in `server.js`. Parsing a PDF and
writing to the database is real work; a public endpoint should not do it
unmetered.

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
