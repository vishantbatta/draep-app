"use client";

/**
 * useGeminiLiveCall — React hook for the live AI designer video call.
 *
 * Architecture (Option 2 — ADK Runner on the backend, no LiveKit):
 *   Browser (raw WS) ──► /api/v1/stylist/live-ws ──► ADK Runner.run_live ──► Gemini Live
 *
 * The backend (app/api/stylist_live.py + app/stylist_agent/) owns the Gemini
 * Live session: model config, system instruction, tools, and — crucially —
 * session resumption + reconnect. So this hook is now a thin transport layer:
 *   - Streams mic audio (16kHz PCM) + camera frames (1fps JPEG) to the backend.
 *   - Plays back model audio (24kHz PCM).
 *   - Renders transcript + design previews the backend forwards.
 *   - Reconnects the raw browser WS on network drop (the conversation survives
 *     because the backend session persists independently).
 */

import { useCallback, useEffect, useRef, useState } from "react";

export type CallStatus =
  | "idle"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "ended"
  | "error";

export interface CloseDetail {
  code: number;
  reason: string;
  wasClean: boolean;
  timestamp: number;
}

export interface TranscriptEntry {
  id: number;
  role: "user" | "model";
  text: string;
  timestamp: number;
}

export interface DesignImage {
  id: number;
  url: string;
  description: string;
  timestamp: number;
}

// ── Constants ───────────────────────────────────────────────────────────

// Video frame capture rate (1fps)
const FRAME_INTERVAL_MS = 1000;

// Audio input rate (Gemini expects 16kHz)
const AUDIO_INPUT_RATE = 16000;

// Audio output rate (Gemini outputs at 24kHz)
const AUDIO_OUTPUT_RATE = 24000;

// ── Hook ────────────────────────────────────────────────────────────────

let _transcriptId = 0;
let _designId = 0;

