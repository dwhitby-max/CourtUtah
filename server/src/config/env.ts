function validateEnv(): void {
  const expected = ["DATABASE_URL", "JWT_SECRET", "ENCRYPTION_KEY"];
  const missing = expected.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    console.error(`⚠️  Missing environment variables: ${missing.join(", ")}`);
    console.error("⚠️  Server will start but affected features will fail.");
  }
}

export function getEnv(key: string): string {
  const value = process.env[key];
  if (!value) {
    console.warn(`⚠️  Environment variable ${key} is not set`);
    return "";
  }
  return value;
}

export const config = {
  port: parseInt(process.env.PORT || "5000", 10),
  host: process.env.HOST || "0.0.0.0",
  nodeEnv: process.env.NODE_ENV || "development",
  databaseUrl: process.env.DATABASE_URL || "",
  jwtSecret: process.env.JWT_SECRET || "",
  encryptionKey: process.env.ENCRYPTION_KEY || "",

  google: {
    clientId: process.env.GOOGLE_CLIENT_ID || "",
    clientSecret: process.env.GOOGLE_CLIENT_SECRET || "",
    redirectUri: process.env.GOOGLE_REDIRECT_URI || "",
    calendarRedirectUri: process.env.GOOGLE_CALENDAR_REDIRECT_URI || "",
  },

  microsoft: {
    clientId: process.env.MICROSOFT_CLIENT_ID || "",
    clientSecret: process.env.MICROSOFT_CLIENT_SECRET || "",
    redirectUri: process.env.MICROSOFT_REDIRECT_URI || "",
  },

  smtp: {
    host: process.env.SMTP_HOST || "",
    port: parseInt(process.env.SMTP_PORT || "587", 10),
    user: process.env.SMTP_USER || "",
    pass: process.env.SMTP_PASS || "",
    fromEmail: process.env.FROM_EMAIL || "noreply@courttracker.app",
  },

  twilio: {
    accountSid: process.env.TWILIO_ACCOUNT_SID || "",
    authToken: process.env.TWILIO_AUTH_TOKEN || "",
    phoneNumber: process.env.TWILIO_PHONE_NUMBER || "",
  },

  corsOrigin: process.env.CORS_ORIGIN || "",

  sentryDsn: process.env.SENTRY_DSN || "",

  adminEmail: process.env.ADMIN_EMAIL || "",
};

validateEnv();
