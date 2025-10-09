# Copilot Instructions for yes-securities-backend

## Project Overview
- **Type:** Node.js/TypeScript backend for YSIL Sales Repo App
- **Core:** Express server, Prisma ORM, AWS S3 integration, custom logging, and admin/user APIs
- **Key Directories:**
  - `src/`: Main backend logic (routers, services, AWS/S3 helpers)
  - `prisma/`: Database schema and migrations
  - `scripts/`: Utility scripts (e.g., stress testing)
  - `logs/`: App log files (see logging section)

## Architecture & Patterns
- **Routers:**
  - `userRouter.ts`, `adminRouter.ts`, `fileRouterOptimized.ts`, `bookmarkRouterOptimized.ts`, `notificationsRouter.ts`
  - Each router handles a resource or feature area; routes are RESTful and use async/await
- **Services:**
  - S3 access and optimization in `awsOptimized.ts`, `awsService.ts`, `bookmarkServiceOptimized.ts`
  - S3 prefixes: content under `/`, icons under `icons/` (see `normalizeSlashes` and `toS3Prefix`)
- **Database:**
  - Prisma ORM, schema in `prisma/schema.prisma`, migrations in `prisma/migrations/`
  - User/account metrics and exports handled in routers (see CSV/XLSX export logic)
- **Logging:**
  - All console output is timestamped and written to `logs/app.log` (see `src/index.ts`)
  - Log rotation at 5MB, configurable via `MAX_LOG_SIZE_BYTES`
  - Disable file logging with `DISABLE_FILE_LOGS=1`

## Developer Workflows
- **Start Dev Server:**
  - `npm run dev` (see also `Start Backend Server` VS Code task)
  - For crash-safe/dev monitoring: `npm run dev-monitor` or `./monitor-backend.sh`
- **Run Stress Test:**
  - `node scripts/stress-test.js` (set env vars for API, credentials, concurrency)
- **Database Migrations:**
  - Use Prisma CLI (`npx prisma migrate dev`), schema in `prisma/schema.prisma`
- **Logs:**
  - View: `tail -f logs/app.log`
  - Rotate: automatic at 5MB, or compress old logs with `gzip logs/app-*.log`

## Project-Specific Conventions
- **S3 Path Normalization:** Always use helpers to convert user input to S3 prefixes
- **User Metrics:** User activity, sign-ins, and document views are tracked and exported via admin endpoints
- **Environment Variables:**
  - `LOG_DIR`, `PORT`, `DISABLE_FILE_LOGS`, S3/DB credentials, and timeouts
- **Testing:**
  - See `CRASH-FIX-REPORT.md` and `AWS-OPTIMIZATION-GUIDE.md` for manual and automated test steps

## Integration Points
- **AWS S3:** All file/folder operations use S3 via AWS SDK v3, with custom timeouts and keep-alive
- **Prisma:** All DB access via Prisma Client, with migrations tracked in `prisma/migrations/`
- **Frontend:** Expects RESTful JSON APIs, with some endpoints supporting CSV/XLSX export

## References
- Logging: `BACKEND-LOGS-README.md`
- S3 Optimization: `AWS-OPTIMIZATION-GUIDE.md`
- Crash Recovery: `CRASH-FIX-REPORT.md`
- Bookmarks: `BOOKMARK-CLEANUP-README.md`

---

**If you are unsure about a workflow or convention, check the referenced markdown files or the top of `src/index.ts`.**
