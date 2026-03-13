import { useState, useEffect } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { login } from "@/api/auth";
import { useAuth } from "@/store/authStore";
import { apiFetch } from "@/api/client";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [verificationBanner, setVerificationBanner] = useState<{
    type: "success" | "error" | "info";
    message: string;
  } | null>(null);
  const [resendLoading, setResendLoading] = useState(false);
  const { setUser } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  useEffect(() => {
    const verified = searchParams.get("verified");
    if (verified === "success") {
      setVerificationBanner({
        type: "success",
        message: "Email verified successfully! You can now sign in.",
      });
    } else if (verified === "invalid") {
      setVerificationBanner({
        type: "error",
        message: "Invalid or expired verification link. Please request a new one.",
      });
    } else if (verified === "expired") {
      setVerificationBanner({
        type: "error",
        message: "Verification link has expired. Please request a new one below.",
      });
    }

    const registered = searchParams.get("registered");
    if (registered === "true") {
      setVerificationBanner({
        type: "info",
        message: "Account created! Check your email for a verification link.",
      });
    }
  }, [searchParams]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const data = await login(email, password);
      setUser(data.user);
      navigate("/");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Login failed";
      setError(msg);
      // If login fails because email not verified, show resend option
      if (msg.toLowerCase().includes("verify") || msg.toLowerCase().includes("verification")) {
        setVerificationBanner({
          type: "info",
          message: "Please verify your email before signing in.",
        });
      }
    } finally {
      setLoading(false);
    }
  }

  async function handleResendVerification() {
    if (!email) {
      setError("Enter your email address first, then click resend.");
      return;
    }
    setResendLoading(true);
    try {
      const res = await apiFetch("/auth/resend-verification", {
        method: "POST",
        body: JSON.stringify({ email }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to resend");
      }
      setVerificationBanner({
        type: "success",
        message: "Verification email sent! Check your inbox.",
      });
    } catch (err) {
      setVerificationBanner({
        type: "error",
        message: err instanceof Error ? err.message : "Failed to resend verification email.",
      });
    } finally {
      setResendLoading(false);
    }
  }

  const bannerColors = {
    success: "bg-green-50 text-green-800 border-green-200",
    error: "bg-red-50 text-red-800 border-red-200",
    info: "bg-blue-50 text-blue-800 border-blue-200",
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <div className="max-w-md w-full space-y-8">
        <div className="text-center">
          <h1 className="text-3xl font-bold text-indigo-800">Court Calendar Tracker</h1>
          <h2 className="mt-2 text-xl text-gray-600">Sign in to your account</h2>
        </div>

        <form onSubmit={handleSubmit} className="bg-white shadow rounded-lg p-8 space-y-6">
          {verificationBanner && (
            <div className={`p-3 rounded-md border text-sm ${bannerColors[verificationBanner.type]}`}>
              <p>{verificationBanner.message}</p>
              {(verificationBanner.type === "error" || verificationBanner.type === "info") && (
                <button
                  type="button"
                  onClick={handleResendVerification}
                  disabled={resendLoading}
                  className="mt-2 underline font-medium hover:opacity-80 disabled:opacity-50"
                >
                  {resendLoading ? "Sending..." : "Resend verification email"}
                </button>
              )}
            </div>
          )}

          {error && (
            <div className="bg-red-50 text-red-700 p-3 rounded-md text-sm">{error}</div>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full border border-gray-300 rounded-md px-3 py-2 focus:ring-indigo-500 focus:border-indigo-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Password</label>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full border border-gray-300 rounded-md px-3 py-2 focus:ring-indigo-500 focus:border-indigo-500"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-indigo-600 text-white py-2 rounded-md font-medium hover:bg-indigo-700 disabled:opacity-50"
          >
            {loading ? "Signing in..." : "Sign In"}
          </button>

          <div className="flex justify-between text-sm">
            <Link to="/forgot-password" className="text-indigo-600 hover:text-indigo-500">
              Forgot password?
            </Link>
            <Link to="/register" className="text-indigo-600 hover:text-indigo-500">
              Create account
            </Link>
          </div>
        </form>
      </div>
    </div>
  );
}
