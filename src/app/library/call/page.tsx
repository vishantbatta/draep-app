"use client";

/**
 * /library/call — "Call a fashion designer" page.
 *
 * A full-screen video call with our AI fashion designer (Gemini Live API).
 * The designer sees the user through the camera, converses naturally,
 * suggests blouse designs, and generates visual previews in real time.
 *
 * The Gemini API key is kept server-side — the browser connects to our
 * own backend WebSocket proxy at /api/v1/stylist/live-ws, which forwards
 * to Vertex AI with the key injected in headers.
 */

import { useRouter } from "next/navigation";

import { DesignerCall } from "@/components/stylist/DesignerCall";
import { useGeminiLiveCall } from "@/hooks/useGeminiLiveCall";

export default function DesignerCallPage() {
  const router = useRouter();

  const {
    status,
    transcript,
    designImages,
    errorMsg,
    muted,
    videoRef,
    canvasRef,
    connect,
    disconnect,
    toggleMute,
  } = useGeminiLiveCall();

  const handleBack = () => {
    disconnect();
    router.push("/library");
  };

  return (
    <DesignerCall
      status={status}
      transcript={transcript}
      designImages={designImages}
      errorMsg={errorMsg}
      muted={muted}
      videoRef={videoRef}
      canvasRef={canvasRef}
      onConnect={connect}
      onDisconnect={handleBack}
      onToggleMute={toggleMute}
      onBack={handleBack}
    />
  );
}
