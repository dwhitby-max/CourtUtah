export function logInfo(message: string, data?: Record<string, unknown>): void {
  console.log(`✅ ${message}`, data ? JSON.stringify(data) : "");
}

export function logWarn(message: string, data?: Record<string, unknown>): void {
  console.warn(`⚠️  ${message}`, data ? JSON.stringify(data) : "");
}

export function logError(message: string, error?: unknown): void {
  console.error(`❌ ${message}`, error instanceof Error ? error.stack : error);
}

export function logDebug(message: string, data?: Record<string, unknown>): void {
  if (process.env.NODE_ENV !== "production") {
    console.log(`🔍 ${message}`, data ? JSON.stringify(data) : "");
  }
}
