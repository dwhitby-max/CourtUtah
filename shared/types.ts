// ============================================================
// SHARED TYPES — Single source of truth (Rule 10.5)
// Both client/ and server/ import from here.
// ============================================================

// --- Auth ---

export type SubscriptionPlan = "free" | "pro";
export type SubscriptionStatus = "none" | "active" | "canceled" | "past_due" | "trialing" | "grandfathered";
export type AccountType = "individual_attorney" | "agency";

export interface UserPublic {
  id: number;
  email: string;
  phone: string | null;
  emailVerified: boolean;
  googleConnected: boolean;
  microsoftConnected: boolean;
  isAdmin: boolean;
  isApproved: boolean;
  notificationPreferences: NotificationPreferences;
  calendarPreferences: CalendarPreferences;
  searchPreferences: SearchPreferences;
  tosAgreedAt: string | null;
  createdAt: string;
  subscriptionPlan: SubscriptionPlan;
  subscriptionStatus: SubscriptionStatus;
  subscriptionCurrentPeriodEnd: string | null;
  accountType: AccountType | null;
}

export type NotificationFrequency = "immediate" | "daily_digest" | "weekly_digest";

export interface NotificationPreferences {
  emailEnabled: boolean;
  smsEnabled: boolean;
  inAppEnabled: boolean;
  frequency: NotificationFrequency;
}

export interface CalendarPreferences {
  eventTag: string;
  eventColorId: string;
}

export interface SearchPreferences {
  defaultCourts: string[];
}

// --- Calendar Connections ---

export type CalendarProvider = "google" | "microsoft" | "apple" | "caldav";

export interface CalendarConnection {
  id: number;
  userId: number;
  provider: CalendarProvider;
  calendarId: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CalendarConnectionRequest {
  provider: CalendarProvider;
  calendarId?: string;
  caldavUrl?: string;
  username?: string;
  password?: string;
}

export interface OAuthStartResponse {
  authUrl: string;
}

// --- Court Events ---

export interface CourtEvent {
  id: number;
  courtType: string;
  courtName: string;
  courtRoom: string | null;
  eventDate: string;
  eventTime: string | null;
  hearingType: string | null;
  caseNumber: string | null;
  caseType: string | null;
  defendantName: string | null;
  defendantOtn: string | null;
  defendantDob: string | null;
  citationNumber: string | null;
  sheriffNumber: string | null;
  leaNumber: string | null;
  prosecutingAttorney: string | null;
  defenseAttorney: string | null;
  judgeName: string | null;
  hearingLocation: string | null;
  isVirtual: boolean;
  sourcePdfUrl: string | null;
  sourceUrl: string | null;
  sourcePageNumber: number | null;
  contentHash: string;
  charges: string[];
  scrapedAt: string;
  createdAt?: string;
  isNew?: boolean;
}

// --- Search ---

export interface SearchRequest {
  defendantName?: string;
  caseNumber?: string;
  courtName?: string;
  /** Comma-separated list of specific court names to filter by */
  courtNames?: string;
  courtDate?: string;
  dateFrom?: string;
  dateTo?: string;
  defendantOtn?: string;
  citationNumber?: string;
  charges?: string;
  judgeName?: string;
  attorney?: string;
}

export interface DetectedChange {
  courtEventId: number;
  caseNumber: string | null;
  defendantName: string | null;
  changes: Array<{ field: string; oldValue: string; newValue: string }>;
}

export interface SearchResponse {
  results: CourtEvent[];
  resultsCount: number;
  searchParams: SearchRequest;
  source?: "live" | "database" | "cached";
  /** ID of the auto-saved watched case for this search */
  savedSearchId?: number | null;
  previousRunAt?: string | null;
  processedAt: string;
  /** Changes detected when comparing live results against DB (re-run only) */
  detectedChanges?: DetectedChange[];
  /** True if free plan saved search limit (3) was reached — search not saved */
  savedSearchLimitReached?: boolean;
  /** User's subscription plan */
  userPlan?: string;
  /** True if results were served from today's cache (no live scrape) */
  cachedToday?: boolean;
  /** Warnings about partial failures during search (e.g., failed day/court requests) */
  searchWarnings?: string[];
  /** True if the prior live scrape for this saved search had partial failures.
   *  Used to decide whether to show a "Retry" button on cached results. */
  priorScrapeHadFailures?: boolean;
}

// --- Calendar Entries ---

export interface CalendarEntry {
  id: number;
  userId: number;
  savedSearchId: number | null;
  courtEventId: number;
  calendarConnectionId: number;
  externalEventId: string | null;
  externalCalendarId: string | null;
  lastSyncedContentHash: string | null;
  syncStatus: "pending" | "synced" | "error" | "pending_update";
  syncError: string | null;
  createdAt: string;
  updatedAt: string;
}

// --- Notifications ---

export type NotificationType = "schedule_change" | "new_event" | "new_match" | "event_cancelled" | "sync_error" | "calendar_disconnected" | "system";

export interface Notification {
  id: number;
  userId: number;
  type: NotificationType;
  title: string;
  message: string;
  metadata: Record<string, unknown>;
  read: boolean;
  channelsSent: string[];
  createdAt: string;
}

export interface NotificationListResponse {
  notifications: Notification[];
  unreadCount: number;
  total: number;
}

// --- Change Log ---

export interface ChangeLogEntry {
  id: number;
  courtEventId: number;
  fieldChanged: string;
  oldValue: string | null;
  newValue: string | null;
  detectedAt: string;
}

// --- Scrape Jobs ---

export interface ScrapeJob {
  id: number;
  status: "pending" | "running" | "completed" | "failed";
  courtsProcessed: number;
  eventsFound: number;
  eventsChanged: number;
  errorMessage: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
}

// --- Calendar Sync ---

export interface CalendarEventData {
  title: string;
  description: string;
  startDate: string;
  startTime: string | null;
  location: string;
  courtName: string;
  caseNumber: string | null;
}

/** Row shape from the calendar_entries JOIN calendar_connections JOIN court_events query */
export interface CalendarSyncRow {
  id: number;
  external_event_id: string | null;
  external_calendar_id: string | null;
  last_synced_content_hash: string | null;
  calendar_connection_id: number;
  provider: CalendarProvider;
  access_token_encrypted: string;
  refresh_token_encrypted: string | null;
  token_expires_at: string | null;
  calendar_id: string | null;
  caldav_url: string | null;
  court_name: string;
  court_room: string | null;
  event_date: string;
  event_time: string | null;
  hearing_type: string | null;
  case_number: string | null;
  case_type: string | null;
  defendant_name: string | null;
  content_hash: string;
}

/** Google OAuth token exchange / refresh response */
export interface GoogleTokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  scope: string;
  token_type: string;
  error?: string;
  error_description?: string;
}

