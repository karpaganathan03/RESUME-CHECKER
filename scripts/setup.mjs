// First-run setup: `npm run setup`.
// Creates backend/.env from the example if it is missing. It never overwrites an
// existing .env, because that file holds your real keys.

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const target = join(root, 'backend', '.env')
const example = join(root, 'backend', 'example.env')

if (existsSync(target)) {
  console.log('backend/.env already exists - left untouched.')
} else {
  // The example ships a fake Atlas URI as a format hint. Left in place it would
  // be treated as real and every request would wait for it to time out, so the
  // copy starts with MONGODB_URI empty: the app runs, it just does not save.
  const text = readFileSync(example, 'utf8')
    .replace(/^MONGODB_URI=.*$/m, 'MONGODB_URI=')
    .replace(/^MONGODB_USERNAME=.*$/m, 'MONGODB_USERNAME=')
    .replace(/^MONGODB_PASSWORD=.*$/m, 'MONGODB_PASSWORD=')
  writeFileSync(target, text)
  console.log('Created backend/.env')
  console.log('  - MONGODB_URI is empty: scoring works, results are just not saved.')
  console.log('  - Add your MongoDB connection string and LABD_API_KEY there when you have them.')
}
