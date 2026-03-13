import nodemailer from "nodemailer";
import { config } from "../config/env";

let transporter: nodemailer.Transporter | null = null;

function getTransporter(): nodemailer.Transporter | null {
  if (transporter) return transporter;

  if (!config.smtp.host || !config.smtp.user) {
    console.warn("⚠️  SMTP not configured — email notifications disabled");
    return null;
  }

  transporter = nodemailer.createTransport({
    host: config.smtp.host,
    port: config.smtp.port,
    secure: config.smtp.port === 465,
    auth: {
      user: config.smtp.user,
      pass: config.smtp.pass,
    },
  });

  return transporter;
}

export async function sendEmail(to: string, subject: string, html: string): Promise<boolean> {
  const t = getTransporter();
  if (!t) {
    console.warn("⚠️  Email skipped (SMTP not configured):", subject);
    return false;
  }

  try {
    await t.sendMail({
      from: config.smtp.fromEmail,
      to,
      subject,
      html,
    });
    console.log(`✅ Email sent to ${to}: ${subject}`);
    return true;
  } catch (err) {
    console.error("❌ Email send failed:", err);
    return false;
  }
}

export async function sendPasswordResetEmail(to: string, resetToken: string, baseUrl: string): Promise<boolean> {
  const resetLink = `${baseUrl}/reset-password?token=${resetToken}`;
  const html = `
    <h2>Password Reset Request</h2>
    <p>You requested a password reset for your Court Calendar Tracker account.</p>
    <p><a href="${resetLink}">Click here to reset your password</a></p>
    <p>This link expires in 1 hour.</p>
    <p>If you didn't request this, you can safely ignore this email.</p>
  `;
  return sendEmail(to, "Password Reset - Court Calendar Tracker", html);
}

export async function sendVerificationEmail(to: string, verificationToken: string, baseUrl: string): Promise<boolean> {
  const verifyLink = `${baseUrl}/api/auth/verify-email?token=${verificationToken}`;
  const html = `
    <h2>Verify Your Email</h2>
    <p>Welcome to Court Calendar Tracker! Please verify your email address.</p>
    <p><a href="${verifyLink}" style="display:inline-block;padding:12px 24px;background:#4f46e5;color:#fff;text-decoration:none;border-radius:6px;">Verify Email</a></p>
    <p>Or copy this link: ${verifyLink}</p>
    <p>If you didn't create this account, you can safely ignore this email.</p>
  `;
  return sendEmail(to, "Verify Your Email - Court Calendar Tracker", html);
}

export async function sendScheduleChangeEmail(
  to: string,
  caseName: string,
  changes: Array<{ field: string; oldValue: string; newValue: string }>
): Promise<boolean> {
  const changeRows = changes
    .map((c) => `<tr><td>${c.field}</td><td>${c.oldValue}</td><td>${c.newValue}</td></tr>`)
    .join("");

  const html = `
    <h2>Court Schedule Change Detected</h2>
    <p>A schedule change was detected for: <strong>${caseName}</strong></p>
    <table border="1" cellpadding="8" cellspacing="0">
      <tr><th>Field</th><th>Previous</th><th>Updated</th></tr>
      ${changeRows}
    </table>
    <p>Your calendar has been automatically updated.</p>
  `;
  return sendEmail(to, `Schedule Change: ${caseName}`, html);
}
