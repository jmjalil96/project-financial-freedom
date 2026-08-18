import Link from "next/link";

export default function NotFoundPage() {
  return (
    <main className="error-page">
      <div className="error-card">
        <p className="eyebrow">Page not found</p>
        <h1>This page is not part of the monthly workspace.</h1>
        <p>Return to the dashboard to continue.</p>
        <Link className="primary-button" href="/dashboard">
          Back to dashboard
        </Link>
      </div>
    </main>
  );
}
