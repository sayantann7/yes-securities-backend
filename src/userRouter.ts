import { Router, Request, Response } from "express";
import { prisma } from "./prisma";
import jwt from "jsonwebtoken";
import { BookmarkService } from "./bookmarkServiceOptimized";

const router = Router();

const JWT_SECRET = process.env.JWT_SECRET;

// @ts-ignore
router.post("/signin", async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body || {};
    if (typeof email !== 'string' || typeof password !== 'string') {
      return res.status(400).json({ error: 'Invalid payload' });
    }
    const trimmedEmail = email.trim().toLowerCase();
    const pwd = password;
    const emailRegex = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
    if (!emailRegex.test(trimmedEmail) || pwd.length < 1) { // allow initial short numeric AD ID passwords
      return res.status(400).json({ error: 'Invalid email or password format' });
    }
    const user = await prisma.user.findUnique({ where: { email: trimmedEmail } });
    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    // Account lock check
    if (user.lockUntil && user.lockUntil > new Date()) {
      return res.status(423).json({ error: 'Account locked. Try again later.' });
    }
    // Compare password (hashing). If passwords not yet hashed (legacy), detect and migrate.
    const bcrypt = require('bcrypt');
    let passwordMatches = false;
    if (user.password.startsWith('$2')) {
      passwordMatches = await bcrypt.compare(pwd, user.password);
    } else {
      // Legacy plain password match then re-hash
      if (user.password === pwd) {
        passwordMatches = true;
        const newHash = await bcrypt.hash(pwd, 12);
        await prisma.user.update({ where: { id: user.id }, data: { password: newHash } });
      }
    }
    if (!passwordMatches) {
      const attempts = (user.failedLoginAttempts || 0) + 1;
      let lockUntil: Date | undefined = undefined;
      if (attempts >= 5) { // threshold
        lockUntil = new Date(Date.now() + 30 * 60 * 1000); // 30 mins
      }
      await prisma.user.update({ where: { id: user.id }, data: { failedLoginAttempts: attempts, lockUntil } });
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    // Reset failed attempts
    const updatedUser = await prisma.user.update({
      where: { id: user.id },
      data: {
        lastSignIn: new Date(),
        numberOfSignIns: user.numberOfSignIns + 1,
        failedLoginAttempts: 0,
        lockUntil: null
      },
      select: {
        id: true, email: true, fullname: true, role: true, createdAt: true, lastSignIn: true,
        numberOfSignIns: true, timeSpent: true, documentsViewed: true, recentDocs: true, mustChangePassword: true
      }
    });
    const token = jwt.sign({ userId: user.id, email: user.email }, JWT_SECRET as string, { expiresIn: '24h' });
    res.json({
      message: 'Sign in successful',
      token,
      user: {
        id: updatedUser.id,
        email: updatedUser.email,
        fullname: updatedUser.fullname,
        role: updatedUser.role,
        createdAt: updatedUser.createdAt,
        lastSignIn: updatedUser.lastSignIn,
        numberOfSignIns: updatedUser.numberOfSignIns,
        timeSpent: updatedUser.timeSpent,
        documentsViewed: updatedUser.documentsViewed,
  recentDocs: updatedUser.recentDocs,
  mustChangePassword: updatedUser.mustChangePassword
      }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to sign in' });
  }
});

// @ts-ignore
router.put("/user", async (req: Request, res: Response) => {
  try {
    const { email, fullname } = req.body;

    if (!email || !fullname) {
      return res.status(400).json({ error: "Email and Fullname are required" });
    }

    const user = await prisma.user.findUnique({
      where: { email: String(email) },
    });

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    // Update user in database
    const updatedUser = await prisma.user.update({
      where: { id: user.id },
      data: {
        fullname: String(fullname),
        email: String(email),
        updatedAt: new Date(),
      },
    });

    res.json({ 
      message: "User updated successfully", 
      user: updatedUser 
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to update user" });
  }
});

// @ts-ignore
router.post("/documentViewed", async (req: Request, res: Response) => {
  try {
    const { userEmail, documentId } = req.body;

    if (!userEmail || !documentId) {
      return res.status(400).json({ error: "User email and Document ID are required" });
    }

    const user = await prisma.user.findUnique({
      where: { email: String(userEmail) },
    });

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    // Update user's viewed documents in database
    const updatedUser = await prisma.user.update({
      where: { id: user.id },
      data: {
        documentsViewed : user.documentsViewed + 1,
      },
    });

    res.json({ 
      message: "Document viewed successfully", 
      user: updatedUser 
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to update viewed document" });
  }
});

// @ts-ignore
router.post("/updateTime", async (req: Request, res: Response) => {
  try {
    const { userEmail, timeSpent } = req.body;

    if (!userEmail || !timeSpent) {
      return res.status(400).json({ error: "User email and time spent are required" });
    }

    const user = await prisma.user.findUnique({
      where: { email: String(userEmail) },
    });

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    // Update user's time spent in database
    const updatedUser = await prisma.user.update({
      where: { id: user.id },
      data: {
        timeSpent : user.timeSpent + Number(timeSpent),
      },
    });

    res.json({ 
      message: "Time updated successfully", 
      user: updatedUser 
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to update time" });
  }
});

// @ts-ignore
router.put("/changePassword", async (req: Request, res: Response) => {
  try {
    const { email, currentPassword, newPassword } = req.body || {};
    if (typeof email !== 'string' || typeof currentPassword !== 'string' || typeof newPassword !== 'string') {
      return res.status(400).json({ error: 'Invalid payload' });
    }
    const user = await prisma.user.findUnique({ where: { email: email.trim().toLowerCase() } });
    if (!user) return res.status(404).json({ error: 'User not found' });
    const bcrypt = require('bcrypt');
    let matches = false;
    if (user.password.startsWith('$2')) {
      matches = await bcrypt.compare(currentPassword, user.password);
    } else if (user.password === currentPassword) {
      matches = true;
      // migrate old hash
      const migrated = await bcrypt.hash(currentPassword, 12);
      await prisma.user.update({ where: { id: user.id }, data: { password: migrated } });
    }
    if (!matches) return res.status(401).json({ error: 'Current password is incorrect' });
    // Strong password policy: 12+ chars, upper, lower, number, symbol
    const policy = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^\w\s]).{6,}$/; // reduced to 6+ chars per new requirement
    if (!policy.test(newPassword)) {
      return res.status(400).json({ error: 'Password must be 6+ chars incl upper, lower, number & symbol' });
    }
    const newHash = await bcrypt.hash(newPassword, 12);
  await prisma.user.update({ where: { id: user.id }, data: { password: newHash, updatedAt: new Date() } });
  res.json({ message: 'Password updated successfully' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update password' });
  }
});

// @ts-ignore
router.get("/getBiweeklyMetrics", async (req: Request, res: Response) => {
  try {
    // Get current date
    const today = new Date();
    
    // Calculate start and end of current week (Sunday to Saturday)
    const currentWeekStart = new Date(today);
    currentWeekStart.setDate(today.getDate() - today.getDay()); // Go back to the last Sunday
    currentWeekStart.setHours(0, 0, 0, 0); // Start of day
    
    const currentWeekEnd = new Date(today);
    currentWeekEnd.setHours(23, 59, 59, 999); // End of current day
    
    // Calculate start and end of previous week
    const previousWeekStart = new Date(currentWeekStart);
    previousWeekStart.setDate(currentWeekStart.getDate() - 7); // Previous Sunday
    
    const previousWeekEnd = new Date(previousWeekStart);
    previousWeekEnd.setDate(previousWeekStart.getDate() + 6); // Previous Saturday
    previousWeekEnd.setHours(23, 59, 59, 999); // End of day
    
    // Get metrics for current week
    const currentWeekMetrics = await prisma.user.aggregate({
      _sum: {
        timeSpent: true,
        documentsViewed: true,
        numberOfSignIns: true
      },
      where: {
        role: {
          not: "admin"
        },
        lastSignIn: {
          gte: currentWeekStart,
          lte: currentWeekEnd
        }
      }
    });
    
    // Get metrics for previous week
    const previousWeekMetrics = await prisma.user.aggregate({
      _sum: {
        timeSpent: true,
        documentsViewed: true,
        numberOfSignIns: true
      },
      where: {
        role: {
          not: "admin"
        },
        lastSignIn: {
          gte: previousWeekStart,
          lte: previousWeekEnd
        }
      }
    });
    
    res.json({
      message: "Biweekly metrics fetched successfully",
      currentWeek: {
        timeSpent: currentWeekMetrics._sum.timeSpent || 0,
        documentsViewed: currentWeekMetrics._sum.documentsViewed || 0,
        signIns: currentWeekMetrics._sum.numberOfSignIns || 0,
        startDate: currentWeekStart,
        endDate: currentWeekEnd
      },
      previousWeek: {
        timeSpent: previousWeekMetrics._sum.timeSpent || 0,
        documentsViewed: previousWeekMetrics._sum.documentsViewed || 0,
        signIns: previousWeekMetrics._sum.numberOfSignIns || 0,
        startDate: previousWeekStart,
        endDate: previousWeekEnd
      }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch biweekly metrics" });
  }
});

// @ts-ignore
router.get("/userDetails", async (req: Request, res: Response) => {
  try {
    const { userEmail } = req.query;

    if (!userEmail) {
      return res.status(400).json({ error: "User email is required" });
    }

    const user = await prisma.user.findUnique({
      where: { email: String(userEmail) },
    });

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    res.json({ 
      message: "User details fetched successfully", 
      user: {
        id: user.id,
        email: user.email,
        fullname: user.fullname,
        role: user.role,
        createdAt: user.createdAt,
        lastSignIn: user.lastSignIn,
        numberOfSignIns: user.numberOfSignIns,
        documentsViewed: user.documentsViewed,
        timeSpent: user.timeSpent,
        recentDocs: user.recentDocs || [],
      }
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch user details" });
  }
});

// @ts-ignore
router.post("/comment", async (req: Request, res: Response) => {
  try{
    const { email, documentId, comment } = req.body;

    if (!email || !documentId || !comment) {
      return res.status(400).json({ error: "Email, Document ID and comment are required" });
    }
    
    const user = await prisma.user.findUnique({
      where: { email: String(email) },
    });

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    // Save comment to database
    const newComment = await prisma.comment.create({
      //@ts-ignore
      data: {
        userId: user?.id,
        documentId: String(documentId),
        content: comment,
      },
    });

    // Send notifications to admin and sales team members (excluding the comment author)
    try {
      const recipients = await prisma.user.findMany({
        where: {
          AND: [
            { id: { not: user.id } },
            { role: { in: ['admin', 'sales'] } }
          ]
        },
        select: {
          id: true,
          fullname: true
        }
      });

      // Create notifications for all recipients
      if (recipients.length > 0) {
        const notifications = recipients.map(recipient => ({
          type: 'comment',
          title: 'New Comment',
          message: `${user.fullname} commented on a document: ${comment.substring(0, 100)}${comment.length > 100 ? '...' : ''}`,
          userId: recipient.id,
          documentId: String(documentId),
          senderId: user.id
        }));

        await prisma.notification.createMany({
          data: notifications,
          skipDuplicates: true
        });
      }
    } catch (notificationError) {
      console.error('Failed to send comment notifications:', notificationError);
      // Don't fail the comment creation if notification fails
      // Log the error but continue with the response
    }

    res.json({ 
      message: "Comment added successfully", 
      comment: newComment 
    });

  }catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to add comment" });
  }
});

// --------------------------------------------------
// Additional Comment Endpoints (CRUD + listing) to support admin web app
// --------------------------------------------------
// Get comments for a document
// @ts-ignore
router.get('/comments', async (req: Request, res: Response) => {
  try {
    const { documentId } = req.query;
    if (!documentId) {
      return res.status(400).json({ error: 'documentId is required' });
    }
    const comments = await prisma.comment.findMany({
      where: { documentId: String(documentId) },
      orderBy: { createdAt: 'asc' },
      include: {
        user: { select: { id: true, fullname: true, email: true } }
      }
    });
    res.json({ message: 'Comments fetched successfully', comments });
  } catch (err) {
    console.error('Failed to fetch comments:', err);
    res.status(500).json({ error: 'Failed to fetch comments' });
  }
});

// Get all comments grouped by document
// @ts-ignore
router.get('/comments/all', async (_req: Request, res: Response) => {
  try {
    const comments = await prisma.comment.findMany({
      orderBy: { createdAt: 'asc' },
      include: { user: { select: { id: true, fullname: true, email: true } } }
    });
    const commentsByDocument: Record<string, any[]> = {};
    for (const c of comments) {
      if (!commentsByDocument[c.documentId]) commentsByDocument[c.documentId] = [];
      commentsByDocument[c.documentId].push(c);
    }
    res.json({ message: 'All comments fetched successfully', commentsByDocument });
  } catch (err) {
    console.error('Failed to fetch all comments:', err);
    res.status(500).json({ error: 'Failed to fetch all comments' });
  }
});

// Update a comment: since frontend provides documentId + comment text (new), update latest comment by same user on that document
// @ts-ignore
router.put('/comment', async (req: Request, res: Response) => {
  try {
    const { email, documentId, comment } = req.body;
    if (!email || !documentId || !comment) {
      return res.status(400).json({ error: 'Email, documentId and comment are required' });
    }
    const user = await prisma.user.findUnique({ where: { email: String(email) } });
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    // find latest comment by user on document
    const existing = await prisma.comment.findFirst({
      where: { userId: user.id, documentId: String(documentId) },
      orderBy: { createdAt: 'desc' }
    });
    if (!existing) {
      return res.status(404).json({ error: 'No existing comment to update' });
    }
    const updated = await prisma.comment.update({
      where: { id: existing.id },
      data: { content: String(comment), updatedAt: new Date() }
    });
    res.json({ message: 'Comment updated successfully', comment: updated });
  } catch (err) {
    console.error('Failed to update comment:', err);
    res.status(500).json({ error: 'Failed to update comment' });
  }
});

// Delete a comment: identify by user + document + exact content match (first match)
// @ts-ignore
router.delete('/comment', async (req: Request, res: Response) => {
  try {
    const { email, documentId, comment } = req.body;
    if (!email || !documentId || !comment) {
      return res.status(400).json({ error: 'Email, documentId and comment are required' });
    }
    const user = await prisma.user.findUnique({ where: { email: String(email) } });
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    const existing = await prisma.comment.findFirst({
      where: { userId: user.id, documentId: String(documentId), content: String(comment) },
      orderBy: { createdAt: 'asc' }
    });
    if (!existing) {
      return res.status(404).json({ error: 'Comment not found' });
    }
    await prisma.comment.delete({ where: { id: existing.id } });
    res.json({ message: 'Comment deleted successfully' });
  } catch (err) {
    console.error('Failed to delete comment:', err);
    res.status(500).json({ error: 'Failed to delete comment' });
  }
});

// --------------------------------------------------
// Recent Documents Endpoints (persist in user.recentDocs JSON array)
// --------------------------------------------------
// @ts-ignore
router.get('/recent-documents', async (req: Request, res: Response) => {
  try {
    const { userEmail } = req.query;
    if (!userEmail) return res.status(400).json({ error: 'userEmail is required' });
    const user = await prisma.user.findUnique({ where: { email: String(userEmail) } });
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json({ message: 'Recent documents fetched successfully', recentDocuments: user.recentDocs || [] });
  } catch (err) {
    console.error('Failed to fetch recent documents:', err);
    res.status(500).json({ error: 'Failed to fetch recent documents' });
  }
});

// @ts-ignore
router.post('/recent-documents', async (req: Request, res: Response) => {
  try {
    const { userEmail, document } = req.body;
    if (!userEmail || !document) return res.status(400).json({ error: 'userEmail and document are required' });
    const user = await prisma.user.findUnique({ where: { email: String(userEmail) } });
    if (!user) return res.status(404).json({ error: 'User not found' });
    const current: string[] = Array.isArray(user.recentDocs) ? [...user.recentDocs] : [];
    const filtered = current.filter(d => d !== document);
    filtered.unshift(document);
    const trimmed = filtered.slice(0, 20); // cap list
    const updated = await prisma.user.update({ where: { id: user.id }, data: { recentDocs: trimmed } });
    res.json({ message: 'Recent documents updated', recentDocuments: updated.recentDocs || [] });
  } catch (err) {
    console.error('Failed to update recent documents:', err);
    res.status(500).json({ error: 'Failed to update recent documents' });
  }
});

// --------------------------------------------------
// Bookmark bridging endpoints under /user to align with admin web app expectations
// These delegate to BookmarkService methods (which expect req/res)
// --------------------------------------------------
// @ts-ignore
router.get('/bookmarks', async (req: Request, res: Response) => {
  await BookmarkService.getBookmarks(req, res);
});

// @ts-ignore
router.post('/bookmarks', async (req: Request, res: Response) => {
  await BookmarkService.createBookmark(req, res);
});

// @ts-ignore
router.delete('/bookmarks/:itemId', async (req: Request, res: Response) => {
  await BookmarkService.deleteBookmark(req, res);
});

// @ts-ignore
router.put("/comment", async (req: Request, res: Response) => {
  try{
    const { documentId, comment } = req.body;

    if (!documentId || !comment) {
      return res.status(400).json({ error: "Document ID and comment are required" });
    }
    
    const orgComment = await prisma.comment.findFirst({
      where: { documentId: String(documentId), content: String(comment) },
    });

    if (!orgComment) {
      return res.status(404).json({ error: "Comment not found" });
    }

    // Update comment in database
    const updatedComment = await prisma.comment.update({
      where: { id: orgComment.id },
      data: { content: comment },
    });

    res.json({ 
      message: "Comment updated successfully", 
      comment: updatedComment
    });

  }catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to update comment" });
  }
});

// @ts-ignore
router.delete("/comment", async (req: Request, res: Response) => {
  try{
    const { documentId, comment } = req.body;

    if (!documentId || !comment) {
      return res.status(400).json({ error: "Document ID and comment are required" });
    }
    
    const orgComment = await prisma.comment.findFirst({
      where: { documentId: String(documentId), content: String(comment) },
    });

    if (!orgComment) {
      return res.status(404).json({ error: "Comment not found" });
    }

    // Delete comment from database
    await prisma.comment.delete({
      where: { id: orgComment.id },
    });

    res.json({ 
      message: "Comment deleted successfully"
    });

  }catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to delete comment" });
  }
});

// @ts-ignore
router.get("/comments", async (req, res) => {
  try {
    const { documentId } = req.query;
    if (!documentId) {
      return res.status(400).json({ error: "Document ID is required" });
    }

    const comments = await prisma.comment.findMany({
      where: { documentId: String(documentId) },
      include: { user: true }
    });

    res.json({
      message: "Comments fetched successfully",
      comments,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch comments" });
  }
});

// @ts-ignore
router.get("/comments/all", async (req, res) => {
  try {
    // Get all comments with user details
    const comments = await prisma.comment.findMany({
      include: {
        user: {
          select: {
            id: true,
            fullname: true,
            email: true
          }
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    // Group comments by document
    const commentsByDocument: { [key: string]: any[] } = {};
    
    comments.forEach(comment => {
      if (!commentsByDocument[comment.documentId]) {
        commentsByDocument[comment.documentId] = [];
      }
      commentsByDocument[comment.documentId].push(comment);
    });

    res.json({
      message: "All comments fetched successfully",
      commentsByDocument,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch comments" });
  }
});

// @ts-ignore
router.get("/recent-documents", async (req, res) => {
  try {
    const { userEmail: recentUserEmail } = req.query;

    if (!recentUserEmail) {
      return res.status(400).json({ error: "User ID is required" });
    }

    const user = await prisma.user.findFirst({
      where: { email: typeof recentUserEmail === "string" ? recentUserEmail : Array.isArray(recentUserEmail) ? recentUserEmail[0] : "" }
    });

    const recentDocuments = user?.recentDocs;

    res.json({
      message: "Recent documents fetched successfully",
      recentDocuments : recentDocuments?.reverse() || [],
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch recent documents" });
  }
});

// @ts-ignore
router.post("/recent-documents", async (req, res) => {
  try {
    const { userEmail, document } = req.body;

    if (!userEmail || !document) {
      return res.status(400).json({ error: "User email and Document ID are required" });
    }

    const user = await prisma.user.findFirst({
      where: { email: userEmail }
    });

    const recentDocuments = user?.recentDocs;

    let docFound = false;

    recentDocuments?.forEach((doc: any) => {
      if (doc.id === document) {
        docFound = true;
      }
    });

    if (!docFound) {
      recentDocuments?.push(document);
    }

    if ((recentDocuments && recentDocuments.length > 10)) {
      recentDocuments.splice(0, recentDocuments.length - 10);
    }

    // Update user's recent documents in database
    await prisma.user.update({
      where: { id: user?.id },
      data: {
        recentDocs: recentDocuments,
      },
    });

    res.json({
      message: "Recent documents updated successfully",
      recentDocuments : user?.recentDocs.reverse() || [],
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to update recent documents" });
  }
});

// Get notifications for current user
// @ts-ignore
router.get("/notifications", async (req: Request, res: Response) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: "Authentication required" });
    }

    const token = authHeader.split(' ')[1];
    
    if (!JWT_SECRET) {
      console.error('JWT_SECRET is not configured');
      return res.status(500).json({ error: "Server configuration error" });
    }

    let decoded;
    try {
      decoded = jwt.verify(token, JWT_SECRET) as any;
    } catch (jwtError) {
      console.error('JWT verification failed:', jwtError);
      return res.status(401).json({ error: "Invalid or expired token" });
    }

    const userId = decoded.userId;
    if (!userId) {
      return res.status(401).json({ error: "Invalid token format" });
    }

    const notifications = await prisma.notification.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 50, // Limit to last 50 notifications
    });

    res.json({ notifications });
  } catch (error: any) {
    console.error("Error fetching notifications:", error);
    res.status(500).json({ error: "Failed to fetch notifications" });
  }
});

// Mark notification as read
// @ts-ignore
router.put("/notifications/:id/read", async (req: Request, res: Response) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: "Authentication required" });
    }

    const token = authHeader.split(' ')[1];
    
    if (!JWT_SECRET) {
      console.error('JWT_SECRET is not configured');
      return res.status(500).json({ error: "Server configuration error" });
    }

    let decoded;
    try {
      decoded = jwt.verify(token, JWT_SECRET) as any;
    } catch (jwtError) {
      console.error('JWT verification failed:', jwtError);
      return res.status(401).json({ error: "Invalid or expired token" });
    }

    const userId = decoded.userId;
    if (!userId) {
      return res.status(401).json({ error: "Invalid token format" });
    }

    const notificationId = req.params.id;
    if (!notificationId) {
      return res.status(400).json({ error: "Notification ID is required" });
    }

    await prisma.notification.updateMany({
      where: { 
        id: notificationId,
        userId: userId // Ensure user can only update their own notifications
      },
      data: { read: true }
    });

    res.json({ message: "Notification marked as read" });
  } catch (error: any) {
    console.error("Error marking notification as read:", error);
    res.status(500).json({ error: "Failed to mark notification as read" });
  }
});

// Mark all notifications as read
// @ts-ignore
router.put("/notifications/mark-all-read", async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: "Authentication required" });
    }

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, JWT_SECRET as string) as any;
    const userId = decoded.userId;

    await prisma.notification.updateMany({
      where: { userId },
      data: { read: true }
    });

    res.json({ message: "All notifications marked as read" });
  } catch (error: any) {
    console.error("Error marking all notifications as read:", error);
    res.status(500).json({ error: "Failed to mark all notifications as read" });
  }
});

// Send comment notification
// @ts-ignore
router.post("/notifications/comment", async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: "Authentication required" });
    }

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, JWT_SECRET as string) as any;
    const senderId = decoded.userId;

    const { documentId, commentText } = req.body;

    // Get sender info
    const sender = await prisma.user.findUnique({
      where: { id: senderId }
    });

    if (!sender) {
      return res.status(404).json({ error: "Sender not found" });
    }

    // Get all admin and sales team members (excluding the sender)
    const recipients = await prisma.user.findMany({
      where: {
        AND: [
          { id: { not: senderId } },
          { role: { in: ['admin', 'sales'] } }
        ]
      }
    });

    // Create notifications for all recipients
    const notifications = recipients.map(recipient => ({
      type: 'comment',
      title: 'New Comment',
      message: `${sender.fullname} commented on a document: ${commentText}`,
      userId: recipient.id,
      documentId,
      senderId
    }));

    await prisma.notification.createMany({
      data: notifications
    });

    res.json({ message: "Comment notifications sent" });
  } catch (error: any) {
    console.error("Error sending comment notification:", error);
    res.status(500).json({ error: "Failed to send comment notification" });
  }
});