/** Google Calendar API event resource (subset of fields we use) */
export interface GoogleCalendarEvent {
  id: string;
  summary: string;
  description: string;
  location: string;
  start: { dateTime?: string; date?: string; timeZone?: string };
  end: { dateTime?: string; date?: string; timeZone?: string };
}

/** Microsoft OAuth token exchange / refresh response */
export interface MicrosoftTokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  scope: string;
  token_type: string;
  error?: string;
  error_description?: string;
}

/** Microsoft Graph Calendar event resource (subset of fields we use) */
export interface MicrosoftCalendarEvent {
  id: string;
  subject: string;
  body: { contentType: string; content: string };
  start: { dateTime: string; timeZone: string };
  end: { dateTime: string; timeZone: string };
  location: { displayName: string };
  isAllDay: boolean;
}

/** CalDAV sync result — the UID we use to track the event */
export interface CalDAVSyncResult {
  uid: string;
  etag: string | null;
}

// --- Socket.io Events ---

export interface ServerToClientEvents {
  new_notification: (payload: { unreadCount: number; notification: Notification }) => void;
}

export interface ClientToServerEvents {
  // No client-controlled events — auth is handled via JWT in handshake
}

// --- API Responses ---

export interface ApiError {
  error: string;
  correlationId?: string;
}

export interface ApiSuccess {
  message: string;
}

// --- Health ---

export interface HealthResponse {
  status: string;
  timestamp: string;
  uptime: number;
  environment: string | undefined;
  port: string | undefined;
  database: string;
  pool: {
    total: number;
    idle: number;
    waiting: number;
    max: number;
    utilizationPct: number;
  } | null;
  memory: {
    used: number;
    total: number;
  };
}
