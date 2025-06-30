import { Router, Request, Response } from "express";
import { PrismaClient } from "../src/generated/prisma"
import jwt from "jsonwebtoken";

const router = Router();

const prisma = new PrismaClient();

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
router.get("/getTotalSignIns", async (req: Request, res: Response) => {
  try {

    const signIns = await prisma.user.aggregate({
      _sum: {
        numberOfSignIns: true,
      },
    });

    res.json({ 
      message: "Total sign-ins fetched successfully", 
      totalSignIns: signIns._sum.numberOfSignIns
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch total sign-ins" });
  }
});

// @ts-ignore
router.get("/getTotalDocumentsViewed", async (req: Request, res: Response) => {
  try {

    const documentsViewed = await prisma.user.aggregate({
      _sum: {
        documentsViewed: true,
      },
    });

    res.json({ 
      message: "Total documents viewed fetched successfully", 
      totalDocumentsViewed: documentsViewed._sum.documentsViewed
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch total documents viewed" });
  }
});

// @ts-ignore
router.get("/getTotalTimeSpent", async (req: Request, res: Response) => {
  try {

    const timeSpent = await prisma.user.aggregate({
      _sum: {
        timeSpent: true,
      },
    });

    res.json({ 
      message: "Total time spent fetched successfully", 
      totalTimeSpent: timeSpent._sum.timeSpent
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch total time spent" });
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

    // Save comment to database
    const newComment = await prisma.comment.create({
      //@ts-ignore
      data: {
        userId: user?.id,
        documentId: String(documentId),
        content: comment,
      },
    });

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
// …existing imports…
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

export default router;