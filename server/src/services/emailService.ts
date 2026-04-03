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

export async function sendNewSignupNotification(
  adminEmail: string,
  newUserEmail: string,
  signupIp: string | null
): Promise<boolean> {
  const html = `
    <h2>New User Signup — Auto-Approved</h2>
    <p>A new user has signed up for Court Calendar Tracker and was automatically approved.</p>
    <table border="0" cellpadding="8" cellspacing="0" style="border-collapse:collapse;">
      <tr><td><strong>Email:</strong></td><td>${newUserEmail}</td></tr>
      <tr><td><strong>Signup IP:</strong></td><td>${signupIp || "Unknown"}</td></tr>
      <tr><td><strong>Time:</strong></td><td>${new Date().toLocaleString("en-US", { timeZone: "America/Denver" })} MT</td></tr>
    </table>
    <p style="margin-top:16px;">
      You can manage users in the <strong>Admin Panel → Users</strong> tab.
    </p>
  `;
  return sendEmail(adminEmail, `New Signup (Auto-Approved): ${newUserEmail}`, html);
}

export async function sendAccountApprovedEmail(userEmail: string, appUrl: string): Promise<boolean> {
  const html = `
    <h2>Your Account Has Been Approved</h2>
    <p>Great news! Your Court Calendar Tracker account has been approved by an administrator.</p>
    <p>You can now sign in and start using the app:</p>
    <p><a href="${appUrl}/login" style="display:inline-block;padding:12px 24px;background:#92400e;color:#fff;text-decoration:none;border-radius:6px;">Sign In</a></p>
  `;
  return sendEmail(userEmail, "Account Approved - Court Calendar Tracker", html);
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

export async function sendNewMatchEmail(
  to: string,
  caseName: string,
  events: Array<{ date: string; time: string; court: string; hearingType: string }>
): Promise<boolean> {
  const eventRows = events
    .map((e) => `<tr><td>${e.date}</td><td>${e.time || "TBD"}</td><td>${e.court}</td><td>${e.hearingType || "N/A"}</td></tr>`)
    .join("");

  const html = `
    <h2>New Court Hearing${events.length > 1 ? "s" : ""} Found</h2>
    <p>New hearing${events.length > 1 ? "s" : ""} matching your search <strong>"${caseName}"</strong> ${events.length > 1 ? "have" : "has"} been found and added to your calendar:</p>
    <table border="1" cellpadding="8" cellspacing="0" style="border-collapse:collapse;">
      <tr><th>Date</th><th>Time</th><th>Court</th><th>Hearing</th></tr>
      ${eventRows}
    </table>
    <p>These events have been automatically added to your calendar.</p>
  `;
  return sendEmail(to, `New Hearing Found: ${caseName}`, html);
}

export async function sendCancellationEmail(
  to: string,
  caseName: string,
  details: { date: string; time: string; court: string; defendant: string }
): Promise<boolean> {
  const html = `
    <h2>Hearing May Be Cancelled</h2>
    <p>A hearing that was on your calendar no longer appears on the Utah court calendar:</p>
    <table border="0" cellpadding="8" cellspacing="0" style="border-collapse:collapse;">
      <tr><td><strong>Case:</strong></td><td>${caseName}</td></tr>
      <tr><td><strong>Defendant:</strong></td><td>${details.defendant}</td></tr>
      <tr><td><strong>Date:</strong></td><td>${details.date}</td></tr>
      <tr><td><strong>Time:</strong></td><td>${details.time || "TBD"}</td></tr>
      <tr><td><strong>Court:</strong></td><td>${details.court}</td></tr>
    </table>
    <p style="color:#b91c1c;"><strong>This hearing may have been cancelled or rescheduled.</strong> Please verify with the court directly.</p>
    <p>Your calendar event has been updated to reflect this change.</p>
  `;
  return sendEmail(to, `Hearing May Be Cancelled: ${caseName}`, html);
}

export interface DailySummaryItem {
  type: "change" | "cancellation" | "new_match";
  caseName: string;
  caseNumber: string;
  defendant: string;
  date: string;
  time: string;
  court: string;
  calendarSynced: boolean;
  changes?: Array<{ field: string; oldValue: string; newValue: string }>;
}

export async function sendDailySummaryEmail(
  to: string,
  items: DailySummaryItem[]
): Promise<boolean> {
  if (items.length === 0) return false;

  const changes = items.filter(i => i.type === "change");
  const cancellations = items.filter(i => i.type === "cancellation");
  const newMatches = items.filter(i => i.type === "new_match");

  let sectionsHtml = "";

  if (changes.length > 0) {
    const rows = changes.map(item => {
      const changeDetail = item.changes
        ? item.changes.map(c => `${c.field}: <span style="color:#b91c1c;text-decoration:line-through;">${c.oldValue}</span> &rarr; <span style="color:#059669;font-weight:bold;">${c.newValue}</span>`).join("<br/>")
        : "";
      return `<tr>
        <td style="padding:8px;border-bottom:1px solid #e5e7eb;">${item.defendant || item.caseNumber}</td>
        <td style="padding:8px;border-bottom:1px solid #e5e7eb;">${item.caseNumber}</td>
        <td style="padding:8px;border-bottom:1px solid #e5e7eb;">${item.date} ${item.time || ""}</td>
        <td style="padding:8px;border-bottom:1px solid #e5e7eb;">${item.court}</td>
        <td style="padding:8px;border-bottom:1px solid #e5e7eb;">${changeDetail}</td>
        <td style="padding:8px;border-bottom:1px solid #e5e7eb;">${item.calendarSynced ? "&#10003; Updated" : "Pending"}</td>
      </tr>`;
    }).join("");

    sectionsHtml += `
      <h3 style="color:#b45309;margin-top:24px;">Schedule Changes (${changes.length})</h3>
      <table style="width:100%;border-collapse:collapse;font-size:14px;">
        <tr style="background:#f9fafb;">
          <th style="padding:8px;text-align:left;border-bottom:2px solid #4f46e5;">Defendant</th>
          <th style="padding:8px;text-align:left;border-bottom:2px solid #4f46e5;">Case #</th>
          <th style="padding:8px;text-align:left;border-bottom:2px solid #4f46e5;">Date/Time</th>
          <th style="padding:8px;text-align:left;border-bottom:2px solid #4f46e5;">Court</th>
          <th style="padding:8px;text-align:left;border-bottom:2px solid #4f46e5;">Changes</th>
          <th style="padding:8px;text-align:left;border-bottom:2px solid #4f46e5;">Calendar</th>
        </tr>
        ${rows}
      </table>`;
  }

  if (cancellations.length > 0) {
    const rows = cancellations.map(item =>
      `<tr>
        <td style="padding:8px;border-bottom:1px solid #e5e7eb;">${item.defendant || item.caseNumber}</td>
        <td style="padding:8px;border-bottom:1px solid #e5e7eb;">${item.caseNumber}</td>
        <td style="padding:8px;border-bottom:1px solid #e5e7eb;">${item.date} ${item.time || ""}</td>
        <td style="padding:8px;border-bottom:1px solid #e5e7eb;">${item.court}</td>
      </tr>`
    ).join("");

    sectionsHtml += `
      <h3 style="color:#b91c1c;margin-top:24px;">Possible Cancellations (${cancellations.length})</h3>
      <p style="color:#666;">These hearings no longer appear on the court calendar. Please verify with the court.</p>
      <table style="width:100%;border-collapse:collapse;font-size:14px;">
        <tr style="background:#fef2f2;">
          <th style="padding:8px;text-align:left;border-bottom:2px solid #b91c1c;">Defendant</th>
          <th style="padding:8px;text-align:left;border-bottom:2px solid #b91c1c;">Case #</th>
          <th style="padding:8px;text-align:left;border-bottom:2px solid #b91c1c;">Date/Time</th>
          <th style="padding:8px;text-align:left;border-bottom:2px solid #b91c1c;">Court</th>
        </tr>
        ${rows}
      </table>`;
  }

  if (newMatches.length > 0) {
    const rows = newMatches.map(item =>
      `<tr>
        <td style="padding:8px;border-bottom:1px solid #e5e7eb;">${item.defendant || item.caseNumber}</td>
        <td style="padding:8px;border-bottom:1px solid #e5e7eb;">${item.caseNumber}</td>
        <td style="padding:8px;border-bottom:1px solid #e5e7eb;">${item.date} ${item.time || ""}</td>
        <td style="padding:8px;border-bottom:1px solid #e5e7eb;">${item.court}</td>
        <td style="padding:8px;border-bottom:1px solid #e5e7eb;">${item.calendarSynced ? "&#10003; Added" : "Pending"}</td>
      </tr>`
    ).join("");

    sectionsHtml += `
      <h3 style="color:#059669;margin-top:24px;">New Hearings Found (${newMatches.length})</h3>
      <table style="width:100%;border-collapse:collapse;font-size:14px;">
        <tr style="background:#f0fdf4;">
          <th style="padding:8px;text-align:left;border-bottom:2px solid #059669;">Defendant</th>
          <th style="padding:8px;text-align:left;border-bottom:2px solid #059669;">Case #</th>
          <th style="padding:8px;text-align:left;border-bottom:2px solid #059669;">Date/Time</th>
          <th style="padding:8px;text-align:left;border-bottom:2px solid #059669;">Court</th>
          <th style="padding:8px;text-align:left;border-bottom:2px solid #059669;">Calendar</th>
        </tr>
        ${rows}
      </table>`;
  }

  const totalCount = items.length;
  const subject = `Court Calendar Daily Update — ${totalCount} change${totalCount !== 1 ? "s" : ""} detected`;

  const html = `
    <div style="max-width:700px;margin:0 auto;font-family:Arial,sans-serif;">
      <h2 style="color:#1e293b;">Court Calendar Daily Update</h2>
      <p style="color:#64748b;">Your daily summary of court calendar changes from the overnight check.</p>
      ${sectionsHtml}
      <hr style="margin-top:24px;border:none;border-top:1px solid #e5e7eb;" />
      <p style="color:#94a3b8;font-size:12px;">You're receiving this because you have active watched cases on Court Calendar Tracker. Manage your notification preferences in your profile settings.</p>
    </div>
  `;

  return sendEmail(to, subject, html);
}
