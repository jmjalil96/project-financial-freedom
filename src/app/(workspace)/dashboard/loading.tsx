export default function DashboardLoading() {
  return (
    <main className="decision-dashboard" aria-label="Loading monthly decision brief">
      <section className="dashboard-loading-hero">
        <span />
        <span />
        <span />
      </section>
      <section className="dashboard-loading-grid" aria-hidden="true">
        {Array.from({ length: 4 }, (_, index) => (
          <span key={index} />
        ))}
      </section>
    </main>
  );
}
