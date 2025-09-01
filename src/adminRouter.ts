import express from 'express';
import multer from 'multer';
import xlsx from 'xlsx';
import { prisma } from "./prisma";
import { deleteUserByEmail } from './services';
import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET;

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

// Helper to safely normalize any cell value to a trimmed string
function norm(val: any): string {
  if (val === undefined || val === null) return '';
  return String(val).trim();
}

// Accept both XLSX and CSV uploads; parse & diff users
// @ts-ignore
router.post('/users/import', upload.single('file'), async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: 'Missing employee list file' });
      }

      // Parse the uploaded file (supports .xlsx / .csv via xlsx library)
      const workbook = xlsx.read(req.file.buffer, { type: 'buffer' });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const uploadedEmployees: Array<Record<string, any>> = xlsx.utils.sheet_to_json(sheet, {
        defval: '', // keep empty strings instead of undefined
        blankrows: false
      });

      // Normalize records with flexible header names (case / dash variants)
      // Determine header row & map column letters to header names for direct cell access
      const sheetRange = xlsx.utils.decode_range(sheet['!ref'] as string);
      const headerRowIndex = sheetRange.s.r; // usually 0
      const headerMap: Record<string,string> = {}; // lowercased header name -> column letter
      for (let c = sheetRange.s.c; c <= sheetRange.e.c; c++) {
        const addr = xlsx.utils.encode_cell({ r: headerRowIndex, c });
        const cell = sheet[addr];
        if (!cell) continue;
        const headerName = String(cell.v || '').trim().toLowerCase();
        if (headerName) {
          const colLetter = addr.replace(/\d+/g,'');
          headerMap[headerName] = colLetter;
        }
      }
      const adIdHeaderCandidates = ['ad-id','adid','ad id','ad_id','adid'];
      const adIdColumnLetter = adIdHeaderCandidates.map(h=>headerMap[h]).find(Boolean);

      const normalized = uploadedEmployees.map((row, idx) => {
        const emailRaw = row.email ?? row.Email ?? row['E-mail'] ?? row['e-mail'] ?? row['EMAIL'];
        const fullnameRaw = row.fullname ?? row['full name'] ?? row['Full Name'] ?? row['Full_Name'] ?? row['FULLNAME'] ?? row['name'] ?? row['Name'];
        let adIdRaw = row['ad-id'] ?? row['AD-ID'] ?? row['adid'] ?? row['ADID'] ?? row['AdId'] ?? row['Ad-ID'];
        // Attempt to recover leading zeros using the raw cell text (formatted) if column identified
        if (adIdColumnLetter) {
          const sheetRowNumber = headerRowIndex + 1 + idx + 1; // +1 to move past header, +1 because sheet rows are 1-based
            const cellAddress = `${adIdColumnLetter}${sheetRowNumber}`;
          const cellObj = sheet[cellAddress];
          const rawText = cellObj?.w ?? cellObj?.v;
          if (rawText !== undefined && rawText !== null) {
            const rawStr = String(rawText).trim();
            // Prefer formatted text if it preserves leading zeros
            if (/^0+\d+$/.test(rawStr) || (typeof adIdRaw === 'number')) {
              adIdRaw = rawStr; // keep leading zeros
            }
          }
        }
        return {
          fullname: norm(fullnameRaw),
          email: norm(emailRaw),
          adId: typeof adIdRaw === 'number' ? String(adIdRaw) : norm(adIdRaw)
        };
      }).filter(r => r.email);

      // Get all current non-admin users from the database
      const currentUsers = await prisma.user.findMany({
        where: {
          role: {
            not: "admin"
          }
        },
        select: {
          id: true,
          email: true
        }
      });

      const results = {
        added: 0,
        removed: 0,
        unchanged: 0,
        errors: [] as string[]
      };

      // Create a set of all uploaded email addresses for quick lookup
      const uploadedEmails = new Set(
        normalized
          .map(emp => norm(emp.email).toLowerCase())
          .filter(email => !!email)
      );

      // Create a map of current users by email for quick lookup
      const currentUsersByEmail = new Map(
        currentUsers.map(user => [user.email.toLowerCase(), user])
      );

      // 1. Handle users to be removed (in database but not in uploaded list)
      for (const [email, user] of currentUsersByEmail.entries()) {
        if (!uploadedEmails.has(email)) {
          try {
            await deleteUserByEmail(email);
            results.removed++;
          } catch (err: any) {
            results.errors.push(`Failed to remove user ${email}: ${err.message || err}`);
          }
        } else {
          results.unchanged++;
        }
      }

      // 2. Handle users to be added (in uploaded list but not in database)
      for (const employee of normalized) {
        const email = norm(employee.email).toLowerCase();
        const fullname = norm(employee.fullname);
  // Preserve leading zeros exactly for AD ID (only trim outer whitespace)
  const adId = (employee.adId ?? '').toString().trim();

        if (!email) {
          results.errors.push('Missing email in uploaded file row');
          continue;
        }
        if (!adId) {
          results.errors.push(`Missing ad-id for user ${email} in uploaded file`);
          continue;
        }
        if (!currentUsersByEmail.has(email)) {
          try {
            await prisma.user.create({
              data: {
                fullname,
                email: email.toLowerCase(),
                password: adId, // preserve leading zeros
                role: 'user'
              }
            });
            results.added++;
          } catch (err: any) {
            results.errors.push(`Failed to add user ${email}: ${err.message || err}`);
          }
        }
      }

      return res.json({
        message: "Employee list processed successfully",
        results: {
          newEmployeesAdded: results.added,
          formerEmployeesRemoved: results.removed,
          unchangedEmployees: results.unchanged,
          errors: results.errors
        }
      });
    } catch (err: any) {
      console.error('Import error:', err);
  return res.status(500).json({ error: err.message || 'Import failed' });
    }
  }
);