// Send upload notification (admin only)
// @ts-ignore
router.post("/notifications/upload", async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: "Authentication required" });
    }

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, JWT_SECRET as string) as any;
    const senderId = decoded.userId;

    // Verify sender is admin
    const sender = await prisma.user.findUnique({
      where: { id: senderId }
    });

    if (!sender || sender.role !== 'admin') {
      return res.status(403).json({ error: "Admin access required" });
    }

    const { fileName, folderPath } = req.body;

    // Get all users except admin
    const recipients = await prisma.user.findMany({
      where: {
        AND: [
          { id: { not: senderId } },
          { role: { not: 'admin' } }
        ]
      }
    });

    // Create notifications for all recipients
    const notifications = recipients.map(recipient => ({
      type: 'upload',
      title: 'New Document Uploaded',
      message: `Admin uploaded new files: ${fileName} in ${folderPath}`,
      userId: recipient.id,
      senderId
    }));

    await prisma.notification.createMany({
      data: notifications
    });

    res.json({ message: "Upload notifications sent" });
  } catch (error: any) {
    console.error("Error sending upload notification:", error);
    res.status(500).json({ error: "Failed to send upload notification" });
  }
});

// Get inactive users (admin only)
// @ts-ignore
router.get("/admin/inactive-users", async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: "Authentication required" });
    }

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, JWT_SECRET as string) as any;
    const userId = decoded.userId;

    // Verify user is admin
    const user = await prisma.user.findUnique({
      where: { id: userId }
    });

    if (!user || user.role !== 'admin') {
      return res.status(403).json({ error: "Admin access required" });
    }

    const days = parseInt(req.query.days as string) || 7;
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - days);

    const inactiveUsers = await prisma.user.findMany({
      where: {
        AND: [
          { role: { not: 'admin' } },
          { 
            OR: [
              { lastSignIn: { lt: cutoffDate } },
              { lastSignIn: null }
            ]
          }
        ]
      },
      select: {
        id: true,
        fullname: true,
        email: true,
        lastSignIn: true
      }
    });

    const inactiveUsersWithDays = inactiveUsers.map(user => {
      const daysInactive = user.lastSignIn 
        ? Math.floor((new Date().getTime() - user.lastSignIn.getTime()) / (1000 * 60 * 60 * 24))
        : 365; // If never signed in, consider as 365 days

      return {
        id: user.id,
        name: user.fullname,
        email: user.email,
        lastSignIn: user.lastSignIn?.toISOString() || 'Never',
        daysInactive
      };
    });

    res.json({ inactiveUsers: inactiveUsersWithDays });
  } catch (error: any) {
    console.error("Error fetching inactive users:", error);
    res.status(500).json({ error: "Failed to fetch inactive users" });
  }
});

