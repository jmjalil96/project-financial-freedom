"use client";

import { RotateCcw } from "lucide-react";
import { useEffect } from "react";

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="decision-dashboard">
      <section className="dashboard-empty" role="alert">
        <span>
          <RotateCcw aria-hidden="true" size={26} />
        </span>
        <p className="eyebrow">Monthly brief unavailable</p>
        <h1>The source evidence could not be summarized.</h1>
        <p>
          Your financial records were not changed. Retry the read, or open the source
          workspaces directly from the navigation.
        </p>
        <button className="primary-button" onClick={reset} type="button">
          Try again
          <RotateCcw aria-hidden="true" size={16} />
        </button>
      </section>
    </main>
  );
}
