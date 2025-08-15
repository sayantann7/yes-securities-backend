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