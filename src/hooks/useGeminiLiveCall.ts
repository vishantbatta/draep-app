"use client";

/**
 * useGeminiLiveCall — React hook for the live AI designer video call.
 *
 * Architecture (Option 2 — ADK Runner on the backend, no LiveKit):
 *   Browser (raw WS) ──► /api/v1/stylist/live-ws ──► ADK Runner.run_live ──► Gemini Live
 *
 * The backend (app/api/stylist_live.py + app/stylist_agent/) owns the Gemini
 * Live session: model config, system instruction, tools, and — crucially —
 * session resumption + reconnect. This hook is a thin transport layer:
 *   - Streams mic audio (16kHz PCM) + camera frames (1fps JPEG) to the backend.
 *   - Plays back model audio (24kHz PCM).
 *   - Renders design previews the backend forwards.
 *   - Reconnects the raw browser WS on network drop, reusing the SAME session
 *     id (?session=<uuid>) so the backend reattaches the surviving conversation
 *     instead of starting a fresh one.
 *   - Heartbeats (ping/pong) so dead connections are detected within ~30s
 *     instead of waiting for TCP to give up.
 */

import { useCallback, useEffect, useRef, useState } from "react";

export type CallStatus =
  | "idle"
  | "connecting"
  | "ringing"
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

// Heartbeat: ping the backend every 10s; if NOTHING arrives (not even a
// pong) for 30s, the socket is dead — force-close so the reconnect path runs.
const HEARTBEAT_INTERVAL_MS = 10000;
const HEARTBEAT_STALE_MS = 30000;
const HEARTBEAT_WATCH_TICK_MS = 5000;

// The backend mirrors this with its own idle watchdog (it expects at least a
// ping every ~45s — audio/video stop entirely while muted + camera off).

// getUserMedia can hang forever (permission prompt that never surfaces on
// some Android WebViews). Give up after this long with an actionable error.
const MEDIA_TIMEOUT_MS = 20000;

// AudioContext.resume() can also pend forever in a suspended/backgrounded
// webview. We can't force audio on, but we can refuse to let it wedge the
// call on "Calling…" — proceed after this long and let audio start whenever
// the context finally runs.
const AUDIO_RESUME_TIMEOUT_MS = 5000;

const MAX_RECONNECT_ATTEMPTS = 5;

// Ringing → connected fallback (see markConnected).
const RINGING_FALLBACK_MS = 8000;

// Prime sent on WS open so the model greets first. On reconnect we send a
// resume nudge instead of a fresh "Hi!" — the conversation already happened.
const FRESH_PRIME = "Hi!";
const RECONNECT_PRIME =
  "(The customer just reconnected after a brief network drop — welcome them back and pick up exactly where you left off.)";

// ── Hook ────────────────────────────────────────────────────────────────

