import { config } from "../config/env";

// Lazy-loaded Twilio client
let twilioClient: unknown = null;

function getClient(): unknown {
  if (twilioClient) return twilioClient;

  if (!config.twilio.accountSid || !config.twilio.authToken) {
    console.warn("⚠️  Twilio not configured — SMS notifications disabled");
    return null;
  }

  try {
    // Dynamic import to avoid crash if twilio not installed
    const twilio = require("twilio");
    twilioClient = twilio(config.twilio.accountSid, config.twilio.authToken);
    return twilioClient;
  } catch (err) {
    console.warn("⚠️  Twilio module not available:", err);
    return null;
  }
}

export async function sendSms(to: string, message: string): Promise<boolean> {
  const client = getClient() as { messages?: { create: Function } } | null;
  if (!client || !client.messages) {
    console.warn("⚠️  SMS skipped (Twilio not configured):", message.slice(0, 50));
    return false;
  }

  if (!config.twilio.phoneNumber) {
    console.warn("⚠️  TWILIO_PHONE_NUMBER not set");
    return false;
  }

  try {
    await client.messages.create({
      body: message,
      from: config.twilio.phoneNumber,
      to,
    });
    console.log(`✅ SMS sent to ${to}`);
    return true;
  } catch (err) {
    console.error("❌ SMS send failed:", err);
    return false;
  }
}

export async function sendScheduleChangeSms(
  to: string,
  caseName: string,
  summary: string
): Promise<boolean> {
  const message = `Court Schedule Change: ${caseName} — ${summary}. Check your calendar for details.`;
  return sendSms(to, message);
}
