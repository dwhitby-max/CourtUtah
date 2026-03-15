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

  return <>{children}</>;
}
