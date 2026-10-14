// One scored resume submission.
//
// Deliberate privacy choice: we store the DERIVED result (score, matched skills)
// and never the extracted resume text or the raw PDF. A resume is full of
// personal data - a name, an address, a phone number - and storing text we do
// not need turns a scoring app into a liability. Everything a report needs to
// re-render is in the fields below.

import mongoose from 'mongoose'

const checkSchema = new mongoose.Schema(
  {
    label: { type: String, required: true },
    pass: { type: Boolean, required: true },
  },
  { _id: false },
)

const scoreSchema = new mongoose.Schema(
  {
    fileName: { type: String, required: true },
    fileSize: { type: Number, required: true },
    role: { type: String, default: '' },

    // 0-100. Clamped in the schema too, so a bug upstream cannot write 140.
    score: { type: Number, required: true, min: 0, max: 100 },

    present: { type: [String], default: [] },
    missing: { type: [String], default: [] },
    checks: { type: [checkSchema], default: [] },

    // Truncated because a JD can be a whole pasted page, and the DB is not the
    // place to keep it verbatim.
    jobDescriptionExcerpt: { type: String, default: '' },

    // 'heuristic' today; 'ai' once the comparison step is wired up.
    engine: { type: String, enum: ['heuristic', 'ai'], default: 'heuristic' },
    aiSummary: { type: String, default: null },
  },
  { timestamps: true },
)

// The reports list will be newest-first; this index is what keeps that cheap.
scoreSchema.index({ createdAt: -1 })

export const Score = mongoose.models.Score || mongoose.model('Score', scoreSchema)
