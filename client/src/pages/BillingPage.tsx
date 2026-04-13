import { useState, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { useAuth } from "@/store/authStore";
import { apiFetch } from "@/api/client";
import { createCheckoutSession, createPortalSession, getSubscription, activateSubscription } from "@/api/billing";

export default function BillingPage() {
  const { user, setUser } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [activating, setActivating] = useState(false);
  const [activated, setActivated] = useState(false);
  const [subscription, setSubscription] = useState<{
    plan: string;
    status: string;
    currentPeriodEnd: string | null;
  } | null>(null);

  // Activate subscription when returning from Stripe Checkout with session_id
  useEffect(() => {
    const sessionId = searchParams.get("session_id");
    if (!sessionId) return;

    setActivating(true);
    activateSubscription(sessionId)
      .then((sub) => {
        setSubscription(sub);
        setActivated(true);
        // Remove session_id from URL
        setSearchParams({}, { replace: true });
        // Refresh user state so the rest of the app knows they're Pro
        apiFetch("/auth/me")
          .then((res) => res.json())
          .then((data) => { if (data.user) setUser(data.user); })
          .catch(() => {});
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : "Failed to activate subscription");
        // Still fetch current status as fallback
        getSubscription().then(setSubscription).catch(() => {});
      })
      .finally(() => setActivating(false));
  }, []);

  useEffect(() => {
    if (!searchParams.get("session_id")) {
      getSubscription()
        .then(setSubscription)
        .catch((err) => console.error("Failed to fetch subscription:", err));
    }
  }, []);

  const isPro = subscription?.plan === "pro" && (subscription?.status === "active" || subscription?.status === "grandfathered");

  async function handleUpgrade() {
    setLoading(true);
    setError("");
    try {
      const { url } = await createCheckoutSession();
      if (url) window.location.href = url;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start checkout");
    } finally {
      setLoading(false);
    }
  }

  async function handleManageBilling() {
    setLoading(true);
    setError("");
    try {
      const { url } = await createPortalSession();
      if (url) window.location.href = url;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to open billing portal");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="max-w-3xl mx-auto space-y-8">
      <h1 className="text-2xl font-bold text-gray-900">Billing & Subscription</h1>

      {activating && (
        <div className="bg-blue-50 text-blue-700 p-4 rounded-md text-sm flex items-center gap-2">
          <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
          </svg>
          Activating your subscription...
        </div>
      )}

      {activated && (
        <div className="bg-green-50 text-green-700 p-4 rounded-md text-sm flex items-center gap-2">
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          Your Pro subscription is now active! You have unlimited access.
        </div>
      )}

      {error && <div className="bg-red-50 text-red-700 p-4 rounded-md text-sm">{error}</div>}

      {/* Current plan status */}
      {subscription && (
        <div className="bg-white shadow rounded-lg p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-2">Current Plan</h2>
          <div className="flex items-center gap-3">
            <span className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-medium ${
              isPro ? "bg-green-100 text-green-800" : "bg-gray-100 text-gray-700"
            }`}>
              {isPro ? "Pro" : "Free"}
            </span>
            {isPro && subscription.currentPeriodEnd && (
              <span className="text-sm text-gray-500">
                Renews {new Date(subscription.currentPeriodEnd).toLocaleDateString("en-US", { timeZone: "America/Denver" })}
              </span>
            )}
          </div>
          {isPro && (
            <button
              onClick={handleManageBilling}
              disabled={loading}
              className="mt-4 text-sm text-amber-700 hover:text-amber-900 underline disabled:opacity-50"
            >
              Manage billing & invoices
            </button>
          )}
        </div>
      )}

      {/* Pricing cards */}
      <div className="grid md:grid-cols-2 gap-6">
        {/* Free tier */}
        <div className={`bg-white shadow rounded-lg p-6 border-2 ${!isPro ? "border-gray-300" : "border-transparent"}`}>
          <h3 className="text-lg font-semibold text-gray-900">Free</h3>
          <p className="text-3xl font-bold text-gray-900 mt-2">$0<span className="text-base font-normal text-gray-500">/month</span></p>
          <ul className="mt-6 space-y-3 text-sm text-gray-600">
            <li className="flex items-start gap-2">
              <svg className="w-5 h-5 text-green-500 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
              Unlimited searches
            </li>
            <li className="flex items-start gap-2">
              <svg className="w-5 h-5 text-green-500 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
              View 5 full results per search
            </li>
            <li className="flex items-start gap-2">
              <svg className="w-5 h-5 text-green-500 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
              Sync up to 5 events to calendar
            </li>
            <li className="flex items-start gap-2">
              <svg className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
              </svg>
              Dates & times hidden after 5 results
            </li>
          </ul>
          {!isPro && (
            <div className="mt-6">
              <span className="inline-block px-4 py-2 text-sm font-medium text-gray-500 bg-gray-100 rounded-md">
                Current Plan
              </span>
            </div>
          )}
        </div>

        {/* Pro tier */}
        <div className={`bg-white shadow rounded-lg p-6 border-2 ${isPro ? "border-green-500" : "border-amber-500"}`}>
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold text-gray-900">Pro</h3>
            {!isPro && (
              <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-800">
                Recommended
              </span>
            )}
          </div>
          <p className="text-3xl font-bold text-gray-900 mt-2">$14.99<span className="text-base font-normal text-gray-500">/month</span></p>
          <ul className="mt-6 space-y-3 text-sm text-gray-600">
            <li className="flex items-start gap-2">
              <svg className="w-5 h-5 text-green-500 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
              Unlimited searches
            </li>
            <li className="flex items-start gap-2">
              <svg className="w-5 h-5 text-green-500 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
              <strong>All results fully visible</strong>
            </li>
            <li className="flex items-start gap-2">
              <svg className="w-5 h-5 text-green-500 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
              <strong>Unlimited calendar syncs</strong>
            </li>
            <li className="flex items-start gap-2">
              <svg className="w-5 h-5 text-green-500 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
              Unlimited saved searches & auto-updates
            </li>
            <li className="flex items-start gap-2">
              <svg className="w-5 h-5 text-green-500 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
              Email & SMS notifications
            </li>
          </ul>
          <div className="mt-6">
            {isPro ? (
              <span className="inline-block px-4 py-2 text-sm font-medium text-green-700 bg-green-100 rounded-md">
                Active
              </span>
            ) : (
              <button
                onClick={handleUpgrade}
                disabled={loading}
                className="w-full px-4 py-2 text-sm font-medium text-white bg-amber-600 hover:bg-amber-700 rounded-md disabled:opacity-50 transition-colors"
              >
                {loading ? "Loading..." : "Upgrade to Pro — $14.99/mo"}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
