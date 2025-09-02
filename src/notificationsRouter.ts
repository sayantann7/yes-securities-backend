import { Router } from 'express';
import { prisma } from './prisma';
import jwt from 'jsonwebtoken';

const router = Router();
const JWT_SECRET = process.env.JWT_SECRET;

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

// Helper: compute cutoff (24h ago)
function retentionCutoff(): Date {
  return new Date(Date.now() - 24 * 60 * 60 * 1000);
}

// One-shot async cleanup (ignore errors)
export async function purgeOldNotifications() {
  try {
    const cutoff = retentionCutoff();
    const result = await prisma.notification.deleteMany({ where: { createdAt: { lt: cutoff } } });
    if (result.count) {
      console.log(`🧹 Purged ${result.count} old notifications (older than 24h)`);
    }
  } catch (e) {
    console.error('Notification purge failed:', e);
  }
}

// Schedule daily purge at roughly midnight server time
let purgeScheduled = false;
function scheduleDailyPurge() {
  if (purgeScheduled) return;
  purgeScheduled = true;
  const run = async () => {
    await purgeOldNotifications();
    // Schedule next run in 24h
    setTimeout(run, 24 * 60 * 60 * 1000);
  };
  // Initial delay: run once on startup after brief delay
  setTimeout(run, 10_000);
}
scheduleDailyPurge();

// List notifications (optionally unread only) (24h retention enforced)
router.get('/', async (req, res): Promise<void> => {
  try {
    const userId = extractUserId(req);
  if (!userId) { res.status(401).json({ error: 'Unauthorized' }); return; }
    const unreadOnly = req.query.unread === 'true';
    const where: any = { userId, createdAt: { gte: retentionCutoff() } };
    if (unreadOnly) where.read = false;
    const notifications = await prisma.notification.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 200
    });
  res.json({ notifications });
  } catch (e) {
    console.error('List notifications error:', e);
    res.status(500).json({ error: 'Failed to fetch notifications' });
  }
});

// Mark one notification read
router.post('/:id/read', async (req, res): Promise<void> => {
  try {
    const userId = extractUserId(req);
  if (!userId) { res.status(401).json({ error: 'Unauthorized' }); return; }
    const id = req.params.id;
    await prisma.notification.updateMany({ where: { id, userId }, data: { read: true } });
  res.json({ message: 'Notification marked read' });
  } catch (e) {
    console.error('Mark notification read error:', e);
    res.status(500).json({ error: 'Failed to mark read' });
  }
});

// Mark all read
router.post('/read-all', async (req, res): Promise<void> => {
  try {
    const userId = extractUserId(req);
  if (!userId) { res.status(401).json({ error: 'Unauthorized' }); return; }
    const updated = await prisma.notification.updateMany({ where: { userId, read: false }, data: { read: true } });
  res.json({ message: 'All notifications marked read', updated: updated.count });
  } catch (e) {
    console.error('Mark all read error:', e);
    res.status(500).json({ error: 'Failed to mark all read' });
  }
});

export default router;