export function useGeminiLiveCall() {
  const [status, setStatus] = useState<CallStatus>("idle");
  const [designImages, setDesignImages] = useState<DesignImage[]>([]);
  const [designError, setDesignError] = useState<string | null>(null);
  // Number of designs the backend is currently rendering. Drives the
  // "Sketching your design…" card + ambient sketch sound.
  const [designPendingCount, setDesignPendingCount] = useState(0);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [closeDetail, setCloseDetail] = useState<CloseDetail | null>(null);
  const [muted, setMuted] = useState(false);
  const [videoOn, setVideoOn] = useState(true);
  // Absolute time the call first went live — survives reconnects so the
  // header timer shows TOTAL call duration, not per-connection duration.
  const [callStartedAt, setCallStartedAt] = useState<number | null>(null);

  // Refs
  const wsRef = useRef<WebSocket | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  // Per-instance ID counter (NOT module-level — that shared state across
  // hook instances and caused key collisions).
  const designIdRef = useRef(0);

  // Session identity — minted on a fresh (user-initiated) call, reused across
  // reconnects so the backend can resume the same conversation.
  const sessionIdRef = useRef<string>(newSessionId());

  // Audio playback (output) — separate context at 24kHz
  const outputAudioCtxRef = useRef<AudioContext | null>(null);
  const nextAudioTimeRef = useRef(0);
  // Active playback sources — tracked so we can STOP them immediately on
  // interruption (barge-in) or disconnect, otherwise already-scheduled buffers
  // keep playing and the designer can't be cut off.
  const activeSourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  // Analyser tapping the output bus so the UI can show real speaking amplitude.
  const analyserRef = useRef<AnalyserNode | null>(null);

  // Audio capture (input) — separate context at 16kHz
  const inputAudioCtxRef = useRef<AudioContext | null>(null);
  const audioWorkletRef = useRef<AudioWorkletNode | null>(null);
  const audioSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);

  const frameTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const mutedRef = useRef(false);
  const videoOnRef = useRef(true);
  const statusRef = useRef<CallStatus>("idle");
  const manualDisconnectRef = useRef(false);
  const reconnectAttemptsRef = useRef(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Heartbeat timers + last time we heard ANYTHING from the server.
  const heartbeatTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const watchdogTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastServerActivityRef = useRef(0);

  // Ringing phase: between WS-open and the first model audio chunk, we play a
  // gentle two-tone ringback so the call feels alive. Stopped the instant the
  // designer speaks.
  const ringToneRef = useRef<{ stop: () => void } | null>(null);
  const hasHeardAgentRef = useRef(false);
  // Fallback: if the model emits no audio at all (e.g. text-only greeting, or
  // the Live API stalls before the first inlineData), don't ring forever —
  // promote to "connected" after this deadline so the UI is usable.
  const ringingFallbackRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Ambient pencil-scratch loop played while a design is being rendered.
  const sketchSoundRef = useRef<{ stop: () => void } | null>(null);

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

      // Route through an analyser so the UI can show real speaking amplitude,
      // then to the destination.
      if (!analyserRef.current || analyserRef.current.context !== ctx) {
        analyserRef.current = ctx.createAnalyser();
        analyserRef.current.fftSize = 64;
      }
      source.connect(analyserRef.current);
      analyserRef.current.connect(ctx.destination);

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

  /** Read the current model-output amplitude (0..1) for UI visualization. */
  const getSpeakingAmplitude = useCallback(() => {
    const analyser = analyserRef.current;
    if (!analyser) return 0;
    const buf = new Uint8Array(analyser.frequencyBinCount);
    analyser.getByteTimeDomainData(buf);
    // RMS-ish deviation from 128 (silence centre), normalized.
    let sum = 0;
    for (let i = 0; i < buf.length; i++) {
      const v = (buf[i] - 128) / 128;
      sum += v * v;
    }
    const rms = Math.sqrt(sum / buf.length);
    return Math.min(1, rms * 3.5); // gain so normal speech reads ~0.4–0.9
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

  // ── Ambient "sketching" sound (designs being rendered) ───────────────
  //
  // Synthesized pencil-scratch: looped white noise through a bandpass, gated
  // into short randomized strokes. No asset file needed; kept very quiet so
  // it never fights the designer's voice.

  const startSketchSound = useCallback(() => {
    const ctx = outputAudioCtxRef.current;
    if (!ctx || sketchSoundRef.current) return;

    const noiseBuf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.25), ctx.sampleRate);
    const ch = noiseBuf.getChannelData(0);
    for (let i = 0; i < ch.length; i++) ch[i] = Math.random() * 2 - 1;

    const noise = ctx.createBufferSource();
    noise.buffer = noiseBuf;
    noise.loop = true;

    const bandpass = ctx.createBiquadFilter();
    bandpass.type = "bandpass";
    bandpass.frequency.value = 2100;
    bandpass.Q.value = 0.9;

    const gain = ctx.createGain();
    gain.gain.value = 0;

    noise.connect(bandpass);
    bandpass.connect(gain);
    gain.connect(ctx.destination);
    noise.start();

    const stroke = () => {
      const t = ctx.currentTime;
      const dur = 0.05 + Math.random() * 0.09;
      const vol = 0.025 + Math.random() * 0.03;
      gain.gain.cancelScheduledValues(t);
      gain.gain.setValueAtTime(Math.max(gain.gain.value, 0.0001), t);
      gain.gain.linearRampToValueAtTime(vol, t + 0.015);
      gain.gain.linearRampToValueAtTime(0.0001, t + dur);
    };
    stroke();
    // Slight irregularity (skipped strokes) so it reads as hand-drawn.
    const intervalId = setInterval(() => {
      if (Math.random() < 0.85) stroke();
    }, 170);

    sketchSoundRef.current = {
      stop: () => {
        clearInterval(intervalId);
        try {
          gain.gain.cancelScheduledValues(ctx.currentTime);
          gain.gain.value = 0;
          noise.stop();
        } catch { /* context already closed */ }
      },
    };
  }, []);

  const stopSketchSound = useCallback(() => {
    if (sketchSoundRef.current) {
      sketchSoundRef.current.stop();
      sketchSoundRef.current = null;
    }
  }, []);

  // Sketch sound follows the pending count (design arriving clears it).
  useEffect(() => {
    if (designPendingCount > 0) startSketchSound();
    else stopSketchSound();
  }, [designPendingCount, startSketchSound, stopSketchSound]);

  // ── Start microphone audio streaming (AudioWorklet) ─────────────────
  //
  // Uses an AudioWorkletNode (audio-recorder.js in /public/worklets) instead of
  // the deprecated ScriptProcessorNode. The worklet runs on a dedicated audio
  // thread — no main-thread onaudioprocess callback — so mic capture can't
  // jank the call UI.

  const startAudioStreaming = useCallback(async (stream: MediaStream) => {
    const ctx = inputAudioCtxRef.current;
    if (!ctx) return;

    try {
      await ctx.audioWorklet.addModule("/worklets/audio-recorder.js");
    } catch {
      // addModule throws if the module is already loaded — fine, continue.
    }

    const source = ctx.createMediaStreamSource(stream);
    audioSourceRef.current = source;

    const worklet = new AudioWorkletNode(ctx, "audio-recorder", {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      channelCount: 1,
      processorOptions: { targetRate: AUDIO_INPUT_RATE },
    });
    audioWorkletRef.current = worklet;

    worklet.port.onmessage = (e: MessageEvent) => {
      if (mutedRef.current) return;
      const ws = wsRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) return;

      const base64 = arrayBufferToBase64(e.data as ArrayBuffer);
      if (!base64) return;

      ws.send(
        JSON.stringify({
          realtime_input: {
            media_chunks: [{ mime_type: "audio/pcm", data: base64 }],
          },
        }),
      );
    };

    source.connect(worklet);
    // Worklet needs an output connection to keep processing; silence it so the
    // mic isn't played back through the speakers.
    const silencer = ctx.createGain();
    silencer.gain.value = 0;
    worklet.connect(silencer);
    silencer.connect(ctx.destination);
  }, []);

  const stopAudioStreaming = useCallback(() => {
    if (audioWorkletRef.current) {
      try { audioWorkletRef.current.disconnect(); } catch { /* ignore */ }
      audioWorkletRef.current.port.close?.();
      audioWorkletRef.current = null;
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
      // Camera disabled — send nothing (the track is frozen anyway).
      if (!videoOnRef.current) return;

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

  // ── Heartbeat (dead-connection detection) ───────────────────────────

  const stopHeartbeat = useCallback(() => {
    if (heartbeatTimerRef.current) {
      clearInterval(heartbeatTimerRef.current);
      heartbeatTimerRef.current = null;
    }
    if (watchdogTimerRef.current) {
      clearInterval(watchdogTimerRef.current);
      watchdogTimerRef.current = null;
    }
  }, []);

  const startHeartbeat = useCallback((ws: WebSocket) => {
    stopHeartbeat();
    lastServerActivityRef.current = Date.now();

    heartbeatTimerRef.current = setInterval(() => {
      if (ws.readyState !== WebSocket.OPEN) return;
      try {
        ws.send(JSON.stringify({ type: "ping" }));
      } catch { /* closing — onclose handles it */ }
    }, HEARTBEAT_INTERVAL_MS);

    watchdogTimerRef.current = setInterval(() => {
      if (Date.now() - lastServerActivityRef.current > HEARTBEAT_STALE_MS) {
        console.warn("[GeminiLive] No server activity for >%dms — closing dead socket", HEARTBEAT_STALE_MS);
        try { ws.close(4000, "heartbeat timeout"); } catch { /* already closed */ }
      }
    }, HEARTBEAT_WATCH_TICK_MS);
  }, []);

  // ── Ringing → Connected transition ───────────────────────────────────
  //
  // The call is "connected" once the model has produced ANY output — audio,
  // a transcript line, or a completed turn. A timeout backstops the case
  // where the model is slow to speak at all. Also promotes from
  // "reconnecting" so a resumed call snaps back to live on first output.
  const markConnected = useCallback(() => {
    if (hasHeardAgentRef.current) return;
    hasHeardAgentRef.current = true;
    if (ringingFallbackRef.current) {
      clearTimeout(ringingFallbackRef.current);
      ringingFallbackRef.current = null;
    }
    if (ringToneRef.current) {
      ringToneRef.current.stop();
      ringToneRef.current = null;
    }
    setCallStartedAt((prev) => prev ?? Date.now());
    if (statusRef.current === "ringing" || statusRef.current === "reconnecting") {
      setStatus("connected");
    }
  }, []);

  // ── Handle incoming WebSocket messages ──────────────────────────────

  const handleWsMessage = useCallback(
    (event: MessageEvent) => {
      if (typeof event.data !== "string") return;
      lastServerActivityRef.current = Date.now();

      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(event.data);
      } catch {
        return;
      }

      // ── Design generation started (out-of-band from the image tool) ──
      // Shows the "Sketching…" card + starts the ambient sketch sound.
      const pending = msg.designPending as { description?: string } | undefined;
      if (pending) {
        setDesignPendingCount((c) => c + 1);
        return;
      }

      // ── Design image (out-of-band from the image tool) ──
      const design = msg.designImage as { url: string; description: string } | undefined;
      if (design?.url) {
        setDesignError(null);
        setDesignPendingCount((c) => Math.max(0, c - 1));
        designIdRef.current += 1;
        setDesignImages((prev) => [
          ...prev,
          { id: designIdRef.current, url: design.url, description: design.description, timestamp: Date.now() },
        ]);
        return;
      }

      // ── Design generation failure (out-of-band from the image tool) ──
      // Surfaces background image-gen errors so the user isn't left waiting.
      const designErr = msg.designError as { message?: string } | undefined;
      if (designErr?.message) {
        setDesignPendingCount(0);
        setDesignError(designErr.message);
        return;
      }

      // ── Server content (audio + text) ──
      const serverContent = msg.serverContent as
        | {
            modelTurn?: {
              parts?: Array<{
                text?: string;
                inlineData?: { mimeType: string; data: string };
              }>;
            };
            outputTranscription?: { text: string };
            turnComplete?: boolean;
            interrupted?: boolean;
          }
        | undefined;

      if (serverContent) {
        const parts = serverContent.modelTurn?.parts;
        if (parts) {
          for (const part of parts) {
            if (part.inlineData?.data) {
              // First audio from the agent ⇒ the call is truly live.
              markConnected();
              playAudioChunk(part.inlineData.data);
            } else if (part.text) {
              markConnected();
            }
          }
        }

        if (serverContent.outputTranscription?.text) {
          markConnected();
        }

        // A completed model turn with no prior activity ⇒ still counts as
        // connected (covers the text-only-greeting edge case).
        if (serverContent.turnComplete) {
          markConnected();
        }

        // Interruption (barge-in): stop all queued/playing model audio so the
        // designer can be cut off mid-sentence.
        if (serverContent.interrupted) {
          stopModelAudio();
        }
      }
    },
    [playAudioChunk, stopModelAudio, markConnected],
  );

  // ── Ringback tone ───────────────────────────────────────────────────

  /**
   * A soft, two-pulse ringback synthesized with the output AudioContext — no
   * asset file needed. Played while the call is "ringing" and stopped the
   * moment the agent's first audio arrives (or on disconnect/error).
   */
  const startRingbackTone = useCallback(() => {
    const ctx = outputAudioCtxRef.current;
    if (!ctx) return;

    // Don't stack tones.
    if (ringToneRef.current) ringToneRef.current.stop();

    // Western ringback cadence: 2s on (two 0.45s pulses w/ 0.2s gap), 4s off.
    const PULSE = 0.45;
    const GAP = 0.2;
    const ON_CYCLE = PULSE * 2 + GAP; // 1.1s
    const FULL_CYCLE = ON_CYCLE + 4.0; // ~5.1s, then repeats

    const playPulse = (startAt: number) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      // 440Hz + 480Hz are the classic ringback pair; we layer both for warmth.
      osc.frequency.value = 440;
      const osc2 = ctx.createOscillator();
      osc2.type = "sine";
      osc2.frequency.value = 480;

      // Gentle envelope — much quieter than a real phone.
      const vol = 0.06;
      gain.gain.setValueAtTime(0.0001, startAt);
      gain.gain.exponentialRampToValueAtTime(vol, startAt + 0.04);
      gain.gain.setValueAtTime(vol, startAt + PULSE - 0.04);
      gain.gain.exponentialRampToValueAtTime(0.0001, startAt + PULSE);

      osc.connect(gain);
      osc2.connect(gain);
      gain.connect(ctx.destination);
      osc.start(startAt);
      osc2.start(startAt);
      osc.stop(startAt + PULSE + 0.02);
      osc2.stop(startAt + PULSE + 0.02);
    };

    let cycleStart = ctx.currentTime + 0.05;
    playPulse(cycleStart);
    playPulse(cycleStart + PULSE + GAP);

    const intervalId = setInterval(() => {
      const c = outputAudioCtxRef.current;
      if (!c || ringToneRef.current === null) return;
      cycleStart = c.currentTime + 0.05;
      playPulse(cycleStart);
      playPulse(cycleStart + PULSE + GAP);
    }, FULL_CYCLE * 1000);

    ringToneRef.current = {
      stop: () => {
        clearInterval(intervalId);
      },
    };
  }, []);

  const stopRingbackTone = useCallback(() => {
    if (ringToneRef.current) {
      ringToneRef.current.stop();
      ringToneRef.current = null;
    }
  }, []);

  // ── Connect (start the call) ────────────────────────────────────────
  //
  // `isRetry` marks automatic reconnects: the session id, generated designs
  // and the call timer are preserved so a network blip doesn't masquerade as
  // a brand-new call, and the reconnect attempt counter is NOT reset (that
  // reset inside connect() is what previously made the 5-attempt cap
  // unreachable — an infinite reconnect loop).

  const connect = useCallback(async (opts?: { isRetry?: boolean }) => {
    const isRetry = opts?.isRetry === true;

    setStatus("connecting");
    setErrorMsg(null);

    if (!isRetry) {
      // Fresh, user-initiated call: reset everything.
      setDesignImages([]);
      setDesignError(null);
      setDesignPendingCount(0);
      manualDisconnectRef.current = false;
      reconnectAttemptsRef.current = 0;
      hasHeardAgentRef.current = false;
      setCloseDetail(null);
      setCallStartedAt(null);
      sessionIdRef.current = newSessionId();
    }

    try {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;

      // 1. Get user media (front camera + mic) — reuse on reconnect.
      let stream = streamRef.current;
      if (!stream) {
        stream = await getUserMediaWithTimeout(MEDIA_TIMEOUT_MS);

        // The user hit End/back while the permission prompt was up.
        if (manualDisconnectRef.current) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }

        streamRef.current = stream;
        // Apply the current toggle state — the user may have flipped mute or
        // camera while the prompt was up, before tracks existed.
        stream.getAudioTracks().forEach((t) => { t.enabled = !mutedRef.current; });
        stream.getVideoTracks().forEach((t) => { t.enabled = videoOnRef.current; });
      }

      // 2. Output audio context at 24kHz (reuse if open)
      if (!outputAudioCtxRef.current) {
        outputAudioCtxRef.current = new AudioCtx({ sampleRate: AUDIO_OUTPUT_RATE });
      }
      if (outputAudioCtxRef.current.state === "suspended") {
        await raceWithTimeout(outputAudioCtxRef.current.resume(), AUDIO_RESUME_TIMEOUT_MS);
      }
      nextAudioTimeRef.current = 0;

      // 3. Input audio context at 16kHz (reuse if open)
      if (!inputAudioCtxRef.current) {
        inputAudioCtxRef.current = new AudioCtx({ sampleRate: AUDIO_INPUT_RATE });
      }
      if (inputAudioCtxRef.current.state === "suspended") {
        await raceWithTimeout(inputAudioCtxRef.current.resume(), AUDIO_RESUME_TIMEOUT_MS);
      }

      // 4. Attach video (if not already attached)
      if (videoRef.current && videoRef.current.srcObject !== stream) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => {});
      }

      // 5. Open WebSocket to the ADK-backed backend endpoint, carrying the
      // session id so reconnects resume the same conversation server-side.
      const wsUrl = `${resolveWsUrl()}?session=${encodeURIComponent(sessionIdRef.current)}`;
      const ws = new WebSocket(wsUrl);
      ws.binaryType = "arraybuffer";

      // Retire any previous socket BEFORE wiring this one, and make every
      // handler ignore events from anything but the current socket (stale
      // sockets firing late onclose/onerror previously raced the new one).
      const old = wsRef.current;
      wsRef.current = ws;
      if (old && old !== ws) {
        try { old.close(); } catch { /* already closed */ }
      }

      ws.onopen = () => {
        if (wsRef.current !== ws) return;
        console.log("[GeminiLive] WebSocket opened");
        if (isRetry) {
          // Stay in "reconnecting" until the model responds — the
          // "Connection dipped" banner keeps showing, no ringtone replays.
          setStatus("reconnecting");
        } else {
          setStatus("ringing");
          startRingbackTone();
        }
        startHeartbeat(ws);
        // Backstop: if the model produces nothing within RINGING_FALLBACK_MS
        // (no audio, no transcript, no turn), promote to "connected" anyway so
        // the UI never rings forever.
        if (ringingFallbackRef.current) clearTimeout(ringingFallbackRef.current);
        ringingFallbackRef.current = setTimeout(() => {
          console.warn(
            `[GeminiLive] No model output after ${RINGING_FALLBACK_MS}ms — promoting ringing→connected (fallback).`,
          );
          markConnected();
        }, RINGING_FALLBACK_MS);
        startVideoStreaming();
        if (streamRef.current) {
          // Fire-and-forget: the worklet loads its module + starts streaming.
          void startAudioStreaming(streamRef.current);
        }

        // Prime the Live session so the designer greets first. The Live API
        // otherwise waits for the first user input before producing its opening
        // turn — which meant the caller had to speak first ("hello? …hello?").
        // On reconnect, nudge the model to welcome the customer back instead.
        try {
          ws.send(
            JSON.stringify({
              client_content: {
                turns: [
                  {
                    role: "user",
                    parts: [{ text: isRetry ? RECONNECT_PRIME : FRESH_PRIME }],
                  },
                ],
              },
            }),
          );
        } catch {
          // best-effort — if this send fails the ringing fallback still fires.
        }
      };

      ws.onmessage = handleWsMessage;

      ws.onerror = (event) => {
        if (wsRef.current !== ws) return;
        console.error("[GeminiLive] WebSocket error:", event);
      };

      ws.onclose = (event) => {
        if (wsRef.current !== ws) return; // stale socket — a newer one owns the call
        console.warn(`[GeminiLive] WebSocket closed: code=${event.code}, reason="${event.reason}"`);
        stopHeartbeat();
        stopRingbackTone();
        stopModelAudio();
        stopVideoStreaming();
        stopAudioStreaming();
        stopSketchSound();

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

        // Network drop — reuse the session id so the backend resumes the
        // conversation; generated designs and the call timer survive.
        if (reconnectAttemptsRef.current < MAX_RECONNECT_ATTEMPTS) {
          reconnectAttemptsRef.current += 1;
          const attempt = reconnectAttemptsRef.current;
          console.log(`[GeminiLive] Reconnect attempt ${attempt}/${MAX_RECONNECT_ATTEMPTS}`);
          setStatus("reconnecting");
          const delay = Math.min(1000 * attempt, 3000);
          reconnectTimerRef.current = setTimeout(() => {
            void connect({ isRetry: true });
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
      setErrorMsg(explainMediaError(err));
      setStatus("error");
    }
  }, [handleWsMessage, startVideoStreaming, startAudioStreaming, stopVideoStreaming, stopAudioStreaming, stopModelAudio, startRingbackTone, stopRingbackTone, startHeartbeat, stopHeartbeat, stopSketchSound]);

  // ── Disconnect ──────────────────────────────────────────────────────

  const disconnect = useCallback(() => {
    manualDisconnectRef.current = true;
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    reconnectAttemptsRef.current = 0;

    if (ringingFallbackRef.current) {
      clearTimeout(ringingFallbackRef.current);
      ringingFallbackRef.current = null;
    }

    stopHeartbeat();
    stopRingbackTone();
    stopSketchSound();
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
      analyserRef.current = null;
    }

    if (inputAudioCtxRef.current) {
      inputAudioCtxRef.current.close().catch(() => {});
      inputAudioCtxRef.current = null;
    }

    setStatus("ended");
  }, [stopVideoStreaming, stopAudioStreaming, stopModelAudio, stopRingbackTone, stopHeartbeat, stopSketchSound]);

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

  // ── Toggle camera (stop/start video input) ──────────────────────────
  //
  // Disables the video track (camera light turns off, no frames sent) rather
  // than tearing it down — so re-enabling is instant and we keep the same
  // MediaStream for the rest of the call. When off, no video chunks reach the
  // backend, so the designer stops seeing the user until they re-enable.
  // Frame streaming restarts in ANY live status (ringing included) — gating
  // it on "connected" only used to blind the agent for the whole call if the
  // user toggled during the ringing phase.

  const toggleVideo = useCallback(() => {
    setVideoOn((prev) => {
      const next = !prev;
      videoOnRef.current = next;
      if (streamRef.current) {
        streamRef.current.getVideoTracks().forEach((t) => { t.enabled = next; });
      }
      // While video is off, stop wasting bandwidth on frame captures.
      if (!next) {
        stopVideoStreaming();
      } else {
        startVideoStreaming();
      }
      return next;
    });
  }, [startVideoStreaming, stopVideoStreaming]);

  // ── Cleanup on unmount ──────────────────────────────────────────────

  useEffect(() => {
    return () => {
      manualDisconnectRef.current = true;
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      if (ringingFallbackRef.current) {
        clearTimeout(ringingFallbackRef.current);
        ringingFallbackRef.current = null;
      }
      stopHeartbeat();
      stopSketchSound();
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
  }, [stopVideoStreaming, stopAudioStreaming, stopModelAudio, stopHeartbeat, stopSketchSound]);

  return {
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
  };
}

// ── Helpers ─────────────────────────────────────────────────────────────

function newSessionId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  // Fallback for older browsers / non-secure contexts.
  return `s-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Race a promise against a timer — resolves (with the promise's value or
 * null) instead of rejecting. For awaits where hanging forever is worse than
 * proceeding without the result (e.g. AudioContext.resume in a webview that
 * never grants an audio-focus user gesture).
 */
function raceWithTimeout<T>(p: Promise<T>, timeoutMs: number): Promise<T | null> {
  return Promise.race([
    p,
    new Promise<null>((resolve) => {
      setTimeout(() => resolve(null), timeoutMs);
    }),
  ]);
}

/**
 * getUserMedia with a hard timeout. On some Android WebViews/in-app browsers
 * the permission prompt never surfaces and the promise hangs forever — the
 * call screen then sat on "Calling…" with no way out. We reject after
 * `timeoutMs` and stop any late-resolving tracks so the camera never lingers.
 */
async function getUserMediaWithTimeout(timeoutMs: number): Promise<MediaStream> {
  const mediaPromise = navigator.mediaDevices.getUserMedia({
    video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } },
    audio: {
      channelCount: 1,
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
  });

  let timedOut = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      mediaPromise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          timedOut = true;
          const err = new Error("Camera and microphone access took too long to respond.");
          err.name = "TimeoutError";
          reject(err);
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
    mediaPromise
      .then((s) => {
        if (timedOut) s.getTracks().forEach((t) => t.stop());
      })
      .catch(() => { /* the race already surfaced this (or nobody's waiting) */ });
  }
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
    case 4000:
      return "No response from the server (heartbeat timeout)";
    case 4001:
      return "Server closed an idle connection";
    case 4500:
      return "The stylist agent failed to start on the server — try again in a moment";
    default:
      return "Unknown WebSocket close code";
  }
}

/**
 * Map a getUserMedia / AudioContext error to a user-actionable message.
 * Branches on the DOMException name so the user gets specific guidance
 * (denied vs no-device vs unsupported) instead of a generic blob.
 */
function explainMediaError(err: unknown): string {
  const name = (err as { name?: string } | null)?.name ?? "";
  const mediaErr = err as DOMException | undefined;
  switch (name || mediaErr?.name) {
    case "TimeoutError":
      return "Camera and microphone didn't respond in time. Check that no other app is using them, then try again.";
    case "NotAllowedError":
    case "SecurityError":
      return "Camera or microphone access was blocked. Tap the lock icon in your browser's address bar to allow access, then try again.";
    case "NotFoundError":
    case "DevicesNotFoundError":
      return "No camera or microphone was found. Connect one and try again.";
    case "NotReadableError":
    case "TrackStartError":
      return "Your camera or microphone is being used by another app. Close it and try again.";
    case "OverconstrainedError":
    case "ConstraintNotSatisfiedError":
      return "Your camera doesn't support the required video settings. Try a different device.";
    case "TypeError":
      return "This browser doesn't support camera access over a non-secure connection. Use HTTPS.";
    default:
      return err instanceof Error && err.message
        ? err.message
        : "Could not start the call. Please check camera and microphone permissions.";
  }
}

/**
 * Resolve the live-call WebSocket URL.
 *
 * 1. Explicit override: NEXT_PUBLIC_WS_URL → use verbatim (prod-recommended;
 *    Next's HTTP rewrite layer can't reliably upgrade WebSockets).
 * 2. Else derive from NEXT_PUBLIC_API_URL: swap http(s)→ws(s) and keep the
 *    host + /api/v1 path.
 * 3. Else same-origin relative (dev via Next dev server proxy).
 *
 * Never returns an empty host — guards against the old bug where a relative
 * "/api/v1" produced "ws:///api/v1/...".
 */
function resolveWsUrl(): string {
  const explicit = process.env.NEXT_PUBLIC_WS_URL;
  if (explicit) return explicit;

  const apiUrl = process.env.NEXT_PUBLIC_API_URL || "";
  if (apiUrl && /^https?:\/\//.test(apiUrl)) {
    const wsProto = apiUrl.startsWith("https") ? "wss" : "ws";
    const noProto = apiUrl.replace(/^https?:\/\//, "");
    const noTrailing = noProto.replace(/\/+$/, "");
    return `${wsProto}://${noTrailing}/stylist/live-ws`;
  }

  // Same-origin fallback (dev). Build from window.location.
  if (typeof window !== "undefined" && window.location) {
    const proto = window.location.protocol === "https:" ? "wss" : "ws";
    return `${proto}://${window.location.host}/api/v1/stylist/live-ws`;
  }

  return "ws://localhost:8000/api/v1/stylist/live-ws";
}
