"use client";

import { useEffect } from "react";

const WHATSAPP_PHONE = "918147497006";
const WHATSAPP_TEXT = "Hi, I want to join as a partner tailor with Draep.";

export default function TailorWhatsAppRedirect() {
  useEffect(() => {
    // Assemble the URL in the browser so it is not present in the raw HTML
    // response. This prevents crawlers, `curl`, and meta-tag parsers from
    // resolving the destination without executing JavaScript.
    const url =
      "https://api.whatsapp.com/send" +
      "?phone=" + encodeURIComponent(WHATSAPP_PHONE) +
      "&text=" + encodeURIComponent(WHATSAPP_TEXT);

    window.location.replace(url);
  }, []);

  return (
    <main
      style={{
        display: "flex",
        minHeight: "100vh",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: "system-ui, sans-serif",
        color: "#444",
      }}
    >
      <p>Redirecting to WhatsApp…</p>
    </main>
  );
}
