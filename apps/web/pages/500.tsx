export default function ServerErrorPage() {
  return (
    <main
      style={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        padding: 24,
        fontFamily:
          'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
        background: "#f8fafc",
        color: "#0f172a",
      }}
    >
      <section style={{ maxWidth: 500, textAlign: "center" }}>
        <p style={{ margin: 0, fontSize: 14, fontWeight: 700, color: "#be123c" }}>
          500
        </p>
        <h1 style={{ margin: "8px 0 12px", fontSize: 32, lineHeight: 1.1 }}>
          Something went wrong
        </h1>
        <p style={{ margin: 0, color: "#475569", lineHeight: 1.6 }}>
          NexaFlow hit an unexpected error while loading this page.
        </p>
      </section>
    </main>
  );
}
