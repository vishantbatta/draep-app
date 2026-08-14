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
    designImages,
    designPendingCount,
    designError,
    errorMsg,
    closeDetail,
    muted,
    videoOn,
    callStartedAt,
    videoRef,
    canvasRef,
    connect,
    disconnect,
    toggleMute,
    toggleVideo,
    getSpeakingAmplitude,
  } = useGeminiLiveCall();

  const handleBack = () => {
    disconnect();
    router.push("/library");
  };

  return (
    <DesignerCall
      status={status}
      designImages={designImages}
      designPendingCount={designPendingCount}
      designError={designError}
      errorMsg={errorMsg}
      closeDetail={closeDetail}
      muted={muted}
      videoOn={videoOn}
      callStartedAt={callStartedAt}
      videoRef={videoRef}
      canvasRef={canvasRef}
      onConnect={connect}
      onDisconnect={handleBack}
      onToggleMute={toggleMute}
      onToggleVideo={toggleVideo}
      onBack={handleBack}
      getSpeakingAmplitude={getSpeakingAmplitude}
    />
  );
}
