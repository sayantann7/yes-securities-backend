# YSIL Sales Repo App Backend Logs

### Location

- Default log directory: `./logs` (relative to project root at runtime)
- Active log file: `logs/app.log`
- Rotated files: `logs/app-<ISO_TIMESTAMP>.log`

### Features

- Captures every console message with a UTC ISO timestamp and level
- Includes stack traces for `Error` objects when available
- Rotates the active file when it reaches 5 MB (configurable in code)
- Continues running even if logging fails (fail-safe)
- Can change log directory using environment variable `LOG_DIR`

### Quick Start

Run the server as usual (example):

```bash
npm run dev
```

Then tail the logs:

```bash
tail -f logs/app.log
```

### Environment Variables

| Variable | Purpose | Default |
|----------|---------|---------|
| `LOG_DIR` | Override the directory where log files are stored | `./logs` |
| `PORT` | Server port | `3000` |

### How It Works

Inside `src/index.ts`, early in startup we wrap the native console methods:

```ts
(['log','info','warn','error'] as const).forEach(level => { /* ... */ });
```

Each call is serialized (JSON for objects) and appended to `logs/app.log` with a timestamp. Before each append, size is checked; if current file size >= 5 MB it is renamed with a timestamp and a fresh `app.log` is created.

### Adjusting Rotation Size

Open `src/index.ts` and find:

```ts
const MAX_LOG_SIZE_BYTES = 5 * 1024 * 1024; // 5MB
```

Change to desired threshold (e.g. 10 MB):

```ts
const MAX_LOG_SIZE_BYTES = 10 * 1024 * 1024;
```

### Adding Time-Based (Daily) Rotation (Optional)

If you also want daily rotation, you can extend the rotate logic to check the date portion of the last line or maintain current date in memory and rotate at midnight. Example sketch:

```ts
let currentDay = new Date().toISOString().slice(0,10);
function rotateIfNeeded() {
  const today = new Date().toISOString().slice(0,10);
  if (today !== currentDay) { /* rename and reset currentDay */ }
  // existing size-based rotation
}
```

### Filtering Verbose Output

If health checks or noisy logs clutter the file, wrap those logs with a conditional:

```ts
if (process.env.VERBOSE) console.log('Health check details:', data);
```

Run with:

```bash
VERBOSE=1 npm run dev
```

### Viewing Recent Logs

Show last 200 lines:

```bash
tail -n 200 logs/app.log
```

Follow with rotation awareness (shows new file automatically if logrotate is manual):

```bash
tail -F logs/app.log
```

### Archiving Old Logs

Periodically compress rotated logs:

```bash
gzip logs/app-*.log
```

Or automate with a cron entry (example, compress older than 7 days):

```cron
0 1 * * * find /path/to/app/logs -name 'app-*.log' -mtime +7 -exec gzip {} \;
```

### Disabling File Logging (Temporary)

Set an env variable and guard the wrapper code:

```ts
if (!process.env.DISABLE_FILE_LOGS) { /* console wrapping */ }
```

Then run:

```bash
DISABLE_FILE_LOGS=1 npm run dev
```

### Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| No `logs` folder created | App lacks write permission | Ensure process has write access; check container mount paths |
| Log file stops growing | Rotation rename failed mid-write | Verify filesystem space and permissions |
| High disk usage | Too many rotated logs | Add compression/cleanup cron or reduce size threshold |

### Security Notes

- Logs may contain sensitive data (emails, file paths). Restrict access to the `logs` directory.
- Avoid logging raw credentials or tokens; scrub before logging.

### Future Enhancements (Optional)

- Switch to structured JSON logs for log aggregation systems
- Add correlation/request IDs
- Integrate with a logging stack (e.g. Elastic, Loki, Datadog) via a transport
- Add log level filtering via `LOG_LEVEL`

---

For any changes or to extend logging behavior, edit the logging block near the top of `src/index.ts`.
