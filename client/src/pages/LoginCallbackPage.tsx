import { useEffect, useState } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { setToken, apiFetch } from "@/api/client";
import { useAuth } from "@/store/authStore";

export default function LoginCallbackPage() {
  const [searchParams] = useSearchParams();
  const [error, setError] = useState("");
  const { setUser } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    const token = searchParams.get("token");
    if (!token) {
      setError("Missing authentication token.");
      return;
    }

    // Store token and fetch user profile
    setToken(token);

    apiFetch("/auth/me")
      .then(async (res) => {
        if (!res.ok) throw new Error("Failed to fetch profile");
        const data = await res.json();
        setUser(data.user);
        if (!data.user.tosAgreedAt) {
          navigate("/accept-terms", { replace: true });
        } else {
          navigate("/", { replace: true });
        }
      })
      .catch(() => {
        setError("Failed to complete sign-in. Please try again.");
        navigate("/login?error=callback_failed", { replace: true });
      });
  }, []);

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="bg-red-50 text-red-700 p-4 rounded-md">{error}</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="text-center">
        <div className="animate-spin h-8 w-8 border-4 border-amber-700 border-t-transparent rounded-full mx-auto mb-4" />
        <p className="text-gray-600">Signing you in...</p>
      </div>
    </div>
  );
}