export function useGeminiLiveCall() {
  const [status, setStatus] = useState<CallStatus>("idle");
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const [designImages, setDesignImages] = useState<DesignImage[]>([]);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [closeDetail, setCloseDetail] = useState<CloseDetail | null>(null);
  const [muted, setMuted] = useState(false);

  // Refs
  const wsRef = useRef<WebSocket | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  // Audio playback (output) — separate context at 24kHz
  const outputAudioCtxRef = useRef<AudioContext | null>(null);
  const nextAudioTimeRef = useRef(0);
  // Active playback sources — tracked so we can STOP them immediately on
  // interruption (barge-in) or disconnect, otherwise already-scheduled buffers
  // keep playing and the designer can't be cut off.
  const activeSourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());

  // Audio capture (input) — separate context at 16kHz
  const inputAudioCtxRef = useRef<AudioContext | null>(null);
  const audioProcessorRef = useRef<ScriptProcessorNode | null>(null);
  const audioSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);

  const frameTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const mutedRef = useRef(false);
  const statusRef = useRef<CallStatus>("idle");
  const manualDisconnectRef = useRef(false);
  const reconnectAttemptsRef = useRef(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const MAX_RECONNECT_ATTEMPTS = 5;

  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  // ── Audio playback (model → speaker) at 24kHz ───────────────────────

  const playAudioChunk = useCallback((base64Data: string) => {
    try {
      const ctx = outputAudioCtxRef.current;
      if (!ctx) return;

      const binaryStr = atob(base64Data);
      const len = binaryStr.length;
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) {
        bytes[i] = binaryStr.charCodeAt(i);
      }

      // Backend sends raw PCM 16-bit LE at 24kHz
      const numBytes = len - (len % 2);
      const samples = numBytes / 2;
      if (samples === 0) return;

      const audioBuffer = ctx.createBuffer(1, samples, AUDIO_OUTPUT_RATE);
      const channelData = audioBuffer.getChannelData(0);

      const dv = new DataView(bytes.buffer);
      for (let i = 0; i < samples; i++) {
        channelData[i] = dv.getInt16(i * 2, true) / 32768;
      }

      const source = ctx.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(ctx.destination);

      // Track this source so interruption/disconnect can stop it.
      activeSourcesRef.current.add(source);
      source.onended = () => {
        activeSourcesRef.current.delete(source);
      };

      const startTime = Math.max(ctx.currentTime, nextAudioTimeRef.current);
      source.start(startTime);
      nextAudioTimeRef.current = startTime + audioBuffer.duration;
    } catch {
      // best-effort
    }
  }, []);

  // Stop all currently-playing/scheduled model audio immediately. Used on
  // interruption (barge-in) and disconnect so the designer can be cut off.
  const stopModelAudio = useCallback(() => {
    nextAudioTimeRef.current = 0;
    activeSourcesRef.current.forEach((s) => {
      try { s.stop(); } catch { /* already ended */ }
    });
    activeSourcesRef.current.clear();
  }, []);

  // ── Start microphone audio streaming ────────────────────────────────

  const startAudioStreaming = useCallback((stream: MediaStream) => {
    const ctx = inputAudioCtxRef.current;
    if (!ctx) return;

    const source = ctx.createMediaStreamSource(stream);
    audioSourceRef.current = source;

    // ScriptProcessorNode — deprecated but widely supported and simple
    const processor = ctx.createScriptProcessor(4096, 1, 1);
    audioProcessorRef.current = processor;

    processor.onaudioprocess = (e) => {
      if (mutedRef.current) return;

      const ws = wsRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) return;

      const input = e.inputBuffer.getChannelData(0);
      const downsampled = downsampleBuffer(input, ctx.sampleRate, AUDIO_INPUT_RATE);
      if (!downsampled) return;

      const pcm16 = float32ToPCM16(downsampled);
      const base64 = arrayBufferToBase64(pcm16.buffer);
      if (!base64) return;

      ws.send(
        JSON.stringify({
          realtime_input: {
            media_chunks: [{ mime_type: "audio/pcm", data: base64 }],
          },
        }),
      );
    };

    source.connect(processor);
    // Zero-gain node keeps the processor alive without playing mic through speakers.
    const silencer = ctx.createGain();
    silencer.gain.value = 0;
    processor.connect(silencer);
    silencer.connect(ctx.destination);
  }, []);

  const stopAudioStreaming = useCallback(() => {
    if (audioProcessorRef.current) {
      try { audioProcessorRef.current.disconnect(); } catch { /* ignore */ }
      audioProcessorRef.current.onaudioprocess = null;
      audioProcessorRef.current = null;
    }
    if (audioSourceRef.current) {
      try { audioSourceRef.current.disconnect(); } catch { /* ignore */ }
      audioSourceRef.current = null;
    }
  }, []);

  // ── Start video frame streaming ─────────────────────────────────────

  const startVideoStreaming = useCallback(() => {
    if (frameTimerRef.current) clearInterval(frameTimerRef.current);

    frameTimerRef.current = setInterval(() => {
      const video = videoRef.current;
      const ws = wsRef.current;
      if (!video || !ws || ws.readyState !== WebSocket.OPEN) return;
      if (!video.videoWidth) return;

      const canvas = document.createElement("canvas");
      const maxWidth = 640;
      const scale = Math.min(1, maxWidth / video.videoWidth);
      canvas.width = video.videoWidth * scale;
      canvas.height = video.videoHeight * scale;

      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

      const base64 = canvas.toDataURL("image/jpeg", 0.8).split(",")[1];
      if (!base64) return;

      ws.send(
        JSON.stringify({
          realtime_input: {
            media_chunks: [{ mime_type: "image/jpeg", data: base64 }],
          },
        }),
      );
    }, FRAME_INTERVAL_MS);
  }, []);

  const stopVideoStreaming = useCallback(() => {
    if (frameTimerRef.current) {
      clearInterval(frameTimerRef.current);
      frameTimerRef.current = null;
    }
  }, []);

  // ── Handle incoming WebSocket messages ──────────────────────────────

  const handleWsMessage = useCallback(
    (event: MessageEvent) => {
      if (typeof event.data !== "string") return;

      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(event.data);
      } catch {
        return;
      }

      // ── Design image (out-of-band from the image tool) ──
      const design = msg.designImage as { url: string; description: string } | undefined;
      if (design?.url) {
        setDesignImages((prev) => [
          ...prev,
          { id: ++_designId, url: design.url, description: design.description, timestamp: Date.now() },
        ]);
        return;
      }

      // ── Server content (audio + text + transcripts) ──
      const serverContent = msg.serverContent as
        | {
            modelTurn?: {
              parts?: Array<{
                text?: string;
                inlineData?: { mimeType: string; data: string };
              }>;
            };
            inputTranscription?: { text: string };
            outputTranscription?: { text: string };
            turnComplete?: boolean;
            interrupted?: boolean;
          }
        | undefined;

      if (serverContent) {
        const parts = serverContent.modelTurn?.parts;
        if (parts) {
          for (const part of parts) {
            if (part.text) {
              setTranscript((prev) => [
                ...prev,
                { id: ++_transcriptId, role: "model", text: part.text!, timestamp: Date.now() },
              ]);
            }
            if (part.inlineData?.data) {
              playAudioChunk(part.inlineData.data);
            }
          }
        }

        if (serverContent.outputTranscription?.text) {
          setTranscript((prev) => [
            ...prev,
            { id: ++_transcriptId, role: "model", text: serverContent.outputTranscription!.text, timestamp: Date.now() },
          ]);
        }

        if (serverContent.inputTranscription?.text) {
          setTranscript((prev) => [
            ...prev,
            { id: ++_transcriptId, role: "user", text: serverContent.inputTranscription!.text, timestamp: Date.now() },
          ]);
        }

        // Interruption (barge-in): stop all queued/playing model audio so the
        // designer can be cut off mid-sentence.
        if (serverContent.interrupted) {
          stopModelAudio();
        }
      }
    },
    [playAudioChunk, stopModelAudio],
  );

  // ── Connect (start the call) ────────────────────────────────────────

  const connect = useCallback(async () => {
    setStatus("connecting");
    setErrorMsg(null);
    setTranscript([]);
    setDesignImages([]);
    manualDisconnectRef.current = false;
    reconnectAttemptsRef.current = 0;
    setCloseDetail(null);

    try {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;

      // 1. Get user media (front camera + mic) — reuse on reconnect
      let stream = streamRef.current;
      if (!stream) {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } },
          audio: {
            channelCount: 1,
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
        });
        streamRef.current = stream;
      }

      // 2. Output audio context at 24kHz (reuse if open)
      if (!outputAudioCtxRef.current) {
        outputAudioCtxRef.current = new AudioCtx({ sampleRate: AUDIO_OUTPUT_RATE });
      }
      if (outputAudioCtxRef.current.state === "suspended") {
        await outputAudioCtxRef.current.resume();
      }
      nextAudioTimeRef.current = 0;

      // 3. Input audio context at 16kHz (reuse if open)
      if (!inputAudioCtxRef.current) {
        inputAudioCtxRef.current = new AudioCtx({ sampleRate: AUDIO_INPUT_RATE });
      }
      if (inputAudioCtxRef.current.state === "suspended") {
        await inputAudioCtxRef.current.resume();
      }

      // 4. Attach video (if not already attached)
      if (videoRef.current && videoRef.current.srcObject !== stream) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => {});
      }

      // 5. Open WebSocket to the ADK-backed backend endpoint.
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000/api/v1";
      const apiHost = apiUrl.replace(/^https?:\/\//, "").replace(/\/api\/v1$/, "");
      const apiProto = apiUrl.startsWith("https") ? "wss:" : "ws:";
      const wsUrl = `${apiProto}//${apiHost}/api/v1/stylist/live-ws`;
      const ws = new WebSocket(wsUrl);
      ws.binaryType = "arraybuffer";
      wsRef.current = ws;

      ws.onopen = () => {
        console.log("[GeminiLive] WebSocket opened");
        setStatus("connected");
        startVideoStreaming();
        if (streamRef.current) {
          startAudioStreaming(streamRef.current);
        }

        // Kick off the conversation with a greeting turn. The backend's ADK
        // Runner owns all model config; we just send the first user turn.
        ws.send(
          JSON.stringify({
            client_content: {
              turns: [{ role: "user", parts: [{ text: "Hi! I'm ready for my fashion consultation." }] }],
              turn_complete: true,
            },
          }),
        );
      };

      ws.onmessage = handleWsMessage;

      ws.onerror = (event) => {
        console.error("[GeminiLive] WebSocket error:", event);
      };

      ws.onclose = (event) => {
        console.warn(`[GeminiLive] WebSocket closed: code=${event.code}, reason="${event.reason}"`);
        stopModelAudio();
        stopVideoStreaming();
        stopAudioStreaming();

        const detail: CloseDetail = {
          code: event.code,
          reason: event.reason || "(no reason provided)",
          wasClean: event.wasClean,
          timestamp: Date.now(),
        };
        setCloseDetail(detail);

        // User ended the call — don't reconnect.
        if (manualDisconnectRef.current) {
          setStatus("ended");
          return;
        }

        // Network drop — the backend session persists, so transparently
        // reconnect the browser WS and resume (the backend replays/resumes).
        if (reconnectAttemptsRef.current < MAX_RECONNECT_ATTEMPTS) {
          reconnectAttemptsRef.current += 1;
          const attempt = reconnectAttemptsRef.current;
          console.log(`[GeminiLive] Reconnect attempt ${attempt}/${MAX_RECONNECT_ATTEMPTS}`);
          setStatus("reconnecting");
          const delay = Math.min(1000 * attempt, 3000);
          reconnectTimerRef.current = setTimeout(() => {
            void connect();
          }, delay);
          return;
        }

        // Exhausted — surface to the user.
        const reasonText = event.reason || getCloseCodeExplanation(event.code);
        setErrorMsg(`Call ended abruptly. Code ${event.code}: ${reasonText}`);
        setStatus("ended");
      };
    } catch (err) {
      console.error("[GeminiLive] Connect failed:", err);
      setErrorMsg(
        err instanceof Error
          ? err.message
          : "Could not start the call. Please check camera and microphone permissions.",
      );
      setStatus("error");
    }
  }, [handleWsMessage, startVideoStreaming, startAudioStreaming, stopVideoStreaming, stopAudioStreaming, stopModelAudio]);

  // ── Disconnect ──────────────────────────────────────────────────────

  const disconnect = useCallback(() => {
    manualDisconnectRef.current = true;
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    reconnectAttemptsRef.current = 0;

    stopModelAudio();
    stopVideoStreaming();
    stopAudioStreaming();

    if (wsRef.current) {
      try { wsRef.current.close(1000, "user ended call"); } catch { /* ignore */ }
      wsRef.current = null;
    }

    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }

    if (outputAudioCtxRef.current) {
      outputAudioCtxRef.current.close().catch(() => {});
      outputAudioCtxRef.current = null;
    }

    if (inputAudioCtxRef.current) {
      inputAudioCtxRef.current.close().catch(() => {});
      inputAudioCtxRef.current = null;
    }

    setStatus("ended");
  }, [stopVideoStreaming, stopAudioStreaming, stopModelAudio]);

  // ── Toggle mute ─────────────────────────────────────────────────────

  const toggleMute = useCallback(() => {
    setMuted((prev) => {
      const next = !prev;
      mutedRef.current = next;
      if (streamRef.current) {
        streamRef.current.getAudioTracks().forEach((t) => { t.enabled = !next; });
      }
      return next;
    });
  }, []);

  // ── Cleanup on unmount ──────────────────────────────────────────────

  useEffect(() => {
    return () => {
      manualDisconnectRef.current = true;
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      stopModelAudio();
      stopVideoStreaming();
      stopAudioStreaming();
      if (wsRef.current) {
        try { wsRef.current.close(1000, "component unmounted"); } catch { /* ignore */ }
        wsRef.current = null;
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
      if (outputAudioCtxRef.current) {
        outputAudioCtxRef.current.close().catch(() => {});
        outputAudioCtxRef.current = null;
      }
      if (inputAudioCtxRef.current) {
        inputAudioCtxRef.current.close().catch(() => {});
        inputAudioCtxRef.current = null;
      }
    };
  }, [stopVideoStreaming, stopAudioStreaming, stopModelAudio]);

  return {
    status,
    transcript,
    designImages,
    errorMsg,
    closeDetail,
    muted,
    videoRef,
    canvasRef,
    connect,
    disconnect,
    toggleMute,
  };
}

