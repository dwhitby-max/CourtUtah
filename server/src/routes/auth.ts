import { Router, Request, Response } from "express";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { getPool } from "../db/pool";
import { generateToken } from "../middleware/auth";
import { authLimiter } from "../middleware/rateLimiter";
import { sendPasswordResetEmail, sendVerificationEmail } from "../services/emailService";

const router = Router();

router.use(authLimiter);

// POST /api/auth/register
router.post("/register", async (req: Request, res: Response) => {
  const pool = getPool();
  if (!pool) { res.status(503).json({ error: "Database unavailable" }); return; }

  const { email, password, phone } = req.body;

  if (!email || !password) {
    res.status(400).json({ error: "Email and password are required" });
    return;
  }

  if (password.length < 8) {
    res.status(400).json({ error: "Password must be at least 8 characters" });
    return;
  }

  const client = await pool.connect();
  try {
    const existing = await client.query("SELECT id FROM users WHERE email = $1", [email.toLowerCase()]);
    if (existing.rows.length > 0) {
      res.status(409).json({ error: "Email already registered" });
      return;
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const verificationToken = crypto.randomBytes(32).toString("hex");

    const result = await client.query(
      `INSERT INTO users (email, password_hash, phone, email_verification_token)
       VALUES ($1, $2, $3, $4)
       RETURNING id, email, phone, email_verified, notification_preferences, created_at`,
      [email.toLowerCase(), passwordHash, phone || null, verificationToken]
    );

    const user = result.rows[0];
    const token = generateToken({ userId: user.id, email: user.email });

    const baseUrl = `${req.protocol}://${req.get("host")}`;
    sendVerificationEmail(user.email, verificationToken, baseUrl).catch((err) => {
      console.error("⚠️  Verification email send failed:", err);
    });

    res.status(201).json({
      token,
      user: {
        id: user.id,
        email: user.email,
        phone: user.phone,
        emailVerified: user.email_verified,
        notificationPreferences: user.notification_preferences,
        createdAt: user.created_at,
      },
    });
  } catch (err) {
    console.error("❌ POST /api/auth/register failed:", err);
    res.status(500).json({ error: "Registration failed" });
  } finally {
    client.release();
  }
});

// GET /api/auth/verify-email
router.get("/verify-email", async (req: Request, res: Response) => {
  const { token } = req.query;

  if (!token || typeof token !== "string") {
    res.status(400).json({ error: "Missing or invalid verification token" });
    return;
  }

  const pool = getPool();
  if (!pool) { res.status(503).json({ error: "Database unavailable" }); return; }

  const client = await pool.connect();
  try {
    const result = await client.query(
      `UPDATE users
       SET email_verified = true, email_verification_token = NULL, updated_at = NOW()
       WHERE email_verification_token = $1 AND email_verified = false
       RETURNING id, email`,
      [token]
    );

    if (result.rows.length === 0) {
      res.redirect("/login?verified=invalid");
      return;
    }

    console.log(`✅ Email verified for user ${result.rows[0].email}`);
    res.redirect("/login?verified=success");
  } catch (err) {
    console.error("❌ GET /api/auth/verify-email failed:", err);
    res.redirect("/login?verified=expired");
  } finally {
    client.release();
  }
});

// POST /api/auth/resend-verification
router.post("/resend-verification", async (req: Request, res: Response) => {
  const { email } = req.body;
  if (!email) { res.status(400).json({ error: "Email is required" }); return; }

  const pool = getPool();
  if (!pool) { res.status(503).json({ error: "Database unavailable" }); return; }

  const client = await pool.connect();
  try {
    const newToken = crypto.randomBytes(32).toString("hex");
    const result = await client.query(
      `UPDATE users
       SET email_verification_token = $1, updated_at = NOW()
       WHERE email = $2 AND email_verified = false
       RETURNING id`,
      [newToken, email.toLowerCase()]
    );

    if (result.rows.length > 0) {
      const baseUrl = `${req.protocol}://${req.get("host")}`;
      sendVerificationEmail(email.toLowerCase(), newToken, baseUrl).catch((err) => {
        console.error("⚠️  Resend verification email failed:", err);
      });
    }

    res.json({ message: "If the email exists and is unverified, a verification link has been sent." });
  } catch (err) {
    console.error("❌ POST /api/auth/resend-verification failed:", err);
    res.status(500).json({ error: "Failed to resend verification" });
  } finally {
    client.release();
  }
});

// POST /api/auth/login
router.post("/login", async (req: Request, res: Response) => {
  const pool = getPool();
  if (!pool) { res.status(503).json({ error: "Database unavailable" }); return; }

  const { email, password } = req.body;

  if (!email || !password) {
    res.status(400).json({ error: "Email and password are required" });
    return;
  }

  const client = await pool.connect();
  try {
    const result = await client.query(
      `SELECT id, email, phone, password_hash, email_verified, notification_preferences, created_at
       FROM users WHERE email = $1`,
      [email.toLowerCase()]
    );

    if (result.rows.length === 0) {
      res.status(401).json({ error: "Invalid email or password" });
      return;
    }

    const user = result.rows[0];
    const valid = await bcrypt.compare(password, user.password_hash);

    if (!valid) {
      res.status(401).json({ error: "Invalid email or password" });
      return;
    }

    const token = generateToken({ userId: user.id, email: user.email });

    res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        phone: user.phone,
        emailVerified: user.email_verified,
        notificationPreferences: user.notification_preferences,
        createdAt: user.created_at,
      },
    });
  } catch (err) {
    console.error("❌ POST /api/auth/login failed:", err);
    res.status(500).json({ error: "Login failed" });
  } finally {
    client.release();
  }
});

