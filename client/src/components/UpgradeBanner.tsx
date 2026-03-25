import { useNavigate } from "react-router-dom";

interface UpgradeBannerProps {
  totalResults: number;
  freeLimit: number;
}

export default function UpgradeBanner({ totalResults, freeLimit }: UpgradeBannerProps) {
  const navigate = useNavigate();
  const hiddenCount = totalResults - freeLimit;

  if (hiddenCount <= 0) return null;

  return (
    <div className="bg-gradient-to-r from-amber-50 to-amber-100 border border-amber-300 rounded-lg p-5 flex flex-col sm:flex-row items-center justify-between gap-4">
      <div>
        <h3 className="text-base font-semibold text-amber-900">
          {hiddenCount} more result{hiddenCount !== 1 ? "s" : ""} with dates & times hidden
        </h3>
        <p className="text-sm text-amber-700 mt-1">
          Upgrade to Pro for $14.99/mo to see all dates, times, and sync unlimited events to your calendar.
        </p>
      </div>
      <button
        onClick={() => navigate("/billing")}
        className="shrink-0 px-5 py-2.5 text-sm font-medium text-white bg-amber-600 hover:bg-amber-700 rounded-md transition-colors"
      >
        Click here to upgrade
      </button>
    </div>
  );
}