export default router;

// -----------------------------
// Admin metrics & management APIs
// -----------------------------

function extractUserId(req: any): string | null {
  try {
    const auth = req.headers.authorization;
    if (!auth || !auth.startsWith('Bearer ') || !JWT_SECRET) return null;
    const token = auth.split(' ')[1];
    const decoded = jwt.verify(token, JWT_SECRET) as any;
    return decoded.userId || null;
  } catch {
    return null;
  }
}

async function ensureAdmin(req: any, res: any): Promise<{ id: string } | null> {
  const userId = extractUserId(req);
  if (!userId) { res.status(401).json({ error: 'Unauthorized' }); return null; }
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, role: true } });
  if (!user || user.role !== 'admin') { res.status(403).json({ error: 'Forbidden' }); return null; }
  return user;
}

// GET /admin/users-metrics
router.get('/users-metrics', async (req, res): Promise<void> => {
  try {
    const admin = await ensureAdmin(req, res); if (!admin) return;
    const limit = Math.min(Number(req.query.limit) || 20, 200);
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    const sort = typeof req.query.sort === 'string' ? req.query.sort : 'fullname';
    const order: 'asc' | 'desc' = req.query.order === 'desc' ? 'desc' : 'asc';
    const activity = req.query.activity === 'active' || req.query.activity === 'inactive' ? req.query.activity : undefined;
    const includeOverall = req.query.includeOverall === '1' || req.query.includeOverall === 'true';
    // Basic cursor NOT implemented (we always return single page). Accept param but ignore.

    const where: any = { role: { not: 'admin' } };
    if (q) {
      where.OR = [
        { fullname: { contains: q, mode: 'insensitive' } },
        { email: { contains: q, mode: 'insensitive' } }
      ];
    }
    const now = new Date();
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    if (activity === 'active') {
      where.lastSignIn = { gte: sevenDaysAgo };
    } else if (activity === 'inactive') {
      // Either never signed in or older than 7 days
      where.OR = (where.OR || []).concat([
        { lastSignIn: { lt: sevenDaysAgo } },
        { lastSignIn: null }
      ]);
    }

    const orderBy: any = (() => {
      switch (sort) {
        case 'timeSpent': return { timeSpent: order };
        case 'documentsViewed': return { documentsViewed: order };
        case 'lastSignIn': return { lastSignIn: order };
        case 'createdAt': return { createdAt: order };
        case 'fullname':
        default: return { fullname: order };
      }
    })();

    const usersRaw = await prisma.user.findMany({
      where,
      orderBy,
      take: limit,
      select: {
        id: true, fullname: true, email: true, role: true, createdAt: true,
        lastSignIn: true, numberOfSignIns: true, documentsViewed: true, timeSpent: true, recentDocs: true
      }
    });

    const users = usersRaw.map(u => {
      const last = u.lastSignIn ? new Date(u.lastSignIn) : null;
      const daysInactive = last ? Math.floor((now.getTime() - last.getTime()) / (1000*60*60*24)) : 9999;
      return {
        id: u.id,
        fullname: u.fullname,
        email: u.email,
        role: u.role,
        createdAt: u.createdAt,
        lastSignIn: u.lastSignIn,
        numberOfSignIns: u.numberOfSignIns,
        documentsViewed: u.documentsViewed,
        timeSpent: u.timeSpent,
        recentDocs: u.recentDocs || [],
        daysInactive
      };
    });

    let overallMetrics: any = null;
    if (includeOverall) {
      const all = await prisma.user.findMany({ where: { role: { not: 'admin' } }, select: { id:true, fullname:true, timeSpent:true, documentsViewed:true, numberOfSignIns:true, lastSignIn:true, createdAt:true } });
      const totalUsers = all.length;
      const activeUsers = all.filter(u => u.lastSignIn && u.lastSignIn >= sevenDaysAgo).length;
      const inactiveUsers = totalUsers - activeUsers;
      const totalTime = all.reduce((s,u)=>s+u.timeSpent,0);
      const totalDocs = all.reduce((s,u)=>s+u.documentsViewed,0);
      const totalSignIns = all.reduce((s,u)=>s+u.numberOfSignIns,0);
      const mostActive = all.reduce((a,b)=> b.timeSpent > a.timeSpent ? b : a, all[0] || { fullname:'', timeSpent:0 });
      const newUsersThisWeek = all.filter(u => u.createdAt >= sevenDaysAgo).length;
      overallMetrics = {
        totalUsers,
        activeUsers,
        inactiveUsers,
        averageTimeSpent: totalUsers ? Math.round(totalTime/totalUsers) : 0,
        totalDocumentViews: totalDocs,
        averageSignIns: totalUsers ? +(totalSignIns/totalUsers).toFixed(2) : 0,
        newUsersThisWeek,
        mostActiveUser: mostActive ? { name: mostActive.fullname, timeSpent: mostActive.timeSpent } : { name: '', timeSpent: 0 }
      };
    }

  res.json({
      users,
      pageInfo: { nextCursor: null, hasNextPage: false, count: users.length },
      overallMetrics
    });
  } catch (e) {
    console.error('users-metrics error', e);
    res.status(500).json({ error: 'Failed to fetch users metrics' });
  }
});

