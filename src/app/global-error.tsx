"use client";

type GlobalErrorProps = {
  reset: () => void;
};

export default function GlobalError({ reset }: GlobalErrorProps) {
  return (
    <html lang="en">
      <body>
        <main
          style={{
            display: "grid",
            minHeight: "100vh",
            placeItems: "center",
            padding: "24px",
            fontFamily: '"Avenir Next", "Helvetica Neue", sans-serif',
          }}
        >
          <section style={{ maxWidth: "520px" }}>
            <p
              style={{
                color: "#176b52",
                fontSize: "12px",
                fontWeight: 700,
                letterSpacing: "0.12em",
                textTransform: "uppercase",
              }}
            >
              Application error
            </p>
            <h1 style={{ color: "#17221c", fontSize: "40px", lineHeight: 1.05 }}>
              The workspace needs a fresh start.
            </h1>
            <p style={{ color: "#5e6d65", lineHeight: 1.6 }}>
              Reload the application. Your database remains on disk.
            </p>
            <button
              onClick={reset}
              style={{
                background: "#176b52",
                border: 0,
                borderRadius: "8px",
                color: "white",
                cursor: "pointer",
                font: "inherit",
                fontWeight: 700,
                marginTop: "16px",
                padding: "12px 18px",
              }}
              type="button"
            >
              Reload workspace
            </button>
          </section>
        </main>
      </body>
    </html>
  );
}
