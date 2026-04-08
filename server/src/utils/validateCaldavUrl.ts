import { URL } from "url";
import dns from "dns/promises";
import net from "net";

/**
 * Allowlisted CalDAV provider hostnames.
 * Only these hosts (and their subdomains) are accepted for CalDAV connections.
 */
const ALLOWED_CALDAV_HOSTS = [
  "caldav.icloud.com",
  "www.icloud.com",
  "caldav.fastmail.com",
  "dav.fastmail.com",
  "ical.fastmail.com",
  "caldav.google.com",
  "apidata.googleusercontent.com",
  "www.google.com",
  "caldav.yahoo.com",
  "outlook.office365.com",
  "caldav.zoho.com",
  "cloud.nextcloud.com",
  "dav.nextcloud.com",
  "caldav.gmx.net",
  "caldav.gmx.com",
  "posteo.de",
  "caldav.mailbox.org",
  "dav.mailbox.org",
  "fruux.com",
  "dav.fruux.com",
];

/** Check whether a hostname matches or is a subdomain of an allowed host. */
function isAllowedHost(hostname: string): boolean {
  const lower = hostname.toLowerCase();
  return ALLOWED_CALDAV_HOSTS.some(
    (allowed) => lower === allowed || lower.endsWith(`.${allowed}`)
  );
}

/** Check whether an IP address is private, loopback, or link-local. */
function isPrivateIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const parts = ip.split(".").map(Number);
    if (parts[0] === 127) return true;                         // 127.0.0.0/8
    if (parts[0] === 10) return true;                          // 10.0.0.0/8
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true; // 172.16.0.0/12
    if (parts[0] === 192 && parts[1] === 168) return true;    // 192.168.0.0/16
    if (parts[0] === 169 && parts[1] === 254) return true;    // 169.254.0.0/16 link-local
    if (parts[0] === 0) return true;                           // 0.0.0.0/8
  }
  if (net.isIPv6(ip)) {
    const normalized = ip.toLowerCase();
    if (normalized === "::1") return true;                     // loopback
    if (normalized.startsWith("fe80:")) return true;           // link-local
    if (normalized.startsWith("fc") || normalized.startsWith("fd")) return true; // ULA
  }
  return false;
}

/**
 * Validate a user-provided CalDAV URL.
 * Returns null if valid, or an error message string if invalid.
 *
 * Checks:
 * - Must be https
 * - Hostname must be in the allowlist
 * - Resolved IPs must not be private/loopback/link-local
 */
export async function validateCaldavUrl(caldavUrl: string): Promise<string | null> {
  let parsed: URL;
  try {
    parsed = new URL(caldavUrl);
  } catch {
    return "Invalid URL format";
  }

  if (parsed.protocol !== "https:") {
    return "CalDAV URL must use HTTPS";
  }

  const hostname = parsed.hostname.toLowerCase();

  // Reject IPs used directly as hostname
  if (net.isIP(hostname)) {
    return "CalDAV URL must use a hostname, not an IP address";
  }

  // Hostname allowlist
  if (!isAllowedHost(hostname)) {
    return `CalDAV host "${hostname}" is not in the list of supported providers. Contact support to request adding your provider.`;
  }

  // DNS resolution check — ensure the hostname doesn't resolve to a private IP
  try {
    const addresses = await dns.resolve4(hostname).catch(() => [] as string[]);
    const addresses6 = await dns.resolve6(hostname).catch(() => [] as string[]);
    const allAddresses = [...addresses, ...addresses6];

    if (allAddresses.length === 0) {
      return "CalDAV hostname could not be resolved";
    }

    for (const addr of allAddresses) {
      if (isPrivateIp(addr)) {
        return "CalDAV URL resolves to a private or internal address";
      }
    }
  } catch {
    return "Failed to verify CalDAV hostname";
  }

  return null; // valid
}
