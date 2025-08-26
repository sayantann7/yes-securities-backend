import express from "express";
import fs from "fs";
import path from "path";
require("dotenv").config();
import fileRouter from "./fileRouterOptimized";
import userRouter from "./userRouter";
import adminRouter from "./adminRouter";
import bookmarkRouter from "./bookmarkRouterOptimized";
import cors from "cors";
import { prisma } from "./prisma";

// --------------------------------------------------
// Persistent logging setup (simple daily rotation)
// --------------------------------------------------
const LOG_DIR = process.env.LOG_DIR || path.join(process.cwd(), 'logs');
const LOG_FILE_BASENAME = 'app.log';
const MAX_LOG_SIZE_BYTES = 5 * 1024 * 1024; // 5MB per file before rolling

function ensureLogDir() {
  try { fs.mkdirSync(LOG_DIR, { recursive: true }); } catch {}
}

function currentLogPath() {
  return path.join(LOG_DIR, LOG_FILE_BASENAME);
}

function rotateIfNeeded() {
  try {
    const file = currentLogPath();
    if (fs.existsSync(file)) {
      const stats = fs.statSync(file);
      if (stats.size >= MAX_LOG_SIZE_BYTES) {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const rotated = path.join(LOG_DIR, `app-${timestamp}.log`);
        fs.renameSync(file, rotated);
      }
    }
  } catch (e) {
    // Swallow rotation errors to avoid breaking the app
  }
}

function appendLog(line: string) {
  try {
    ensureLogDir();
    rotateIfNeeded();
    fs.appendFileSync(currentLogPath(), line + '\n');
  } catch {}
}

// Wrap console methods to duplicate output
(['log','info','warn','error'] as const).forEach(level => {
  const orig = console[level];
  // @ts-ignore
  console[level] = (...args: any[]) => {
    try {
      const msg = args.map(a => {
        if (a instanceof Error) return a.stack || a.message;
        if (typeof a === 'object') {
          try { return JSON.stringify(a); } catch { return String(a); }
        }
        return String(a);
      }).join(' ');
      const line = `[${new Date().toISOString()}] ${level.toUpperCase()} ${msg}`;
      appendLog(line);
    } catch {}
    // Always call original
    orig.apply(console, args);
  };
});

console.log('📝 File logging initialized. Logs directory:', LOG_DIR);

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
app.use(cors());

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

app.use("/api", fileRouter);3000
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