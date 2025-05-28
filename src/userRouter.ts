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
router.post("/comment", async (req: Request, res: Response) => {
  try{
    const { token, comment } = req.body;

    if (!token || !comment) {
      return res.status(400).json({ error: "Token and comment are required" });
    }

    // @ts-ignore
    const decoded = jwt.verify(token, JWT_SECRET);

    if (!decoded || typeof decoded === 'string') {
      return res.status(401).json({ error: "Invalid token" });
    }
    
    // @ts-ignore
    const userId = decoded.userId;

    // Save comment to database
    const newComment = await prisma.comment.create({
      data: {
        userId: userId,
        content: comment,
      },
    });

    res.json({ 
      message: "Comment added successfully", 
      comment: newComment 
    });
  }catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to sign in" });
  }
});

export default router;