// Ping inactive users (admin only)
// @ts-ignore
router.post("/admin/ping-users", async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: "Authentication required" });
    }

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, JWT_SECRET as string) as any;
    const senderId = decoded.userId;

    // Verify sender is admin
    const sender = await prisma.user.findUnique({
      where: { id: senderId }
    });

    if (!sender || sender.role !== 'admin') {
      return res.status(403).json({ error: "Admin access required" });
    }

    const { userIds, message } = req.body;

    if (!Array.isArray(userIds) || userIds.length === 0) {
      return res.status(400).json({ error: "User IDs array is required" });
    }

    if (!message || !message.trim()) {
      return res.status(400).json({ error: "Message is required" });
    }

    // Create notifications for selected users
    const notifications = userIds.map(userId => ({
      type: 'ping',
      title: 'Message from Admin',
      message: message.trim(),
      userId,
      senderId
    }));

    await prisma.notification.createMany({
      data: notifications
    });

    res.json({ message: "Ping notifications sent" });
  } catch (error: any) {
    console.error("Error pinging users:", error);
    res.status(500).json({ error: "Failed to ping users" });
  }
});

// Get all users with metrics (admin only)
// @ts-ignore
// In-memory cache for overall metrics (TTL ~30s)
let overallMetricsCache: { data: any; fetchedAt: number } | null = null;
const OVERALL_METRICS_TTL_MS = 30 * 1000;

