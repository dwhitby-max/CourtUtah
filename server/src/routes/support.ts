import { Router, Request, Response } from "express";
import { authenticateToken } from "../middleware/auth";
import { heavyLimiter } from "../middleware/rateLimiter";
import { sendEmail } from "../services/emailService";

const router = Router();

const SUPPORT_EMAIL = "ops@1564hub.com";

// POST /api/support — Send a support request email
router.post("/", authenticateToken, heavyLimiter, async (req: Request, res: Response) => {
  if (!req.user) { res.status(401).json({ error: "Not authenticated" }); return; }

  const { subject, message } = req.body;

  if (!subject || typeof subject !== "string" || !subject.trim()) {
    res.status(400).json({ error: "Subject is required" });
    return;
  }

  if (!message || typeof message !== "string" || !message.trim()) {
    res.status(400).json({ error: "Message is required" });
    return;
  }

  const fullSubject = `CourtUtah - ${subject.trim()}`;

  const html = `
    <div style="font-family: sans-serif; max-width: 600px;">
      <h2 style="color: #1e293b;">Support Request</h2>
      <table style="border-collapse: collapse; width: 100%; margin-bottom: 16px;">
        <tr>
          <td style="padding: 8px 12px; border: 1px solid #e2e8f0; background: #f8fafc; font-weight: 600; width: 100px;">From</td>
          <td style="padding: 8px 12px; border: 1px solid #e2e8f0;">${req.user.email}</td>
        </tr>
        <tr>
          <td style="padding: 8px 12px; border: 1px solid #e2e8f0; background: #f8fafc; font-weight: 600;">User ID</td>
          <td style="padding: 8px 12px; border: 1px solid #e2e8f0;">${req.user.userId}</td>
        </tr>
        <tr>
          <td style="padding: 8px 12px; border: 1px solid #e2e8f0; background: #f8fafc; font-weight: 600;">Subject</td>
          <td style="padding: 8px 12px; border: 1px solid #e2e8f0;">${subject.trim()}</td>
        </tr>
      </table>
      <div style="padding: 16px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; white-space: pre-wrap;">${message.trim()}</div>
      <p style="margin-top: 16px; font-size: 12px; color: #94a3b8;">Reply directly to this email to respond to the user.</p>
    </div>
  `;

  const sent = await sendEmail(SUPPORT_EMAIL, fullSubject, html);

  if (sent) {
    console.log(`📧 Support email sent from user ${req.user.userId} (${req.user.email}): ${fullSubject}`);
    res.json({ message: "Support request sent successfully" });
  } else {
    console.error(`❌ Failed to send support email from user ${req.user.userId}`);
    res.status(500).json({ error: "Failed to send message. Please try again or email ops@1564hub.com directly." });
  }
});

export default router;