// GET /admin/inactive-users?days=7
router.get('/inactive-users', async (req, res): Promise<void> => {
  try {
    const admin = await ensureAdmin(req, res); if (!admin) return;
    const days = Math.max(1, Math.min(365, Number(req.query.days) || 7));
    const threshold = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const inactive = await prisma.user.findMany({
      where: {
        role: { not: 'admin' },
        OR: [
          { lastSignIn: null },
          { lastSignIn: { lt: threshold } }
        ]
      },
      select: { id:true, fullname:true, email:true, lastSignIn:true }
    });
    const inactiveUsers = inactive.map(u => ({
      id: u.id,
      name: u.fullname,
      email: u.email,
      lastSignIn: u.lastSignIn,
      daysInactive: u.lastSignIn ? Math.floor((Date.now() - new Date(u.lastSignIn).getTime())/(1000*60*60*24)) : days
    }));
  res.json({ inactiveUsers });
  } catch (e) {
    console.error('inactive-users error', e);
    res.status(500).json({ error: 'Failed to fetch inactive users' });
  }
});

// POST /admin/ping-users { userIds:[], message }
router.post('/ping-users', async (req, res): Promise<void> => {
  try {
    const admin = await ensureAdmin(req, res); if (!admin) return;
    const { userIds, message } = req.body || {};
    if (!Array.isArray(userIds) || userIds.length === 0 || typeof message !== 'string') {
      res.status(400).json({ error: 'userIds[] and message are required' });
      return;
    }
    // Create notifications for targeted users
    await prisma.notification.createMany({
      data: userIds.map((id: string) => ({
        type: 'ping',
        title: 'Admin Message',
        message: message.slice(0, 200),
        userId: id
      }))
    });
  res.json({ message: 'Ping notifications sent', count: userIds.length });
  } catch (e) {
    console.error('ping-users error', e);
    res.status(500).json({ error: 'Failed to send pings' });
  }
});