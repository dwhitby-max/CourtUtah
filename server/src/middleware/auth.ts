import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { config } from "../config/env";

const JWT_ISSUER = "courttracker";
const JWT_AUDIENCE = "courttracker-app";

export interface AuthPayload {
  userId: number;
  email: string;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthPayload;
    }
  }
}

export function authenticateToken(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  const token = authHeader && authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;

  if (!token) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  if (!config.jwtSecret) {
    console.error("❌ JWT_SECRET not configured");
    res.status(500).json({ error: "Server configuration error" });
    return;
  }

  try {
    const payload = jwt.verify(token, config.jwtSecret, {
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
    }) as AuthPayload;
    req.user = payload;
    next();
  } catch (err) {
    res.status(401).json({ error: "Invalid or expired token" });
    return;
  }
}

/** Verify a JWT and return the payload. Throws on invalid/expired tokens. */
export function verifyToken(token: string): AuthPayload {
  if (!config.jwtSecret) {
    throw new Error("JWT_SECRET not configured");
  }
  return jwt.verify(token, config.jwtSecret, {
    issuer: JWT_ISSUER,
    audience: JWT_AUDIENCE,
  }) as AuthPayload;
}

export function generateToken(payload: AuthPayload): string {
  if (!config.jwtSecret) {
    throw new Error("JWT_SECRET not configured");
  }
  return jwt.sign(payload, config.jwtSecret, {
    expiresIn: "24h",
    issuer: JWT_ISSUER,
    audience: JWT_AUDIENCE,
  });
}
