import express from "express";
require("dotenv").config();
import fileRouter from "./fileRouter";
import userRouter from "./userRouter";
import adminRouter from "./adminRouter";
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

// Enhanced error handling
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
  console.error('Stack trace:', error.stack);
  
  // Attempt graceful shutdown
  setTimeout(() => {
    console.error('Forcing exit due to uncaught exception');
    process.exit(1);
  }, 5000);
  
  // Try to close the server gracefully
  if (server) {
    server.close(() => {
      console.log('HTTP server closed due to uncaught exception');
      process.exit(1);
    });
  } else {
    process.exit(1);
  }
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  console.error('Stack trace:', reason instanceof Error ? reason.stack : 'No stack trace available');
  
  // Log but don't exit immediately for unhandled promise rejections
  // This allows the application to continue running
});

app.use(express.json({ limit: '50mb' }));
app.use(cors());

// Health check endpoint
app.get('/health', async (req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ status: 'healthy', timestamp: new Date().toISOString() });
  } catch (error) {
    console.error('Health check failed:', error);
    res.status(500).json({ status: 'unhealthy', error: 'Database connection failed' });
  }
});

app.use("/api", fileRouter);
app.use("/user", userRouter);
app.use("/admin", adminRouter);

// Global error handler
app.use((error: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('Global error handler:', error);
  res.status(500).json({ 
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? error.message : 'Something went wrong'
  });
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