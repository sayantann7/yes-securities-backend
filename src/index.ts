import express from "express";
require("dotenv").config();
import fileRouter from "./fileRouterOptimized";
import userRouter from "./userRouter";
import adminRouter from "./adminRouter";
import bookmarkRouter from "./bookmarkRouterOptimized";
import cors from "cors";
import { prisma } from "./prisma";

const app = express();
const PORT = process.env.PORT || 3000;

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
app.get('/healthz', async (_req, res) => {
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
  console.log(`Server is running on http://localhost:${PORT}`);
  
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