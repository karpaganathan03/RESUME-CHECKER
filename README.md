# ATS Checker

Upload a resume PDF, paste a job description, and get an ATS match score out of
100, the skills your resume **has**, and the skills it is **missing**. An optional
labd AI step adds a written verdict.

One deployable: Express serves the API *and* the built React UI from the same
process and the same origin - one Vercel project, no CORS.

## Quick start (Windows, macOS, Linux)

Needs **Node 22.3 or newer** (`node -v`).

```bash
npm run install:all     # installs frontend/ and backend/ (once)
npm run setup           # creates backend/.env (once)
npm run dev             # starts the API and the UI together
```

Then open **http://localhost:5173**. That is the app.

> Do not open the project folder with Live Server, `serve` or any static file
> server. There is no `index.html` at the root, so all you will see is a list of
> folders. The app only exists once `npm run dev` (or `npm start`) is running.

Run exactly what gets deployed - one process, one port:

```bash
npm run build           # builds the UI into frontend/dist
npm start               # http://localhost:5000 serves the UI and the API
```

## Configuration - `backend/.env`

`npm run setup` creates it from `backend/example.env`. Everything is optional for
a first run:

| Variable        | What it does                                                                 |
| --------------- | ---------------------------------------------------------------------------- |
| `MONGODB_URI`   | Saves each result to MongoDB. Empty = scoring works, nothing is saved.       |
| `LABD_API_KEY`  | Turns on the labd AI score, skills and written verdict. Empty = built-in rules. |
| `PORT`          | API port, default 5000.                                                      |
| `CLIENT_ORIGINS`| Only if a *different* origin calls the API. Leave empty normally.            |

Keys live on the server only. Never put them in a `VITE_` variable: Vite copies
those into the JavaScript bundle that every visitor can read. Restart the server
after editing `.env`.

## How it works

```
backend/            API + web server (Express, MongoDB)
  server.js         builds the app, mounts /api, then serves frontend/dist
  routes/           path -> controller
  controllers/      request in, response out
  services/         pdf.service (PDF text), scoring.service (rules), ai.service (labd)
  database/         cached mongoose connection + models
  config/           env vars, skill vocabulary loader
  middleware/       CORS, uploads, errors
  utils.js          shared helpers (skill matching lives here)
  test/             node:test suites
frontend/           React + Vite UI, built into frontend/dist
api/index.js        Vercel's entry point: hands /api/* to backend/server.js
shared/skills.txt   the skill vocabulary you edit
scripts/            dev.mjs, setup.mjs, sync-skills.mjs
```

Request flow: the browser posts the PDF and job description to `/api/parse` ->
`pdf.service` extracts the text -> `scoring.service` scores it with the keyword
rules -> if `LABD_API_KEY` is set, `ai.service` asks labd to review it and its
score replaces the keyword one (any labd failure falls back silently to the
keyword score) -> the result is saved to MongoDB if configured -> the UI shows it.

The API is mounted before the static handler on purpose. Reversed, an unknown
`/api` path would return the SPA's HTML. `test/static.test.js` guards this.

**Scoring** (built-in rules): skills 65%, contact details 15%, measurable impact
(numbers, percentages) 10%, sensible length 10%. The skills compared are the ones
the job description mentions; if it mentions fewer than 3 known skills, a 12-skill
general set is used so a vague description does not give a 0-or-100 result.

**Skills.** Edit `shared/skills.txt`. One per line: `Canonical | alias | alias`, so
`Postgres` on a resume satisfies `PostgreSQL` in a job description. Matching is
case-insensitive and whole-word: `Git` does not match "digital", `Java` does not
match "JavaScript", and the alias `JS` does not match inside "Node.js". `npm run
build` copies the file into `backend/` and `frontend/`; `npm test` fails if the
copies have drifted.

## API

| Method | Path          | Purpose                                         |
| ------ | ------------- | ----------------------------------------------- |
| GET    | `/api/health` | Liveness. No database, no PDF library.          |
| POST   | `/api/parse`  | Multipart: `resume` (PDF), `jobDescription`.    |
| GET    | `/api/scores` | Recent saved results, `?limit=` up to 50.       |

`POST /api/parse` returns 201 with `score`, `present`, `missing`, `checks`,
`engine` (`heuristic` or `ai`), `aiSummary`, and `persisted`. Errors: 415 not a
PDF, 413 over 4 MB, 422 no readable text (a scan or image).

The PDF itself and its text are never stored - only the score and matched skills.
The limit is 4 MB because Vercel rejects larger request bodies before Express runs.

## If the backend is down

The UI shows a clearly labelled **demo estimate**. It does not read your PDF; it is
a placeholder so the page is not empty. If the backend is reachable but rejects the
file, you get its real error message instead - never a made-up score.

## Tests

```bash
npm test
```

Covers scoring rules, skill matching, a real in-memory PDF through the whole
`/api/parse` route, the labd reply parsing and merge (no network), and that one
server serves both UI and API.

## Deploying to Vercel as Two Separate Projects (Recommended)

### 1. Backend Project
1. Import the repository into Vercel.
2. In the project settings, set **Root Directory** to `backend`.
3. Add Environment Variables:
   - `MONGODB_URI`: Your MongoDB Atlas connection string.
   - `CLIENT_ORIGINS`: Allowed origins (e.g. `*` or `https://your-frontend-project.vercel.app`).
   - `LABD_API_KEY`: (Optional) Your labd API key.
4. Deploy! Your backend API will be live at `https://your-backend-project.vercel.app`.

### 2. Frontend Project
1. Import the same repository into Vercel as a second project.
2. In the project settings, set **Root Directory** to `frontend`.
3. Framework Preset: **Vite**.
4. Add Environment Variable:
   - `VITE_API_URL`: The URL of your deployed backend (e.g. `https://your-backend-project.vercel.app`).
5. Deploy! Your frontend UI is live at `https://your-frontend-project.vercel.app`.

---

## Deploying to Vercel (Alternative: Single Monorepo Project)

1. Push the repo and import it as **one** Vercel project, root directory = repo root.
2. Add environment variables in the Vercel dashboard: `MONGODB_URI` and `LABD_API_KEY` (optional).
3. In MongoDB Atlas, allow network access from anywhere (`0.0.0.0/0`).
4. Deploy (do not set `VITE_API_URL`).

## Not built yet

Rate limiting on `/api/parse` is a TODO in `server.js`. Each upload costs a PDF
parse and possibly a labd call, so add `express-rate-limit` before going public.
