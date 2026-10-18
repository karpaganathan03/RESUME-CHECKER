// One command to run the whole app in development: `npm run dev`.
//
// It starts the API (Express on :5000) and the UI (Vite on :5173) together and
// stops both on Ctrl+C. Written with node:child_process rather than a package
// like `concurrently`, so there is nothing extra to install at the root and it
// behaves the same on Windows, macOS and Linux.
//
// Open http://localhost:5173 - that is the app. Never serve the project folder
// itself with a static file server: it only shows a list of folders.

import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = dirname(dirname(fileURLToPath(import.meta.url)))

// Config lives in backend/.env (created by `npm run setup`). Without it the app
// still runs: scoring works, results are just not saved and the AI is off.
const envFile = join(root, 'backend', '.env')
if (!existsSync(envFile)) {
  console.log('[dev] No backend/.env yet - running with defaults. `npm run setup` creates one.')
}

for (const dir of ['backend', 'frontend']) {
  if (!existsSync(join(root, dir, 'node_modules'))) {
    console.error(`[dev] ${dir}/node_modules is missing. Run: npm run install:all`)
    process.exit(1)
  }
}

const children = [
  { name: 'api', color: '\x1b[36m', args: ['--prefix', 'backend', 'run', 'dev'] },
  { name: 'web', color: '\x1b[35m', args: ['--prefix', 'frontend', 'run', 'dev'] },
].map(({ name, color, args }) => {
  // shell:true is what lets Windows find npm.cmd.
  const child = spawn('npm', args, { cwd: root, shell: true, stdio: ['ignore', 'pipe', 'pipe'] })
  const tag = `${color}[${name}]\x1b[0m `
  const pipe = (stream, out) =>
    stream.on('data', (chunk) =>
      String(chunk)
        .split(/\r?\n/)
        .filter(Boolean)
        .forEach((line) => out.write(`${tag}${line}\n`)),
    )
  pipe(child.stdout, process.stdout)
  pipe(child.stderr, process.stderr)
  child.on('exit', (code) => {
    if (!stopping) {
      console.error(`[dev] ${name} exited (${code}). Stopping the other process too.`)
      stop(code || 1)
    }
  })
  return child
})

let stopping = false
function stop(code = 0) {
  stopping = true
  for (const child of children) {
    if (process.platform === 'win32') {
      // child.kill() would only stop the shell on Windows, not npm and node under it.
      spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
    } else {
      child.kill('SIGTERM')
    }
  }
  setTimeout(() => process.exit(code), 300)
}

process.on('SIGINT', () => stop(0))
process.on('SIGTERM', () => stop(0))

console.log('\n  ATS Checker (development)\n  Open  http://localhost:5173   <- the app\n  API   http://localhost:5000/api/health\n')
