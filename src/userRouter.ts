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

    res.json({ 
      message: "Sign in successful", 
      token,
      user: {
        id: user.id,
        email: user.email,
        fullname: user.fullname,
        role: user.role,
        createdAt: user.createdAt,
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
router.get("/comments", async (req: Request, res: Response) => {
  try{
    const { documentId } = req.body;

    if (!documentId ) {
      return res.status(400).json({ error: "Document ID is required" });
    }

    const comments = await prisma.comment.findMany({
      where: { documentId: String(documentId) }
    });

    res.json({ 
      message: "Comment fetched successfully", 
      comments: comments
    });

  }catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch comment" });
  }
});

export default router;