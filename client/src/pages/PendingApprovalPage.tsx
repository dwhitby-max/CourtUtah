import { useAuth } from "@/store/authStore";
import { Navigate } from "react-router-dom";

export default function PendingApprovalPage() {
  const { isLoggedIn, user, logout } = useAuth();

  if (!isLoggedIn) {
    return <Navigate to="/login" replace />;
  }

  if (user?.isApproved) {
    return <Navigate to="/dashboard" replace />;
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <div className="max-w-md w-full space-y-6">
        <div className="text-center">
          <img src="/logo.svg" alt="Court Calendar Tracker" className="h-16 w-16 mx-auto mb-3" />
          <h1 className="text-2xl font-bold text-slate-800">Account Pending Approval</h1>
        </div>

        <div className="bg-white shadow rounded-lg p-8 space-y-4">
          <div className="bg-amber-50 border border-amber-200 text-amber-800 p-4 rounded-md text-sm">
            <p className="font-semibold mb-1">Your account is awaiting administrator approval.</p>
            <p>
              An administrator has been notified of your sign-up. You will receive an email
              at <strong>{user?.email}</strong> once your account has been approved.
            </p>
          </div>

          <p className="text-sm text-gray-500 text-center">
            This page will not update automatically. Please check back later or wait for the approval email.
          </p>

          <button
            onClick={logout}
            className="w-full bg-gray-100 text-gray-700 border border-gray-300 rounded-md px-4 py-2 text-sm font-medium hover:bg-gray-200 transition-colors"
          >
            Sign Out
          </button>
        </div>
      </div>
    </div>
  );
}