// ── Audio helpers ───────────────────────────────────────────────────────

function downsampleBuffer(buffer: Float32Array, fromRate: number, toRate: number): Float32Array | null {
  if (toRate === fromRate) return buffer;
  const ratio = fromRate / toRate;
  const newLength = Math.round(buffer.length / ratio);
  const result = new Float32Array(newLength);
  let offsetResult = 0;
  let offsetBuffer = 0;
  while (offsetResult < result.length) {
    const nextOffsetBuffer = Math.round((offsetResult + 1) * ratio);
    let accum = 0;
    let count = 0;
    for (let i = offsetBuffer; i < nextOffsetBuffer && i < buffer.length; i++) {
      accum += buffer[i];
      count++;
    }
    result[offsetResult] = count > 0 ? accum / count : 0;
    offsetResult++;
    offsetBuffer = nextOffsetBuffer;
  }
  return result;
}

function float32ToPCM16(float32: Float32Array): Int16Array {
  const pcm16 = new Int16Array(float32.length);
  for (let i = 0; i < float32.length; i++) {
    const s = Math.max(-1, Math.min(1, float32[i]));
    pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return pcm16;
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  const parts: string[] = [];
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    parts.push(String.fromCharCode.apply(null, Array.from(chunk)));
  }
  return btoa(parts.join(""));
}

function getCloseCodeExplanation(code: number): string {
  switch (code) {
    case 1000:
      return "Normal closure";
    case 1001:
      return "Endpoint going away";
    case 1006:
      return "Abnormal closure — connection lost (network issue)";
    case 1011:
      return "Internal server error";
    default:
      return "Unknown WebSocket close code";
  }
}