// POST /api/auth/forgot-password
router.post("/forgot-password", async (req: Request, res: Response) => {
  const pool = getPool();
  if (!pool) { res.status(503).json({ error: "Database unavailable" }); return; }

  const { email } = req.body;
  if (!email) { res.status(400).json({ error: "Email is required" }); return; }

  const client = await pool.connect();
  try {
    const result = await client.query("SELECT id FROM users WHERE email = $1", [email.toLowerCase()]);

    if (result.rows.length === 0) {
      res.json({ message: "If an account exists with that email, a reset link has been sent" });
      return;
    }

    const resetToken = crypto.randomBytes(32).toString("hex");
    const resetExpires = new Date(Date.now() + 3600000);

    await client.query(
      `UPDATE users SET reset_password_token = $1, reset_password_expires = $2 WHERE email = $3`,
      [resetToken, resetExpires, email.toLowerCase()]
    );

    const baseUrl = `${req.protocol}://${req.get("host")}`;
    await sendPasswordResetEmail(email.toLowerCase(), resetToken, baseUrl);

    res.json({ message: "If an account exists with that email, a reset link has been sent" });
  } catch (err) {
    console.error("❌ POST /api/auth/forgot-password failed:", err);
    res.status(500).json({ error: "Failed to process password reset" });
  } finally {
    client.release();
  }
});

// POST /api/auth/reset-password
router.post("/reset-password", async (req: Request, res: Response) => {
  const pool = getPool();
  if (!pool) { res.status(503).json({ error: "Database unavailable" }); return; }

  const { token, password } = req.body;

  if (!token || !password) {
    res.status(400).json({ error: "Token and new password are required" });
    return;
  }

  if (password.length < 8) {
    res.status(400).json({ error: "Password must be at least 8 characters" });
    return;
  }

  const client = await pool.connect();
  try {
    const result = await client.query(
      `SELECT id FROM users WHERE reset_password_token = $1 AND reset_password_expires > NOW()`,
      [token]
    );

    if (result.rows.length === 0) {
      res.status(400).json({ error: "Invalid or expired reset token" });
      return;
    }

    const passwordHash = await bcrypt.hash(password, 12);
    await client.query(
      `UPDATE users SET password_hash = $1, reset_password_token = NULL, reset_password_expires = NULL, updated_at = NOW()
       WHERE id = $2`,
      [passwordHash, result.rows[0].id]
    );

    res.json({ message: "Password has been reset successfully" });
  } catch (err) {
    console.error("❌ POST /api/auth/reset-password failed:", err);
    res.status(500).json({ error: "Failed to reset password" });
  } finally {
    client.release();
  }
});

// PATCH /api/auth/profile
router.patch("/profile", async (req: Request, res: Response) => {
  const authHeader = req.headers.authorization;
  const token = authHeader && authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;

  if (!token) { res.status(401).json({ error: "Authentication required" }); return; }

  let userId: number;
  try {
    const jwt = require("jsonwebtoken");
    const { config } = require("../config/env");
    const payload = jwt.verify(token, config.jwtSecret) as { userId: number };
    userId = payload.userId;
  } catch {
    res.status(401).json({ error: "Invalid token" }); return;
  }

  const pool = getPool();
  if (!pool) { res.status(503).json({ error: "Database unavailable" }); return; }

  const { phone, notificationPreferences } = req.body;

  const client = await pool.connect();
  try {
    await client.query(
      `UPDATE users SET phone = $1, notification_preferences = $2, updated_at = NOW() WHERE id = $3`,
      [phone || null, JSON.stringify(notificationPreferences || {}), userId]
    );

    const result = await client.query(
      `SELECT id, email, phone, email_verified, notification_preferences, created_at FROM users WHERE id = $1`,
      [userId]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    const user = result.rows[0];
    res.json({
      user: {
        id: user.id,
        email: user.email,
        phone: user.phone,
        emailVerified: user.email_verified,
        notificationPreferences: user.notification_preferences,
        createdAt: user.created_at,
      },
    });
  } catch (err) {
    console.error("❌ PATCH /api/auth/profile failed:", err);
    res.status(500).json({ error: "Failed to update profile" });
  } finally {
    client.release();
  }
});

export default router;
