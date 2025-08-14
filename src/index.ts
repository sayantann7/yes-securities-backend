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

// Validate critical environment variables
if (!process.env.JWT_SECRET) {
  console.error('FATAL: JWT_SECRET environment variable is not set');
  process.exit(1);
}

if (!process.env.DATABASE_URL) {
  console.error('FATAL: DATABASE_URL environment variable is not set');
  process.exit(1);
}

// Enhanced error handling with crash prevention
process.on('uncaughtException', (error) => {
  console.error('🆘 Uncaught Exception caught by enhanced handler:', error);
  console.error('Stack trace:', error.stack);
  
  // Log but don't crash - the ErrorHandler will manage this
  console.log('✅ Server continuing with enhanced error recovery...');
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('🆘 Unhandled Rejection caught by enhanced handler:', promise, 'reason:', reason);
  console.error('Stack trace:', reason instanceof Error ? reason.stack : 'No stack trace available');
  
  // Log but don't crash - the ErrorHandler will manage this
  console.log('✅ Server continuing with enhanced error recovery...');
});

app.use(express.json({ limit: '50mb' }));
app.use(cors());

app.use("/api", fileRouter);
app.use("/user", userRouter);
app.use("/admin", adminRouter);
app.use("/bookmark", bookmarkRouter);

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