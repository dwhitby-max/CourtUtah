import { apiFetch } from "./client";

export async function createCheckoutSession(): Promise<{ url: string }> {
  const res = await apiFetch("/billing/create-checkout-session", { method: "POST" });
  if (!res.ok) {
    const data = await res.json();
    throw new Error(data.error || "Failed to create checkout session");
  }
  return res.json();
}

export async function createPortalSession(): Promise<{ url: string }> {
  const res = await apiFetch("/billing/create-portal-session", { method: "POST" });
  if (!res.ok) {
    const data = await res.json();
    throw new Error(data.error || "Failed to create portal session");
  }
  return res.json();
}

export async function activateSubscription(sessionId: string): Promise<{
  plan: string;
  status: string;
  currentPeriodEnd: string | null;
}> {
  const res = await apiFetch("/billing/activate", {
    method: "POST",
    body: JSON.stringify({ sessionId }),
  });
  if (!res.ok) {
    const data = await res.json();
    throw new Error(data.error || "Failed to activate subscription");
  }
  return res.json();
}

export async function getSubscription(): Promise<{
  plan: string;
  status: string;
  currentPeriodEnd: string | null;
}> {
  const res = await apiFetch("/billing/subscription");
  if (!res.ok) {
    const data = await res.json();
    throw new Error(data.error || "Failed to fetch subscription");
  }
  return res.json();
}
