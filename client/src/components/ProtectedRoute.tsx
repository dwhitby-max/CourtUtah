import { Navigate } from "react-router-dom";
import { useAuth } from "@/store/authStore";
import { clearToken } from "@/api/client";
import { ReactNode } from "react";

export default function ProtectedRoute({ children }: { children: ReactNode }) {
  const { isLoggedIn, user } = useAuth();

  if (!isLoggedIn) {
    return <Navigate to="/login" replace />;
  }

  if (!user?.tosAgreedAt) {
    return <Navigate to="/accept-terms" replace />;
  }

  // If user hasn't connected Google (old password-based account), force Google OAuth
  // This creates the Google link AND calendar connection in one step
  if (!user.googleConnected) {
    // Clear old session so the Google OAuth callback sets up everything fresh
    clearToken();
    window.location.href = "/api/auth/google";
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="animate-spin h-8 w-8 border-4 border-amber-700 border-t-transparent rounded-full mx-auto mb-4" />
          <p className="text-gray-600">Connecting your Google Calendar...</p>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
