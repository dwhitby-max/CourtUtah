import nodemailer from "nodemailer";
import { config } from "../config/env";

/** Escape HTML special characters to prevent XSS/injection in email templates. */
function escHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

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

// Enable email when SMTP is configured — check for both host and user
const EMAIL_ENABLED = !!(config.smtp.host && config.smtp.user);

export async function sendEmail(to: string, subject: string, html: string): Promise<boolean> {
  if (!EMAIL_ENABLED) {
    console.log(`📧 Email suppressed (SMTP not set up yet) — subject: ${subject}`);
    return false;
  }

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
    console.log(`✅ Email sent: ${subject}`);
    return true;
  } catch (err) {
    console.error("❌ Email send failed:", err);
    return false;
  }
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
      <tr><td><strong>Email:</strong></td><td>${escHtml(newUserEmail)}</td></tr>
      <tr><td><strong>Signup IP:</strong></td><td>${escHtml(signupIp || "Unknown")}</td></tr>
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
    .map((c) => `<tr><td>${escHtml(c.field)}</td><td>${escHtml(c.oldValue)}</td><td>${escHtml(c.newValue)}</td></tr>`)
    .join("");

  const html = `
    <h2>Court Schedule Change Detected</h2>
    <p>A schedule change was detected for: <strong>${escHtml(caseName)}</strong></p>
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
    .map((e) => `<tr><td>${escHtml(e.date)}</td><td>${escHtml(e.time || "TBD")}</td><td>${escHtml(e.court)}</td><td>${escHtml(e.hearingType || "N/A")}</td></tr>`)
    .join("");

  const html = `
    <h2>New Court Hearing${events.length > 1 ? "s" : ""} Found</h2>
    <p>New hearing${events.length > 1 ? "s" : ""} matching your search <strong>"${escHtml(caseName)}"</strong> ${events.length > 1 ? "have" : "has"} been found and added to your calendar:</p>
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
      <tr><td><strong>Case:</strong></td><td>${escHtml(caseName)}</td></tr>
      <tr><td><strong>Defendant:</strong></td><td>${escHtml(details.defendant)}</td></tr>
      <tr><td><strong>Date:</strong></td><td>${escHtml(details.date)}</td></tr>
      <tr><td><strong>Time:</strong></td><td>${escHtml(details.time || "TBD")}</td></tr>
      <tr><td><strong>Court:</strong></td><td>${escHtml(details.court)}</td></tr>
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
        ? item.changes.map(c => `${escHtml(c.field)}: <span style="color:#b91c1c;text-decoration:line-through;">${escHtml(c.oldValue)}</span> &rarr; <span style="color:#059669;font-weight:bold;">${escHtml(c.newValue)}</span>`).join("<br/>")
        : "";
      return `<tr>
        <td style="padding:8px;border-bottom:1px solid #e5e7eb;">${escHtml(item.defendant || item.caseNumber)}</td>
        <td style="padding:8px;border-bottom:1px solid #e5e7eb;">${escHtml(item.caseNumber)}</td>
        <td style="padding:8px;border-bottom:1px solid #e5e7eb;">${escHtml(item.date)} ${escHtml(item.time || "")}</td>
        <td style="padding:8px;border-bottom:1px solid #e5e7eb;">${escHtml(item.court)}</td>
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
        <td style="padding:8px;border-bottom:1px solid #e5e7eb;">${escHtml(item.defendant || item.caseNumber)}</td>
        <td style="padding:8px;border-bottom:1px solid #e5e7eb;">${escHtml(item.caseNumber)}</td>
        <td style="padding:8px;border-bottom:1px solid #e5e7eb;">${escHtml(item.date)} ${escHtml(item.time || "")}</td>
        <td style="padding:8px;border-bottom:1px solid #e5e7eb;">${escHtml(item.court)}</td>
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
        <td style="padding:8px;border-bottom:1px solid #e5e7eb;">${escHtml(item.defendant || item.caseNumber)}</td>
        <td style="padding:8px;border-bottom:1px solid #e5e7eb;">${escHtml(item.caseNumber)}</td>
        <td style="padding:8px;border-bottom:1px solid #e5e7eb;">${escHtml(item.date)} ${escHtml(item.time || "")}</td>
        <td style="padding:8px;border-bottom:1px solid #e5e7eb;">${escHtml(item.court)}</td>
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
      <p style="color:#94a3b8;font-size:12px;">You're receiving this because you have saved searches on Court Calendar Tracker. Manage your notification preferences in your profile settings.</p>
    </div>
  `;

  return sendEmail(to, subject, html);
}
