import { Navigate } from "react-router-dom";
import { useAuth } from "@/store/authStore";
import { apiFetch } from "@/api/client";
import { ReactNode, useEffect, useState } from "react";

export default function ProtectedRoute({ children }: { children: ReactNode }) {
  const { isLoggedIn, user } = useAuth();
  const [calendarChecked, setCalendarChecked] = useState(false);
  const [hasCalendar, setHasCalendar] = useState(true); // assume true until checked
  const [redirecting, setRedirecting] = useState(false);

  useEffect(() => {
    if (isLoggedIn && user?.tosAgreedAt) {
      apiFetch("/calendar/connections")
        .then(async (res) => {
          if (res.ok) {
            const data = await res.json();
            const active = (data.connections || []).some((c: { is_active: boolean }) => c.is_active);
            setHasCalendar(active);
          }
          setCalendarChecked(true);
        })
        .catch(() => setCalendarChecked(true));
    }
  }, [isLoggedIn, user?.tosAgreedAt]);

  useEffect(() => {
    if (calendarChecked && !hasCalendar && !redirecting) {
      setRedirecting(true);
      // Use the auth Google flow which creates both user link AND calendar connection
      window.location.href = "/api/auth/google";
    }
  }, [calendarChecked, hasCalendar, redirecting]);

  if (!isLoggedIn) {
    return <Navigate to="/login" replace />;
  }

  if (!user?.tosAgreedAt) {
    return <Navigate to="/accept-terms" replace />;
  }

  // Wait for calendar check before rendering
  if (!calendarChecked || (calendarChecked && !hasCalendar)) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="animate-spin h-8 w-8 border-4 border-amber-700 border-t-transparent rounded-full mx-auto mb-4" />
          <p className="text-gray-600">{redirecting ? "Connecting your Google Calendar..." : "Loading..."}</p>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
