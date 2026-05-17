export default function NotFoundPage() {
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
      <section style={{ maxWidth: 480, textAlign: "center" }}>
        <p style={{ margin: 0, fontSize: 14, fontWeight: 700, color: "#0f766e" }}>
          404
        </p>
        <h1 style={{ margin: "8px 0 12px", fontSize: 32, lineHeight: 1.1 }}>
          Page not found
        </h1>
        <p style={{ margin: 0, color: "#475569", lineHeight: 1.6 }}>
          The NexaFlow page you opened does not exist yet.
        </p>
      </section>
    </main>
  );
}
