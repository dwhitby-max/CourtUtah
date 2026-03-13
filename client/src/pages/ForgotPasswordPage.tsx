import { useState } from "react";
import { Link } from "react-router-dom";
import { forgotPassword } from "@/api/auth";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      await forgotPassword(email);
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Request failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <div className="max-w-md w-full space-y-8">
        <div className="text-center">
          <h1 className="text-3xl font-bold text-indigo-800">Reset Password</h1>
        </div>

        <div className="bg-white shadow rounded-lg p-8">
          {sent ? (
            <div className="text-center space-y-4">
              <div className="text-green-600 text-lg font-medium">Check your email</div>
              <p className="text-gray-600 text-sm">
                If an account exists with that email, we've sent password reset instructions.
              </p>
              <Link to="/login" className="text-indigo-600 hover:text-indigo-500 text-sm">
                Back to sign in
              </Link>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-6">
              {error && <div className="bg-red-50 text-red-700 p-3 rounded-md text-sm">{error}</div>}

              <p className="text-gray-600 text-sm">
                Enter your email address and we'll send you a link to reset your password.
              </p>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
                <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 focus:ring-indigo-500 focus:border-indigo-500" />
              </div>

              <button type="submit" disabled={loading}
                className="w-full bg-indigo-600 text-white py-2 rounded-md font-medium hover:bg-indigo-700 disabled:opacity-50">
                {loading ? "Sending..." : "Send Reset Link"}
              </button>

              <div className="text-center text-sm">
                <Link to="/login" className="text-indigo-600 hover:text-indigo-500">Back to sign in</Link>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
