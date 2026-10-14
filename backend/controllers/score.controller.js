// Project submission endpoint.

import path from "node:path";
import { Score } from "../database/models/score.model.js";
import { extractPdfText } from "../services/pdf.service.js";
import { scoreResume } from "../services/scoring.service.js";
import { summarizeGap } from "../services/ai.service.js";
import { connectDB, isDbConnected } from "../database/connection.js";
import { httpError, isPdf, normalizeText } from "../utils.js";
import { MAX_FILE_MB } from "../middleware/upload.middleware.js";

/**
 * POST /api/parse
 * multipart/form-data: resume (PDF, file), jobDescription (string, optional)
 */
export async function parseResume(req, res, next) {
  try {
    if (!req.file) {
      throw httpError(
        400,
        'No resume was uploaded. Send the file in a field named "resume".',
      );
    }
    if (!isPdf(req.file)) {
      throw httpError(415, "The resume must be a PDF.");
    }
    if (req.file.size === 0) {
      throw httpError(400, "The uploaded file is empty.");
    }

    const jobDescription = String(req.body?.jobDescription ?? "");
    if (jobDescription.length > 20000) {
      throw httpError(
        413,
        "That job description is too long (20,000 characters max).",
      );
    }

    // multer with memoryStorage gives a Buffer, so no temp file to clean up.
    let resumeText = "";
    try {
      resumeText = normalizeText(await extractPdfText(req.file.buffer));
    } catch (err) {
      // A scanned PDF or a password-protected one is a user problem, not a 500.
      throw httpError(422, `Could not read text from that PDF: ${err.message}`);
    }

    if (resumeText.length < 50) {
      throw httpError(
        422,
        "No readable text found in that PDF. If it is a scan or a photo, export it as a text-based PDF first.",
      );
    }

    const { score, role, present, missing, checks } = scoreResume(
      resumeText,
      jobDescription,
    );

    const aiSummary = await summarizeGap({
      resumeText,
      jobDescription,
      missing,
    });

    // Persisting is best-effort on purpose: the learner asked for a score, and a
    // database hiccup must not take that away from them.
    let saved = null;
    try {
      await connectDB();
      saved = await Score.create({
        // basename strips any path a malicious filename might carry.
        fileName: path.basename(req.file.originalname || "resume.pdf"),
        fileSize: req.file.size,
        role,
        score,
        present,
        missing,
        checks,
        jobDescriptionExcerpt: jobDescription.slice(0, 500),
        engine: aiSummary ? "ai" : "heuristic",
        aiSummary,
      });
    } catch (dbErr) {
      console.warn("[parse] could not save the score:", dbErr.message);
    }

    res.status(201).json({
      id: saved?._id?.toString() ?? null,
      fileName: req.file.originalname,
      fileSize: req.file.size,
      role,
      score,
      present,
      missing,
      checks,
      aiSummary,
      engine: saved?.engine ?? "heuristic",
      persisted: Boolean(saved),
      createdAt: saved?.createdAt ?? new Date().toISOString(),
    });
  } catch (err) {
    next(err);
  }
}

/** GET /api/scores - recent results, newest first. */
export async function listScores(req, res, next) {
  try {
    // Parse, then clamp, then default. `?limit=abc` and `?limit=9999` both have
    // to become something safe rather than NaN or an unbounded query.
    const requested = Number.parseInt(req.query.limit, 10);
    const limit = Number.isFinite(requested)
      ? Math.min(Math.max(requested, 1), 50)
      : 10;

    if (!isDbConnected()) {
      try {
        await connectDB();
      } catch {
        return res.json({ scores: [], persisted: false });
      }
    }

    const scores = await Score.find({})
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();
    res.json({ scores, persisted: true });
  } catch (err) {
    next(err);
  }
}

export { MAX_FILE_MB };