// Paginated users metrics endpoint with cursor pagination, filtering & sorting
// Query params: limit (default 50), cursor (user id), q (search), sort, order, activity (active|inactive|never), includeOverall=1 (force include metrics on non-first pages)
// @ts-ignore
router.get("/admin/users-metrics", async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: "Authentication required" });
    }

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, JWT_SECRET as string) as any;
    const userId = decoded.userId;

    // Verify user is admin
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user || user.role !== 'admin') {
      return res.status(403).json({ error: "Admin access required" });
    }

    // Parse query params
  const rawLimit = parseInt(req.query.limit as string) || 20; // lowered default page size
    const limit = Math.min(Math.max(rawLimit, 1), 200);
    const cursor = (req.query.cursor as string) || undefined;
    const q = (req.query.q as string || '').trim();
    const sort = (req.query.sort as string) || 'createdAt';
    const order = (req.query.order as string) === 'asc' ? 'asc' : 'desc';
    const activity = (req.query.activity as string) || undefined; // active | inactive | never
    const includeOverall = req.query.includeOverall === '1' || !cursor; // include on first page by default

    // Whitelist sortable fields
    const allowedSort = new Set(['createdAt','lastSignIn','timeSpent','documentsViewed','numberOfSignIns','fullname']);
    const sortField = allowedSort.has(sort) ? sort : 'createdAt';

    // Build where clause
    const where: any = { role: { not: 'admin' } };
    if (q) {
      where.OR = [
        { fullname: { contains: q, mode: 'insensitive' } },
        { email: { contains: q, mode: 'insensitive' } }
      ];
    }

    const now = new Date();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    if (activity === 'active') {
      where.AND = [
        ...(where.AND || []),
        { numberOfSignIns: { gt: 0 } },
        { lastSignIn: { gte: sevenDaysAgo } }
      ];
    } else if (activity === 'inactive') {
      // Align inactive definition with export endpoint: lastSignIn older than 7 days OR null OR never signed in
      where.AND = [
        ...(where.AND || []),
        { OR: [ { lastSignIn: { lt: sevenDaysAgo } }, { lastSignIn: null }, { numberOfSignIns: 0 } ] }
      ];
    } else if (activity === 'never') {
      where.AND = [
        ...(where.AND || []),
        { OR: [ { numberOfSignIns: 0 }, { lastSignIn: null } ] }
      ];
    }

    // Build orderBy (ensure deterministic second key)
    const orderBy: any = [{ [sortField]: order }];
    if (sortField !== 'id') orderBy.push({ id: 'asc' });

    // Fetch page (cursor-based)
    const users = await prisma.user.findMany({
      where,
      select: {
        id: true,
        fullname: true,
        email: true,
  role: true,
        createdAt: true,
        lastSignIn: true,
        numberOfSignIns: true,
        documentsViewed: true,
        timeSpent: true
      },
      orderBy,
      take: limit + 1,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {})
    });

    const hasNextPage = users.length > limit;
    const pageItems = hasNextPage ? users.slice(0, limit) : users;
    const nextCursor = hasNextPage ? pageItems[pageItems.length - 1].id : null;

    // Enrich items with daysInactive & normalized lastSignIn string
    const page = pageItems.map(u => {
      const last = u.lastSignIn ? new Date(u.lastSignIn) : null;
      const daysInactive = last ? Math.floor((now.getTime() - last.getTime()) / (1000 * 60 * 60 * 24)) : 999;
      return {
        ...u,
        lastSignIn: u.lastSignIn ? u.lastSignIn.toISOString() : 'Never',
        daysInactive
      };
    });

    let overallMetrics: any = undefined;
    if (includeOverall) {
      // Serve from cache if fresh
      const fresh = overallMetricsCache && (Date.now() - overallMetricsCache.fetchedAt) < OVERALL_METRICS_TTL_MS;
      if (fresh && overallMetricsCache) {
        overallMetrics = overallMetricsCache.data;
      } else {
        // Compute overall metrics using lightweight aggregate queries
        const oneWeekAgo = sevenDaysAgo;
        const [totalUsers, activeUsersCount, neverLoggedInUsersCount, aggregates, mostActiveUser, newUsersThisWeek] = await Promise.all([
          prisma.user.count({ where: { role: { not: 'admin' } } }),
          prisma.user.count({ where: { role: { not: 'admin' }, numberOfSignIns: { gt: 0 }, lastSignIn: { gte: oneWeekAgo } } }),
            prisma.user.count({ where: { role: { not: 'admin' }, OR: [ { numberOfSignIns: 0 }, { lastSignIn: null } ] } }),
          prisma.user.aggregate({ where: { role: { not: 'admin' } }, _sum: { timeSpent: true, documentsViewed: true, numberOfSignIns: true } }),
          prisma.user.findFirst({ where: { role: { not: 'admin' } }, orderBy: { timeSpent: 'desc' }, select: { fullname: true, timeSpent: true } }),
          prisma.user.count({ where: { role: { not: 'admin' }, createdAt: { gte: oneWeekAgo } } })
        ]);

        const inactiveUsers = totalUsers - activeUsersCount;
        overallMetrics = {
          totalUsers,
          activeUsers: activeUsersCount,
          inactiveUsers,
          neverLoggedInUsers: neverLoggedInUsersCount,
          averageTimeSpent: totalUsers > 0 ? Math.round((aggregates._sum.timeSpent || 0) / totalUsers) : 0,
          totalDocumentViews: aggregates._sum.documentsViewed || 0,
          averageSignIns: totalUsers > 0 ? Math.round((aggregates._sum.numberOfSignIns || 0) / totalUsers) : 0,
          newUsersThisWeek,
          mostActiveUser: mostActiveUser ? { name: mostActiveUser.fullname, timeSpent: mostActiveUser.timeSpent } : { name: 'N/A', timeSpent: 0 }
        };
        overallMetricsCache = { data: overallMetrics, fetchedAt: Date.now() };
      }
    }

    res.json({
      users: page,
      pageInfo: { nextCursor, hasNextPage, count: page.length },
      overallMetrics
    });
  } catch (error: any) {
    console.error("Error fetching user metrics:", error);
    res.status(500).json({ error: "Failed to fetch user metrics" });
  }
});

