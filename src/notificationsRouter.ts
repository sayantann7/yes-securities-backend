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

// List notifications (optionally unread only)
router.get('/', async (req, res): Promise<void> => {
  try {
    const userId = extractUserId(req);
  if (!userId) { res.status(401).json({ error: 'Unauthorized' }); return; }
    const unreadOnly = req.query.unread === 'true';
    const where: any = { userId };
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