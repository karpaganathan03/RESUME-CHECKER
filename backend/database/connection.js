// MongoDB connection, cached across invocations.
//
// This is the "Database" stage of backend -> Database -> server -> Frontend: the
// connection and the models live together in this folder, and nothing above this
// layer reaches for mongoose directly.
//
// A serverless function can handle many requests inside one "warm" instance, and
// a naive `mongoose.connect()` per request opens a new pool every time until
// Atlas refuses the connections. Caching the promise - not just the connection -
// also stops concurrent cold-start requests from each opening their own.

import mongoose from "mongoose";
import { MONGODB_URI } from "../config/env.js";

// globalThis survives module reloads in dev; a plain module-level variable would
// be re-created on every reload and leak connections.
const cache = (globalThis.__labdMongo ??= { conn: null, promise: null });

export async function connectDB() {
  if (cache.conn) return cache.conn;

  if (!MONGODB_URI) {
    throw new Error(
      "MONGODB_URI is not set - add it to backend/.env or the Vercel project env vars.",
    );
  }

  if (!cache.promise) {
    mongoose.set("strictQuery", true);
    cache.promise = mongoose
      .connect(MONGODB_URI, {
        serverSelectionTimeoutMS: 8000,
        maxPoolSize: 10,
      })
      .then((m) => m.connection)
      .catch((err) => {
        // Clear the promise so a later request can retry, instead of caching the
        // rejected one and failing forever.
        cache.promise = null;
        throw err;
      });
  }

  cache.conn = await cache.promise;
  return cache.conn;
}

export function isDbConnected() {
  return mongoose.connection.readyState === 1;
}

export async function closeDB() {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
    cache.conn = null;
    cache.promise = null;
  }
}