// Separate endpoint to force refresh overall metrics (optional client usage)
// @ts-ignore
router.get('/admin/users-overall', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: "Authentication required" });
    }
    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, JWT_SECRET as string) as any;
    const userId = decoded.userId;
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user || user.role !== 'admin') {
      return res.status(403).json({ error: "Admin access required" });
    }

    const now = new Date();
    const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const force = req.query.force === '1';

    const fresh = !force && overallMetricsCache && (Date.now() - overallMetricsCache.fetchedAt) < OVERALL_METRICS_TTL_MS;
    if (fresh && overallMetricsCache) {
      return res.json({ overallMetrics: overallMetricsCache.data, cached: true });
    }

    const [totalUsers, activeUsersCount, neverLoggedInUsersCount, aggregates, mostActiveUser, newUsersThisWeek] = await Promise.all([
      prisma.user.count({ where: { role: { not: 'admin' } } }),
      prisma.user.count({ where: { role: { not: 'admin' }, numberOfSignIns: { gt: 0 }, lastSignIn: { gte: oneWeekAgo } } }),
      prisma.user.count({ where: { role: { not: 'admin' }, OR: [ { numberOfSignIns: 0 }, { lastSignIn: null } ] } }),
      prisma.user.aggregate({ where: { role: { not: 'admin' } }, _sum: { timeSpent: true, documentsViewed: true, numberOfSignIns: true } }),
      prisma.user.findFirst({ where: { role: { not: 'admin' } }, orderBy: { timeSpent: 'desc' }, select: { fullname: true, timeSpent: true } }),
      prisma.user.count({ where: { role: { not: 'admin' }, createdAt: { gte: oneWeekAgo } } })
    ]);

    const inactiveUsers = totalUsers - activeUsersCount;
    const overallMetrics = {
      totalUsers,
      activeUsers: activeUsersCount,
      inactiveUsers,
      neverLoggedInUsers: neverLoggedInUsersCount,
      averageTimeSpent: totalUsers > 0 ? Math.round((aggregates._sum.timeSpent || 0) / totalUsers) : 0,
      totalDocumentViews: aggregates._sum.documentsViewed || 0,
      averageSignIns: totalUsers > 0 ? Math.round((aggregates._sum.numberOfSignIns || 0) / totalUsers) : 0,
      newUsersThisWeek,
      mostActiveUser: mostActiveUser ? { name: mostActiveUser.fullname, timeSpent: mostActiveUser.timeSpent } : { name: 'N/A', timeSpent: 0 }
    };
    overallMetricsCache = { data: overallMetrics, fetchedAt: Date.now() };
    res.json({ overallMetrics, cached: false });
  } catch (error: any) {
    console.error('Error fetching overall metrics:', error);
    res.status(500).json({ error: 'Failed to fetch overall metrics' });
  }
});

