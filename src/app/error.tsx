"use client";

import { AlertTriangle, RotateCcw } from "lucide-react";
import { useEffect } from "react";

type ErrorPageProps = {
  error: Error & { digest?: string };
  reset: () => void;
};

export default function ErrorPage({ error, reset }: ErrorPageProps) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="error-page">
      <div className="error-card">
        <span className="error-card__icon">
          <AlertTriangle aria-hidden="true" size={24} />
        </span>
        <p className="eyebrow">Unexpected workspace error</p>
        <h1>This page could not load.</h1>
        <p>
          Try the request again. If the problem continues, check the terminal for the
          underlying error and confirm that the configured data folder is accessible.
        </p>
        <button className="primary-button" onClick={reset} type="button">
          <span>Try again</span>
          <RotateCcw aria-hidden="true" size={17} />
        </button>
      </div>
    </main>
  );
}
