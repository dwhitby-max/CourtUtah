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

    // Fetch profile directly (bypass apiFetch's 401 redirect which races with our error handling)
    fetch("/api/auth/me", {
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`,
      },
    })
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.text().catch(() => "");
          throw new Error(`Profile fetch failed: ${res.status} ${res.statusText} ${body}`);
        }
        return res.json();
      })
      .then((data) => {
        setUser(data.user);
        // Clear the Google connect attempt flag — successful login means it worked
        sessionStorage.removeItem("google_connect_attempted");
        if (!data.user.tosAgreedAt) {
          navigate("/accept-terms", { replace: true });
        } else {
          navigate("/dashboard", { replace: true });
        }
      })
      .catch((err) => {
        console.error("Login callback failed:", err);
        setError(`Failed to complete sign-in: ${err.message}`);
        navigate(`/login?error=callback_failed&detail=${encodeURIComponent(err.message)}`, { replace: true });
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
