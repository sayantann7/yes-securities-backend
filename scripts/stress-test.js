#!/usr/bin/env node
/*
  Yes Securities Backend Stress Test Script
  - Simulates N concurrent users (default 300)
  - Each user logs in, then performs random actions for a duration
  - Live progress printed every second (RPS, successes, failures, latency percentiles)

  Usage (fish shell examples):
    set -x API_BASE_URL https://ysl-sales-repo.sayantan.space/
    set -x CONCURRENCY 300
    set -x DURATION_SEC 120
    set -x LOGIN_EMAIL your_user@example.com
    set -x LOGIN_PASSWORD your_password
    node scripts/stress-test.js

  Optional: provide a CSV of credentials (email,password per line)
    set -x USERS_FILE ./users.csv
*/

const fs = require('fs');
const path = require('path');

const BASE_URL = process.env.API_BASE_URL || 'https://salesrepo.ysil.in/';
const CONCURRENCY = parseInt(process.env.CONCURRENCY || '300', 10);
const DURATION_SEC = parseInt(process.env.DURATION_SEC || '120', 10);
const USERS_FILE = process.env.USERS_FILE || '';
const LOGIN_EMAIL = process.env.LOGIN_EMAIL || '';
const LOGIN_PASSWORD = process.env.LOGIN_PASSWORD || '';
const DEFAULT_TIMEOUT = parseInt(process.env.DEFAULT_TIMEOUT || '10000', 10); // ms

if (!USERS_FILE && (!LOGIN_EMAIL || !LOGIN_PASSWORD)) {
  console.log('\nMissing LOGIN_EMAIL/LOGIN_PASSWORD (or USERS_FILE).\nSet env vars, e.g.:\n  set -x LOGIN_EMAIL you@example.com\n  set -x LOGIN_PASSWORD your_password\n');
}

// Simple helpers
const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

function pickWeighted(weights) {
  // weights: Array<{ key: string, w: number }>
  const total = weights.reduce((s, a) => s + a.w, 0);
  let r = Math.random() * total;
  for (const item of weights) {
    if ((r -= item.w) <= 0) return item.key;
  }
  return weights[weights.length - 1].key;
}

function percentile(arr, p) {
  if (!arr.length) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(idx, sorted.length - 1))];
}

function now() { return Date.now(); }

