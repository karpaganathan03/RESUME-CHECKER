// 0 to shipped - Resume Parser API
//
// Two entry points, one app. `createApp()` builds the Express app and is what a
// test or a serverless wrapper should import; the code below it only starts a
// listener when this file is run directly (`node server.js`). Keeping those
// separate is what stops a test that imports server.js from binding port 5000.
//
// This file is also the Vercel entry point: backend/vercel.json builds it with
// @vercel/node and sends every path to it. Vercel imports the module for its
// default export, so `export default app` must stay.

import express from "express";
import helmet from "helmet";
import { pathToFileURL } from "node:url";
import { realpathSync } from "node:fs";
import routes from "./routes/index.js";
import { corsMiddleware } from "./middleware/cors.middleware.js";
import { handleUploadErrors } from "./middleware/upload.middleware.js";
import { errorHandler, notFound } from "./middleware/error.middleware.js";
import { PORT, assertProductionConfig, describeCors } from "./config/env.js";
import { connectDB } from "./database/connection.js";

export function createApp() {
  const app = express();

  // Trusting one proxy hop makes req.ip and req.protocol correct behind Vercel
  // or any reverse proxy.
  app.set("trust proxy", 1);
  app.disable("x-powered-by");

  app.use(helmet());
  app.use(corsMiddleware);

  // JSON bodies are for any future JSON endpoint. A multipart upload is NOT
  // parsed here - multer handles that at the route, which is why the upload
  // route is unaffected by this line.
  app.use(express.json({ limit: "100kb" }));

  // Rate limiting on uploads is stubbed rather than omitted: parsing a PDF and
  // writing to the database is real work, and a public deploy should not accept
  // that unmetered.
  // TODO: mount express-rate-limit here before this goes public.

  app.use("/api", routes);

  // Order matters. notFound runs for unmatched routes; handleUploadErrors only
  // sees multer's errors; errorHandler catches everything left. Both error
  // handlers take four arguments - that arity is what tells Express they are
  // error handlers rather than ordinary middleware.
  app.use(notFound);
  app.use(handleUploadErrors);
  app.use(errorHandler);

  return app;
}

const app = createApp();
export default app;

/**
 * Was this file run directly, or imported?
 *
 * The obvious check - `import.meta.url === `file://${process.argv[1]}`` - breaks
 * on Windows in two ways: process.argv[1] uses backslashes, and the path may be
 * a short 8.3 name or behind a symlink. Comparing realpath'd file URLs handles
 * both, so `node server.js` does not silently start no server, and importing the
 * module does not silently start one.
 */
function isDirectRun() {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return import.meta.url === pathToFileURL(realpathSync(entry)).href;
  } catch {
    return false;
  }
}

if (isDirectRun()) {
  try {
    assertProductionConfig();
  } catch (err) {
    console.error(`[startup] ${err.message}`);
    process.exit(1);
  }

  app.listen(PORT, () => {
    console.log(`API listening on http://localhost:${PORT}`);
    console.log(describeCors());

    // Not awaited: a slow or unreachable database must not delay or prevent the
    // server from accepting requests. /api/parse connects lazily anyway, and a
    // DB failure there is reported in the response rather than crashing boot.
    connectDB()
      .then(() => console.log("MongoDB connected"))
      .catch((err) => console.warn(`MongoDB not connected: ${err.message}`));
  });
}