// Get all comments grouped by document (admin only)
// @ts-ignore
router.get("/admin/comments", async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: "Authentication required" });
    }

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, JWT_SECRET as string) as any;
    const userId = decoded.userId;

    // Verify user is admin
    const user = await prisma.user.findUnique({
      where: { id: userId }
    });

    if (!user || user.role !== 'admin') {
      return res.status(403).json({ error: "Admin access required" });
    }

    // Get all comments with user details
    const comments = await prisma.comment.findMany({
      include: {
        user: {
          select: {
            id: true,
            fullname: true,
            email: true
          }
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    // Group comments by document
    const documentGroups: { [key: string]: any[] } = {};
    
    comments.forEach(comment => {
      if (!documentGroups[comment.documentId]) {
        documentGroups[comment.documentId] = [];
      }
      documentGroups[comment.documentId].push(comment);
    });

    // Convert to array format with proper document names
    const documents = Object.keys(documentGroups).map(documentId => {
      // Extract filename from documentId (which is typically a file path)
      const documentName = documentId.includes('/') 
        ? documentId.split('/').pop() || documentId 
        : documentId;
      
      return {
        documentId,
        documentName: documentName,
        comments: documentGroups[documentId].map(comment => ({
          id: comment.id,
          documentId: comment.documentId,
          content: comment.content,
          createdAt: comment.createdAt,
          updatedAt: comment.updatedAt,
          userId: comment.userId,
          user: comment.user
        }))
      };
    });

    res.json({ documents });
  } catch (error: any) {
    console.error("Error fetching admin comments:", error);
    res.status(500).json({ error: "Failed to fetch comments" });
  }
});

// Get comments for specific document (admin only)
// @ts-ignore
router.get("/admin/comments/:documentId", async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: "Authentication required" });
    }

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, JWT_SECRET as string) as any;
    const userId = decoded.userId;

    // Verify user is admin
    const user = await prisma.user.findUnique({
      where: { id: userId }
    });

    if (!user || user.role !== 'admin') {
      return res.status(403).json({ error: "Admin access required" });
    }

    const { documentId } = req.params;

    const comments = await prisma.comment.findMany({
      where: { documentId },
      include: {
        user: {
          select: {
            id: true,
            fullname: true,
            email: true
          }
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    res.json({ comments });
  } catch (error: any) {
    console.error("Error fetching document comments:", error);
    res.status(500).json({ error: "Failed to fetch document comments" });
  }
});

// Reply to comment as admin
// @ts-ignore
router.post("/admin/comment-reply", async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: "Authentication required" });
    }

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, JWT_SECRET as string) as any;
    const userId = decoded.userId;

    // Verify user is admin
    const user = await prisma.user.findUnique({
      where: { id: userId }
    });

    if (!user || user.role !== 'admin') {
      return res.status(403).json({ error: "Admin access required" });
    }

    const { documentId, comment } = req.body;

    if (!documentId || !comment) {
      return res.status(400).json({ error: "Document ID and comment are required" });
    }

    const newComment = await prisma.comment.create({
      data: {
        content: comment,
        documentId,
        userId
      }
    });

    res.json({ 
      message: "Reply added successfully",
      comment: newComment
    });
  } catch (error: any) {
    console.error("Error adding admin reply:", error);
    res.status(500).json({ error: "Failed to add reply" });
  }
});

