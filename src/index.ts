import express from "express";
import fs from "fs";
import path from "path";
require("dotenv").config();
import fileRouter from "./fileRouterOptimized";
import notificationsRouter from "./notificationsRouter";
import userRouter from "./userRouter";
import adminRouter from "./adminRouter";
import bookmarkRouter from "./bookmarkRouterOptimized";
import cors from "cors";
import helmet from "helmet";
import crypto from 'crypto';
import { prisma } from "./prisma";

// --------------------------------------------------
// Logging setup - file logging disabled
// --------------------------------------------------
// Console output only, no log files created

const app = express();
const PORT = Number(process.env.PORT) || 3000;

// Warn if critical env vars are missing (don't crash on boot)
if (!process.env.JWT_SECRET) {
  console.warn("⚠️  JWT_SECRET is not set. Authenticated routes may fail.");
}
if (!process.env.DATABASE_URL) {
  console.warn("⚠️  DATABASE_URL is not set. Prisma will not be able to connect.");
}

// Global crash guards
process.on("uncaughtException", (error: any) => {
  console.error("🆘 Uncaught Exception:", error);
  if (error?.stack) console.error(error.stack);
});

process.on("unhandledRejection", (reason: any, promise) => {
  console.error("🆘 Unhandled Rejection at:", promise, "reason:", reason);
  if (reason instanceof Error && reason.stack) console.error(reason.stack);
});

app.use(express.json({ limit: '5mb' }));

// CORS: restrict to known frontends
const allowedOrigins = (process.env.CORS_ORIGINS || 'https://ysl-admin.sayantan.space')
  .split(',')
  .map(o => o.trim())
  .filter(Boolean);

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
    return callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
  methods: ['GET','POST','PUT','DELETE','OPTIONS'],
  allowedHeaders: ['Content-Type','Authorization']
}));

// Security headers via helmet plus custom strict policies
app.use(helmet({
  referrerPolicy: { policy: 'no-referrer' },
  // We'll manage a custom CSP manually below (helmet disabled for CSP)
  contentSecurityPolicy: false
}));
// Custom CSP (restrictive but allows required resources)
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com data:",
  "img-src 'self' data: blob: https:",
  "connect-src 'self' https://ysl-sales-repo.sayantan.space https://ysl-admin.sayantan.space https://salesrepo.ysil.in/",
  "object-src 'none'",
  "base-uri 'self'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "upgrade-insecure-requests"
].join('; ');
app.use((_req, res, next) => {
  res.setHeader('X-Frame-Options','DENY');
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('X-XSS-Protection','0');
  res.setHeader('Permissions-Policy','camera=(), microphone=(), geolocation=()');
  res.setHeader('Cross-Origin-Opener-Policy','same-origin');
  res.setHeader('Cross-Origin-Resource-Policy','same-origin');
  res.setHeader('Cross-Origin-Embedder-Policy','require-corp');
  res.setHeader('Cache-Control','no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma','no-cache');
  res.setHeader('Expires','0');
  res.setHeader('Clear-Site-Data','"cache", "cookies", "storage", "executionContexts"');
  res.setHeader('Content-Security-Policy', CSP);
  next();
});

// Basic health endpoint
app.get('/health', async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    const mem = process.memoryUsage();
    res.json({ status: 'ok', db: true, memory: { rss: mem.rss, heapUsed: mem.heapUsed, heapTotal: mem.heapTotal } });
  } catch (e) {
    const mem = process.memoryUsage();
    res.status(500).json({ status: 'degraded', db: false, error: (e as any)?.message, memory: { rss: mem.rss, heapUsed: mem.heapUsed, heapTotal: mem.heapTotal } });
  }
});

app.use("/api", fileRouter);
app.use("/notifications", notificationsRouter);
app.use("/user", userRouter);
app.use("/admin", adminRouter);
app.use("/bookmark", bookmarkRouter);

// Centralized Express error handler (last middleware)
app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error("🧯 Express error handler caught: ", err);
  const status = typeof err?.status === 'number' ? err.status : 500;
  res.status(status).json({ error: err?.message || "Internal server error" });
});

const server = app.listen(PORT, async () => {
  console.log(`Server running on http://localhost:${PORT}`);

  // Test database connection on startup
  try {
    await prisma.$queryRaw`SELECT 1`;
    console.log('✅ Database connection successful');
  } catch (error) {
    console.error('❌ Database connection failed:', error);
    console.error('Server will continue but may experience issues');
  }
});

// Tune HTTP server timeouts for long-running S3 operations
try {
  // @ts-ignore Node's HTTP server in Express provides these setters
  server.keepAliveTimeout = Math.max(60000, server.keepAliveTimeout || 0); // 60s
  // @ts-ignore
  server.headersTimeout = Math.max(65000, server.headersTimeout || 0);     // 65s
  // @ts-ignore
  server.requestTimeout = Math.max(120000, server.requestTimeout || 0);    // 120s
} catch {}

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully');
  server.close(() => {
    console.log('Process terminated');
  });
});

process.on('SIGINT', () => {
  console.log('SIGINT received, shutting down gracefully');
  server.close(() => {
    console.log('Process terminated');
  });
});