// HTTP helper using global fetch (Node 18+)
async function request(method, url, { token, body, timeoutMs = DEFAULT_TIMEOUT, headers = {} } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error('timeout')), timeoutMs);
  try {
    const res = await fetch(url, {
      method,
      headers: {
        'Content-Type': body ? 'application/json' : undefined,
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...headers,
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
    const text = await res.text();
    let json;
    try { json = text ? JSON.parse(text) : {}; } catch { json = { raw: text }; }
    if (!res.ok) {
      const err = new Error(`HTTP ${res.status}`);
      err.status = res.status;
      err.body = json;
      throw err;
    }
    return json;
  } finally {
    clearTimeout(timer);
  }
}

// Load users from file (if provided)
function loadUsers() {
  if (!USERS_FILE) return [];
  try {
    const content = fs.readFileSync(path.resolve(USERS_FILE), 'utf8');
    return content.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map((line) => {
      const [email, password] = line.split(',').map((s) => s.trim());
      return { email, password };
    });
  } catch (e) {
    console.error('Failed to read USERS_FILE:', e.message);
    return [];
  }
}

// Metrics
const metrics = {
  startTs: now(),
  totalRequests: 0,
  totalSuccess: 0,
  totalFailed: 0,
  byAction: new Map(), // action -> { count, ok, fail, latencies: number[] }
};

function record(action, ok, latencyMs) {
  metrics.totalRequests += 1;
  if (ok) metrics.totalSuccess += 1; else metrics.totalFailed += 1;
  if (!metrics.byAction.has(action)) {
    metrics.byAction.set(action, { count: 0, ok: 0, fail: 0, latencies: [] });
  }
  const a = metrics.byAction.get(action);
  a.count += 1;
  if (ok) a.ok += 1; else a.fail += 1;
  a.latencies.push(latencyMs);
  if (a.latencies.length > 1000) a.latencies.splice(0, a.latencies.length - 1000); // keep last 1000
}

async function healthCheck() {
  try {
    const res = await request('GET', `${BASE_URL}/healthz`, { timeoutMs: 5000 });
    console.log('Health:', res);
  } catch (e) {
    console.log('Health check failed:', e.message);
  }
}

async function login({ email, password }) {
  const t0 = now();
  try {
    const data = await request('POST', `${BASE_URL}/user/signin`, {
      body: { email, password },
    });
    record('login', true, now() - t0);
    return { token: data.token, user: data.user };
  } catch (e) {
    record('login', false, now() - t0);
    throw e;
  }
}

async function actionFolders(token, prefix = '', loadIcons = true) {
  const t0 = now();
  try {
    const data = await request('POST', `${BASE_URL}/api/folders`, {
      token,
      body: { prefix, loadIcons },
    });
    record('folders', true, now() - t0);
    return data;
  } catch (e) {
    record('folders', false, now() - t0);
    return null;
  }
}

async function actionFoldersFast(token, prefix = '') {
  const t0 = now();
  try {
    const data = await request('POST', `${BASE_URL}/api/folders/fast`, {
      token,
      body: { prefix, maxItems: 1000 },
    });
    record('foldersFast', true, now() - t0);
    return data;
  } catch (e) {
    record('foldersFast', false, now() - t0);
    return null;
  }
}

async function actionBookmarkToggle(token, itemId, itemName, itemType = 'folder') {
  const t0 = now();
  try {
    await request('POST', `${BASE_URL}/bookmark/bookmarks`, {
      token,
      body: { itemId, itemName, itemType },
    });
    record('bookmark', true, now() - t0);
    return true;
  } catch (e) {
    record('bookmark', false, now() - t0);
    return false;
  }
}

async function actionGetNotifications(token) {
  const t0 = now();
  try {
    await request('GET', `${BASE_URL}/user/notifications`, { token });
    record('notifications', true, now() - t0);
    return true;
  } catch (e) {
    record('notifications', false, now() - t0);
    return false;
  }
}

async function actionMarkAllRead(token) {
  const t0 = now();
  try {
    await request('PUT', `${BASE_URL}/user/notifications/mark-all-read`, { token });
    record('markAllRead', true, now() - t0);
    return true;
  } catch (e) {
    record('markAllRead', false, now() - t0);
    return false;
  }
}

async function actionUpdateTime(userEmail) {
  const t0 = now();
  try {
    await request('POST', `${BASE_URL}/user/updateTime`, {
      body: { userEmail, timeSpent: Math.floor(Math.random() * 5) + 1 },
    });
    record('updateTime', true, now() - t0);
    return true;
  } catch (e) {
    record('updateTime', false, now() - t0);
    return false;
  }
}

async function actionDocumentViewed(userEmail) {
  const t0 = now();
  try {
    await request('POST', `${BASE_URL}/user/documentViewed`, {
      body: { userEmail, documentId: `doc-${Math.floor(Math.random() * 1000)}` },
    });
    record('documentViewed', true, now() - t0);
    return true;
  } catch (e) {
    record('documentViewed', false, now() - t0);
    return false;
  }
}

async function userScenario(userCred, endTs) {
  // Ramp-up jitter 0-3s
  await sleep(Math.random() * 3000);

  let token = null;
  let email = userCred.email;
  let lastFolders = [];

  try {
    const loginRes = await login(userCred);
    token = loginRes.token;
    email = loginRes.user?.email || userCred.email;
  } catch (e) {
    return; // cannot continue without login for authenticated actions
  }

  while (now() < endTs) {
    const action = pickWeighted([
      { key: 'folders', w: 30 },
      { key: 'foldersFast', w: 25 },
      { key: 'updateTime', w: 15 },
      { key: 'documentViewed', w: 10 },
      { key: 'notifications', w: 10 },
      { key: 'markAllRead', w: 5 },
      { key: 'bookmark', w: 5 },
    ]);

    try {
      if (action === 'folders') {
        const res = await actionFolders(token, lastFolders.length ? (lastFolders[Math.floor(Math.random() * lastFolders.length)].id || '') : '');
        if (res && Array.isArray(res.folders)) {
          // capture some folder ids for future actions
          lastFolders = res.folders.slice(0, 20).map(f => ({ id: f.id || f.key, name: f.name || f.key }));
        }
      } else if (action === 'foldersFast') {
        const chosen = lastFolders.length ? lastFolders[Math.floor(Math.random() * lastFolders.length)].id : '';
        await actionFoldersFast(token, chosen || '');
      } else if (action === 'updateTime') {
        await actionUpdateTime(email);
      } else if (action === 'documentViewed') {
        await actionDocumentViewed(email);
      } else if (action === 'notifications') {
        await actionGetNotifications(token);
      } else if (action === 'markAllRead') {
        await actionMarkAllRead(token);
      } else if (action === 'bookmark') {
        if (lastFolders.length) {
          const f = lastFolders[Math.floor(Math.random() * lastFolders.length)];
          await actionBookmarkToggle(token, f.id, f.name || 'Folder');
        } else {
          await actionFolders(token, '');
        }
      }
    } catch (_) {
      // errors are recorded in action functions
    }

    // think time 200-1200ms
    await sleep(200 + Math.random() * 1000);
  }
}

function printProgressLoop(startTs, totalUsers) {
  let lastReq = 0;
  let lastTs = now();
  const timer = setInterval(() => {
    const curr = metrics.totalRequests;
    const t = now();
    const dt = (t - lastTs) / 1000;
    const rps = dt > 0 ? ((curr - lastReq) / dt).toFixed(1) : '0.0';
    lastReq = curr;
    lastTs = t;

    const up = ((t - startTs) / 1000).toFixed(0);
    const p95 = percentile(Array.from(metrics.byAction.values()).flatMap(a => a.latencies), 95).toFixed(0);

    const lines = [];
    lines.push(`[t+${up}s] Users: ${totalUsers} | RPS: ${rps} | OK: ${metrics.totalSuccess} | Fail: ${metrics.totalFailed} | p95: ${p95}ms | Total: ${metrics.totalRequests}`);
    for (const [action, a] of metrics.byAction.entries()) {
      const p95a = percentile(a.latencies, 95).toFixed(0);
      lines.push(`  - ${action}: count=${a.count}, ok=${a.ok}, fail=${a.fail}, p95=${p95a}ms`);
    }
    console.log(lines.join('\n'));
  }, 1000);
  return () => clearInterval(timer);
}

async function main() {
  console.log(`\nStarting stress test against ${BASE_URL}`);
  console.log(`Concurrency: ${CONCURRENCY}, Duration: ${DURATION_SEC}s`);

  await healthCheck();

  const usersFromFile = loadUsers();
  const creds = [];
  for (let i = 0; i < CONCURRENCY; i++) {
    if (usersFromFile.length) {
      creds.push(usersFromFile[i % usersFromFile.length]);
    } else {
      creds.push({ email: LOGIN_EMAIL, password: LOGIN_PASSWORD });
    }
  }

  const endTs = now() + DURATION_SEC * 1000;
  const stopProgress = printProgressLoop(now(), CONCURRENCY);

  const runners = creds.map((c) => userScenario(c, endTs));
  await Promise.allSettled(runners);

  stopProgress();

  // Final summary
  console.log('\n=== Final Summary ===');
  console.log(`Total Requests: ${metrics.totalRequests}`);
  console.log(`Success: ${metrics.totalSuccess}`);
  console.log(`Failed: ${metrics.totalFailed}`);
  for (const [action, a] of metrics.byAction.entries()) {
    console.log(` - ${action}: count=${a.count}, ok=${a.ok}, fail=${a.fail}, p50=${percentile(a.latencies,50).toFixed(0)}ms, p95=${percentile(a.latencies,95).toFixed(0)}ms, p99=${percentile(a.latencies,99).toFixed(0)}ms`);
  }
}

process.on('SIGINT', () => {
  console.log('\nReceived SIGINT, exiting...');
  process.exit(0);
});

main().catch((e) => {
  console.error('Fatal error:', e);
  process.exit(1);
});
