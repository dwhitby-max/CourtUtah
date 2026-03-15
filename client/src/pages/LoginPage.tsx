import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";

const errorMessages: Record<string, string> = {
  google_denied: "Google sign-in was cancelled.",
  google_failed: "Google sign-in failed. Please try again.",
  missing_params: "Sign-in failed — missing parameters.",
  invalid_state: "Sign-in session expired. Please try again.",
  db_unavailable: "Service temporarily unavailable. Please try again later.",
  callback_failed: "Failed to complete sign-in. Please try again.",
};

export default function LoginPage() {
  const [searchParams] = useSearchParams();
  const [error, setError] = useState("");

  useEffect(() => {
    const err = searchParams.get("error");
    if (err) setError(errorMessages[err] || "Sign-in failed. Please try again.");
  }, [searchParams]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <div className="max-w-md w-full space-y-8">
        <div className="text-center">
          <img src="/logo.svg" alt="Court Calendar Tracker" className="h-16 w-16 mx-auto mb-3" />
          <h1 className="text-3xl font-bold text-slate-800">Court Calendar Tracker</h1>
          <p className="mt-2 text-gray-600">Track Utah court schedules and sync to your calendar</p>
        </div>

        <div className="bg-white shadow rounded-lg p-8 space-y-6">
          {error && (
            <div className="bg-red-50 text-red-700 p-3 rounded-md text-sm">{error}</div>
          )}

          <button
            onClick={() => { window.location.href = "/api/auth/google"; }}
            className="w-full flex items-center justify-center gap-3 bg-white border-2 border-gray-300 rounded-md px-4 py-3 font-medium text-gray-700 hover:bg-gray-50 hover:border-gray-400 transition-colors"
          >
            <svg className="w-5 h-5" viewBox="0 0 24 24">
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" />
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
              <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
            </svg>
            Sign in with Google
          </button>

          <p className="text-xs text-center text-gray-500">
            Signing in connects your Google Calendar automatically.
          </p>
        </div>

        <div className="text-center text-xs text-gray-400 space-x-3">
          <Link to="/privacy" className="hover:text-gray-600 underline">Privacy Policy</Link>
          <span>&middot;</span>
          <Link to="/terms" className="hover:text-gray-600 underline">Terms and Conditions</Link>
        </div>
      </div>
    </div>
  );
}
