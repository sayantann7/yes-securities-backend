import { Router, Request, Response } from "express";
import { prisma } from "./prisma";
import jwt from "jsonwebtoken";

const router = Router();

const JWT_SECRET = process.env.JWT_SECRET;

// @ts-ignore
router.post("/signin", async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: "Email and password are required" });
    }

    const user = await prisma.user.findUnique({
      where: { email: String(email) },
    });

    if (!user || user.password !== String(password)) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    // Generate JWT token
    const token = jwt.sign(
      { 
        userId: user.id,
        email: user.email
      },
      //@ts-ignore
      JWT_SECRET,
      { expiresIn: '24h' }
    );

    const updatedUser = await prisma.user.update({
      where: { id: user.id },
      data: {
        lastSignIn: new Date(),
        numberOfSignIns: user.numberOfSignIns + 1,
      },
    });

    res.json({ 
      message: "Sign in successful", 
      token,
      user: {
        id: updatedUser.id,
        email: updatedUser.email,
        fullname: updatedUser.fullname,
        role: updatedUser.role,
        createdAt: updatedUser.createdAt,
        lastSignIn: updatedUser.lastSignIn,
        numberOfSignIns: updatedUser.numberOfSignIns,
        timeSpent : updatedUser.timeSpent,
        documentsViewed: updatedUser.documentsViewed,
        recentDocs: updatedUser.recentDocs
      }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to sign in" });
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
    const { email, currentPassword, newPassword } = req.body;

    if (!email || !currentPassword || !newPassword) {
      return res.status(400).json({ error: "Email, current password, and new password are required" });
    }

    const user = await prisma.user.findUnique({
      where: { email: String(email) },
    });

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    // Check if current password is correct
    if (user.password !== String(currentPassword)) {
      return res.status(401).json({ error: "Current password is incorrect" });
    }

    // Update password (store directly without hashing since we're not using bcrypt)
    await prisma.user.update({
      where: { id: user.id },
      data: {
        password: String(newPassword),
        updatedAt: new Date(),
      },
    });

    res.json({ 
      message: "Password updated successfully"
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to update password" });
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
    const user = await prisma.user.findUnique({
      where: { id: userId }
    });

    if (!user || user.role !== 'admin') {
      return res.status(403).json({ error: "Admin access required" });
    }

    // Get all users with their metrics
    const allUsers = await prisma.user.findMany({
      where: {
        role: { not: 'admin' }
      },
      select: {
        id: true,
        fullname: true,
        email: true,
        role: true,
        createdAt: true,
        lastSignIn: true,
        numberOfSignIns: true,
        documentsViewed: true,
        timeSpent: true,
        recentDocs: true
      },
      orderBy: { createdAt: 'desc' }
    });

    // Calculate days inactive for each user
    const usersWithMetrics = allUsers.map(user => {
      const lastSignIn = user.lastSignIn ? new Date(user.lastSignIn) : null;
      const daysInactive = lastSignIn 
        ? Math.floor((new Date().getTime() - lastSignIn.getTime()) / (1000 * 60 * 60 * 24))
        : 999; // Very high number for users who never signed in

      return {
        ...user,
        daysInactive,
        lastSignIn: user.lastSignIn?.toISOString() || 'Never'
      };
    });

    // Calculate overall metrics
    const totalUsers = allUsers.length;
    const activeUsers = usersWithMetrics.filter(u => u.daysInactive <= 7).length;
    const inactiveUsers = totalUsers - activeUsers;
    const totalTimeSpent = allUsers.reduce((sum, user) => sum + user.timeSpent, 0);
    const totalDocumentViews = allUsers.reduce((sum, user) => sum + user.documentsViewed, 0);
    const totalSignIns = allUsers.reduce((sum, user) => sum + user.numberOfSignIns, 0);
    
    // New users this week
    const oneWeekAgo = new Date();
    oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
    const newUsersThisWeek = allUsers.filter(user => new Date(user.createdAt) >= oneWeekAgo).length;
    
    // Most active user
    const mostActiveUser = allUsers.reduce((prev, current) => 
      current.timeSpent > prev.timeSpent ? current : prev,
      allUsers[0] || { fullname: 'N/A', timeSpent: 0 }
    );

    const overallMetrics = {
      totalUsers,
      activeUsers,
      inactiveUsers,
      averageTimeSpent: totalUsers > 0 ? Math.round(totalTimeSpent / totalUsers) : 0,
      totalDocumentViews,
      averageSignIns: totalUsers > 0 ? Math.round(totalSignIns / totalUsers) : 0,
      newUsersThisWeek,
      mostActiveUser: {
        name: mostActiveUser.fullname,
        timeSpent: mostActiveUser.timeSpent
      }
    };

    res.json({ 
      users: usersWithMetrics,
      overallMetrics
    });
  } catch (error: any) {
    console.error("Error fetching user metrics:", error);
    res.status(500).json({ error: "Failed to fetch user metrics" });
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

// Bookmark endpoints
// @ts-ignore
router.post("/bookmarks", async (req: Request, res: Response) => {
  try {
    // console.log('POST /bookmarks called');
    // console.log('Request body:', req.body);
    // console.log('Authorization header:', req.headers.authorization);
    
    const { itemId, itemType, itemName } = req.body;
    
    // Manual token verification since we don't have middleware
    const authHeader = req.headers.authorization;
    let userId = null;
    
    if (!authHeader) {
      console.error('No authorization header provided');
      return res.status(401).json({ error: "Authentication required" });
    }
    
    const token = authHeader.split(" ")[1];
    if (!token) {
      console.error('No token found in authorization header');
      return res.status(401).json({ error: "Token not provided" });
    }
    
    try {
      const decoded = jwt.verify(token, JWT_SECRET as string) as any;
      userId = decoded.userId;
      console.log('Token decoded successfully, userId:', userId);
    } catch (tokenError) {
      console.error('Token verification failed:', tokenError);
      return res.status(401).json({ error: "Invalid token" });
    }

    if (!itemId || !itemType || !itemName) {
      console.error('Missing required fields:', { itemId, itemType, itemName });
      return res.status(400).json({ error: "itemId, itemType, and itemName are required" });
    }

    if (!['document', 'folder'].includes(itemType)) {
      console.error('Invalid itemType:', itemType);
      return res.status(400).json({ error: "itemType must be 'document' or 'folder'" });
    }

    console.log('Checking if bookmark already exists for:', { userId, itemId });
    // Check if bookmark already exists
    const existingBookmark = await prisma.bookmark.findUnique({
      where: {
        userId_itemId: {
          userId,
          itemId
        }
      }
    });

    if (existingBookmark) {
      console.log('Bookmark already exists');
      return res.status(409).json({ error: "Item already bookmarked" });
    }

    console.log('Creating new bookmark...');
    const bookmark = await prisma.bookmark.create({
      data: {
        userId,
        itemId,
        itemType,
        itemName
      }
    });

    console.log('Bookmark created successfully:', bookmark);
    res.json({ message: "Bookmark created successfully", bookmark });
  } catch (error: any) {
    console.error("Error creating bookmark:", error);
    res.status(500).json({ error: "Failed to create bookmark" });
  }
});

// @ts-ignore
router.delete("/bookmarks/:itemId", async (req: Request, res: Response) => {
  try {
    // console.log('DELETE /bookmarks/:itemId called');
    const { itemId } = req.params;
    // console.log('ItemId to delete:', itemId);
    // console.log('Authorization header:', req.headers.authorization);
    
    // Manual token verification since we don't have middleware
    const authHeader = req.headers.authorization;
    let userId = null;
    
    if (!authHeader) {
      console.error('No authorization header provided');
      return res.status(401).json({ error: "Authentication required" });
    }
    
    const token = authHeader.split(" ")[1];
    if (!token) {
      console.error('No token found in authorization header');
      return res.status(401).json({ error: "Token not provided" });
    }
    
    try {
      const decoded = jwt.verify(token, JWT_SECRET as string) as any;
      userId = decoded.userId;
      console.log('Token decoded successfully, userId:', userId);
    } catch (tokenError) {
      console.error('Token verification failed:', tokenError);
      return res.status(401).json({ error: "Invalid token" });
    }

    console.log('Deleting bookmark for:', { userId, itemId });
    const deletedBookmark = await prisma.bookmark.delete({
      where: {
        userId_itemId: {
          userId,
          itemId
        }
      }
    });

    console.log('Bookmark deleted successfully');
    res.json({ message: "Bookmark removed successfully" });
  } catch (error: any) {
    console.error("Error removing bookmark:", error);
    if (error.code === 'P2025') {
      return res.status(404).json({ error: "Bookmark not found" });
    }
    res.status(500).json({ error: "Failed to remove bookmark" });
  }
});

// @ts-ignore
router.get("/bookmarks", async (req: Request, res: Response) => {
  try {
    // console.log('GET /bookmarks called');
    // console.log('Authorization header:', req.headers.authorization);
    
    // Manual token verification since we don't have middleware
    const authHeader = req.headers.authorization;
    let userId = null;
    
    if (!authHeader) {
      console.error('No authorization header provided');
      return res.status(401).json({ error: "Authentication required" });
    }
    
    const token = authHeader.split(" ")[1];
    if (!token) {
      console.error('No token found in authorization header');
      return res.status(401).json({ error: "Token not provided" });
    }
    
    try {
      const decoded = jwt.verify(token, JWT_SECRET as string) as any;
      userId = decoded.userId;
      console.log('Token decoded successfully, userId:', userId);
    } catch (tokenError) {
      console.error('Token verification failed:', tokenError);
      return res.status(401).json({ error: "Invalid token" });
    }

    console.log('Fetching bookmarks for userId:', userId);
    const bookmarks = await prisma.bookmark.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' }
    });

    console.log('Bookmarks found:', bookmarks.length);
    console.log('Bookmarks data:', bookmarks);
    res.json({ bookmarks });
  } catch (error: any) {
    console.error("Error fetching bookmarks:", error);
    res.status(500).json({ error: "Failed to fetch bookmarks" });
  }
});

export default router;