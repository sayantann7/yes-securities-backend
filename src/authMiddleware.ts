import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";

const JWT_SECRET = process.env.JWT_SECRET;

// Extend the Express Request type to include user information
declare global {
  namespace Express {
    interface Request {
      user?: {
        userId: string;
        email: string;
        [key: string]: any; // For any additional claims
      };
    }
  }
}

/**
 * Authentication middleware to protect routes
 * Verifies the JWT token from the Authorization header
 */
export const authenticate = (req: Request, res: Response, next: NextFunction) => {
  try {
    // Get token from Authorization header
    const authHeader = req.headers.authorization;
    
    if (!authHeader) {
      return res.status(401).json({ error: "Authentication required" });
    }
    
    // Format should be "Bearer [token]"
    const token = authHeader.split(" ")[1];
    
    if (!token) {
      return res.status(401).json({ error: "Token not provided" });
    }
    
    // Verify token
    const decoded = jwt.verify(token, JWT_SECRET as string);
    
    // Add user data to request
    req.user = decoded as { userId: string; email: string };
    
    // Continue to the protected route
    next();
  } catch (error) {
    if (error instanceof jwt.JsonWebTokenError) {
      return res.status(401).json({ error: "Invalid token" });
    } else if (error instanceof jwt.TokenExpiredError) {
      return res.status(401).json({ error: "Token expired" });
    }
    
    console.error("Authentication error:", error);
    return res.status(500).json({ error: "Authentication failed" });
  }
};

/**
 * Role-based authorization middleware
 * Use after authenticate middleware
 */
export const authorize = (roles: string[]) => {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ error: "Authentication required" });
    }
    
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: "Insufficient permissions" });
    }
    
    next();
  };
};