// Delete comment (admin only)
// @ts-ignore
router.delete("/admin/comment/:commentId", async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: "Authentication required" });
    }

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, JWT_SECRET as string) as any;
    const userId = decoded.userId;

    // Verify user is admin
    const user = await prisma.user.findUnique({
      where: { id: userId }
    });

    if (!user || user.role !== 'admin') {
      return res.status(403).json({ error: "Admin access required" });
    }

    const { commentId } = req.params;

    await prisma.comment.delete({
      where: { id: commentId }
    });

    res.json({ message: "Comment deleted successfully" });
  } catch (error: any) {
    console.error("Error deleting comment:", error);
    res.status(500).json({ error: "Failed to delete comment" });
  }
});

// --------------------------------------------------
// Admin Users Export (CSV streaming or XLSX buffered)
// GET /user/admin/users-export?activity=all|active|inactive&format=csv|xlsx
// --------------------------------------------------
// @ts-ignore
router.get('/admin/users-export', async (req: Request, res: Response) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, JWT_SECRET as string) as any;
    const userId = decoded.userId;
    const admin = await prisma.user.findUnique({ where: { id: userId } });
    if (!admin || admin.role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' });
    }

    const activity = (req.query.activity as string) || 'all'; // all|active|inactive
    const format = (req.query.format as string) || 'csv'; // csv|xlsx

    // Build where filter (always exclude admins)
    const baseWhere: any = { role: { not: 'admin' } };
    const now = new Date();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    if (activity === 'active') {
      baseWhere.AND = [
        ...(baseWhere.AND || []),
        { numberOfSignIns: { gt: 0 } },
        { lastSignIn: { gte: sevenDaysAgo } }
      ];
    } else if (activity === 'inactive') {
      baseWhere.AND = [
        ...(baseWhere.AND || []),
        { OR: [ { lastSignIn: { lt: sevenDaysAgo } }, { lastSignIn: null }, { numberOfSignIns: 0 } ] }
      ];
    }

    const BATCH_SIZE = 500;

    if (format === 'csv') {
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="users_${activity}_${Date.now()}.csv"`);
      // CSV header
      res.write('Full Name,Email,Role,Time Spent (minutes),Documents Viewed,Total Sign-ins,Last Sign-in,Days Inactive,Account Created,Status\n');
      let cursor: string | undefined = undefined;
      for (;;) {
        const users: any[] = await prisma.user.findMany({
          where: baseWhere,
          select: {
            id: true, fullname: true, email: true, role: true, timeSpent: true, documentsViewed: true,
            numberOfSignIns: true, lastSignIn: true, createdAt: true
          },
          orderBy: { createdAt: 'asc' },
          take: BATCH_SIZE + 1,
          ...(cursor ? { skip: 1, cursor: { id: cursor } } : {})
        });
  const hasMore: boolean = users.length > BATCH_SIZE;
  const batch: any[] = hasMore ? users.slice(0, BATCH_SIZE) : users;
        for (const u of batch) {
          const last = u.lastSignIn ? u.lastSignIn.toISOString() : 'Never';
            const lastDate = u.lastSignIn ? new Date(u.lastSignIn) : null;
            const daysInactive = lastDate ? Math.floor((now.getTime() - lastDate.getTime()) / (1000*60*60*24)) : 999;
          const status = (u.numberOfSignIns || 0) > 0 && daysInactive <= 7 ? 'Active' : 'Inactive';
          const row = [
            escapeCsv(u.fullname),
            escapeCsv(u.email),
            escapeCsv(u.role),
            String(u.timeSpent),
            String(u.documentsViewed),
            String(u.numberOfSignIns),
            last,
            String(daysInactive),
            u.createdAt.toISOString(),
            status
          ].join(',') + '\n';
          res.write(row);
        }
        if (!hasMore) break;
        cursor = batch[batch.length - 1].id;
      }
      return res.end();
    } else if (format === 'xlsx') {
      // Lazy import xlsx only if needed
      const xlsx = await import('xlsx');
      const rows: any[] = [];
      let cursor: string | undefined = undefined;
      for (;;) {
        const users: any[] = await prisma.user.findMany({
          where: baseWhere,
          select: {
            id: true, fullname: true, email: true, role: true, timeSpent: true, documentsViewed: true,
            numberOfSignIns: true, lastSignIn: true, createdAt: true
          },
          orderBy: { createdAt: 'asc' },
          take: BATCH_SIZE + 1,
          ...(cursor ? { skip: 1, cursor: { id: cursor } } : {})
        });
  const hasMore: boolean = users.length > BATCH_SIZE;
  const batch: any[] = hasMore ? users.slice(0, BATCH_SIZE) : users;
        for (const u of batch) {
          const lastDate = u.lastSignIn ? new Date(u.lastSignIn) : null;
          const daysInactive = lastDate ? Math.floor((now.getTime() - lastDate.getTime()) / (1000*60*60*24)) : 999;
          rows.push({
            'Full Name': u.fullname,
            'Email': u.email,
            'Role': u.role,
            'Time Spent (minutes)': u.timeSpent,
            'Documents Viewed': u.documentsViewed,
            'Total Sign-ins': u.numberOfSignIns,
            'Last Sign-in': u.lastSignIn ? u.lastSignIn.toISOString() : 'Never',
            'Days Inactive': daysInactive,
            'Account Created': u.createdAt.toISOString(),
            'Status': (u.numberOfSignIns || 0) > 0 && daysInactive <= 7 ? 'Active' : 'Inactive'
          });
        }
        if (!hasMore) break;
        cursor = batch[batch.length - 1].id;
      }
      const wb = xlsx.utils.book_new();
      const ws = xlsx.utils.json_to_sheet(rows);
      xlsx.utils.book_append_sheet(wb, ws, 'Users');
      const buf = xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="users_${activity}_${Date.now()}.xlsx"`);
      return res.end(buf);
    } else {
      return res.status(400).json({ error: 'Unsupported format' });
    }
  } catch (err: any) {
    console.error('Export error:', err);
    return res.status(500).json({ error: 'Failed to export users' });
  }
});

// Helper to escape CSV values (basic)
function escapeCsv(val: any): string {
  if (val === null || val === undefined) return '';
  const s = String(val);
  if (/[",\n]/.test(s)) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

// (Legacy inline bookmark endpoints removed; handled earlier in file / dedicated router)

export default router;