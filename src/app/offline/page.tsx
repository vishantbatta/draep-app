"use client";

export default function OfflinePage() {
  return (
    <div
      style={{
        minHeight: "100dvh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: "1rem",
        backgroundColor: "#FDFBF7",
        color: "#083068",
        fontFamily: "system-ui, sans-serif",
        textAlign: "center",
        padding: "2rem",
      }}
    >
      <h1 style={{ fontSize: "1.75rem", fontWeight: 700, letterSpacing: -0.025 }}>
        You are offline
      </h1>
      <p style={{ fontSize: "1rem", maxWidth: "20rem", opacity: 0.7, lineHeight: 1.5 }}>
        draep needs a connection to design your blouse. Check your network and try
        again.
      </p>
      <button
        onClick={() => window.location.reload()}
        style={{
          marginTop: "0.5rem",
          padding: "0.75rem 2rem",
          backgroundColor: "#083068",
          color: "#FDFBF7",
          border: "none",
          borderRadius: "9999px",
          fontSize: "0.95rem",
          fontWeight: 600,
          cursor: "pointer",
        }}
      >
        Try again
      </button>
    </div>
  );
}
