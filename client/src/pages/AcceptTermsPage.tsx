import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { apiFetch } from "@/api/client";
import { useAuth } from "@/store/authStore";

export default function AcceptTermsPage() {
  const [agreed, setAgreed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const { setUser } = useAuth();
  const navigate = useNavigate();

  async function handleAccept() {
    if (!agreed) return;
    setLoading(true);
    setError("");

    try {
      const res = await apiFetch("/auth/accept-terms", { method: "POST" });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to accept terms");
      }
      const data = await res.json();
      setUser(data.user);
      navigate("/dashboard", { replace: true });
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <div className="max-w-md w-full space-y-8">
        <div className="text-center">
          <img src="/logo.svg" alt="Court Calendar Tracker" className="h-16 w-16 mx-auto mb-3" />
          <h1 className="text-2xl font-bold text-slate-800">Welcome to Court Calendar Tracker</h1>
          <p className="mt-2 text-gray-600">Please review and accept our terms to continue.</p>
        </div>

        <div className="bg-white shadow rounded-lg p-8 space-y-6">
          {error && (
            <div className="bg-red-50 text-red-700 p-3 rounded-md text-sm">{error}</div>
          )}

          <div className="space-y-3 text-sm text-gray-600">
            <p>Before using the Service, you must agree to our:</p>
            <ul className="list-disc pl-6 space-y-1">
              <li>
                <Link to="/privacy" className="text-amber-700 hover:text-amber-800 underline" target="_blank">
                  Privacy Policy
                </Link>
              </li>
              <li>
                <Link to="/terms" className="text-amber-700 hover:text-amber-800 underline" target="_blank">
                  Terms and Conditions
                </Link>
              </li>
            </ul>
          </div>

          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={agreed}
              onChange={(e) => setAgreed(e.target.checked)}
              className="mt-1 h-4 w-4 text-amber-700 border-gray-300 rounded focus:ring-amber-700"
            />
            <span className="text-sm text-gray-700">
              I have read and agree to the{" "}
              <Link to="/privacy" className="text-amber-700 underline" target="_blank">Privacy Policy</Link>
              {" "}and{" "}
              <Link to="/terms" className="text-amber-700 underline" target="_blank">Terms and Conditions</Link>.
            </span>
          </label>

          <button
            onClick={handleAccept}
            disabled={!agreed || loading}
            className="w-full bg-amber-700 text-white rounded-md px-4 py-3 font-medium hover:bg-amber-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? "Please wait..." : "Continue"}
          </button>
        </div>
      </div>
    </div>
  );
}
