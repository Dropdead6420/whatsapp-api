type ErrorPageProps = {
  statusCode?: number;
};

export default function ErrorPage({ statusCode = 500 }: ErrorPageProps) {
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
        <p style={{ margin: 0, fontSize: 14, fontWeight: 700, color: "#334155" }}>
          {statusCode}
        </p>
        <h1 style={{ margin: "8px 0 12px", fontSize: 32, lineHeight: 1.1 }}>
          NexaFlow could not load this page
        </h1>
        <p style={{ margin: 0, color: "#475569", lineHeight: 1.6 }}>
          Please return to the dashboard and try the action again.
        </p>
      </section>
    </main>
  );
}

ErrorPage.getInitialProps = ({ res, err }: { res?: { statusCode?: number }; err?: { statusCode?: number } }) => {
  const statusCode = res?.statusCode ?? err?.statusCode ?? 500;
  return { statusCode };
};
