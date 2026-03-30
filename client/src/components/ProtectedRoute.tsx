import { Navigate } from "react-router-dom";
import { useAuth } from "@/store/authStore";
import { ReactNode } from "react";

export default function ProtectedRoute({ children }: { children: ReactNode }) {
  const { isLoggedIn, user } = useAuth();

  if (!isLoggedIn) {
    return <Navigate to="/login" replace />;
  }

  if (!user?.tosAgreedAt) {
    return <Navigate to="/accept-terms" replace />;
  }

  // Block unapproved users — show pending approval page
  if (user && !user.isApproved) {
    return <Navigate to="/pending-approval" replace />;
  }

  // If user hasn't connected any calendar provider, redirect to connect one.
  // Use sessionStorage flag to prevent redirect loops — only attempt once per session.
  const hasCalendarProvider = user.googleConnected || user.microsoftConnected;
  if (!hasCalendarProvider) {
    const attempted = sessionStorage.getItem("google_connect_attempted");
    if (!attempted) {
      sessionStorage.setItem("google_connect_attempted", "1");
      window.location.href = "/api/auth/google";
      return (
        <div className="min-h-screen flex items-center justify-center bg-gray-50">
          <div className="text-center">
            <div className="animate-spin h-8 w-8 border-4 border-amber-700 border-t-transparent rounded-full mx-auto mb-4" />
            <p className="text-gray-600">Connecting your calendar...</p>
          </div>
        </div>
      );
    }
    // Already attempted this session — let them through to avoid infinite loop
  }

  return <>{children}</>;
}
