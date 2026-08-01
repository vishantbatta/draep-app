"use client";

/**
 * useGeminiLiveCall — React hook managing a Gemini Live API WebSocket session.
 *
 * Modelled directly on Google's reference implementation:
 *   - Dumb backend proxy (pure pass-through)
 *   - All config sent from the browser in the setup message
 *   - realtime_input.media_chunks for audio + video (snake_case)
 *   - client_content for text turns
 *   - tool_response for function call results
 *   - VAD with proper sensitivity settings + NO_INTERRUPTION
 *   - Audio playback at 24kHz (Gemini output rate)
 *   - Audio capture at 16kHz
 */

import { useCallback, useEffect, useRef, useState } from "react";

import { getStylistComponents, generateDesign } from "@/lib/api/stylist";

export type CallStatus = "idle" | "connecting" | "connected" | "ended" | "error";

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

const MODEL = "publishers/google/models/gemini-live-2.5-flash-native-audio";

// Video frame capture rate (1fps like the reference)
const FRAME_INTERVAL_MS = 1000;

// Audio input rate (Gemini expects 16kHz)
const AUDIO_INPUT_RATE = 16000;

// Audio output rate (Gemini outputs at 24kHz)
const AUDIO_OUTPUT_RATE = 24000;

const SYSTEM_INSTRUCTION = `You are Draep's AI Fashion Designer — a warm, expert stylist on a video call with a customer who wants to design a custom blouse (Indian ethnic wear).

YOUR ROLE:
- You are on a live VIDEO CALL. You can SEE the user through their camera.
- You are friendly, concise, and speak naturally — like a real designer on a video consultation.
- You speak in the user's preferred language.

CALL FLOW (follow this exactly):
1. First, greet the user warmly and ask: "What language would you prefer for our consultation?" Wait for their answer, then switch to that language for the rest of the call.
2. Ask the user to show their full upper body on camera so you can see their body type and posture. Confirm when you can see them clearly.
3. Call get_garment_components to get the full list of available blouse design options.
4. Based on what you see (their body type, posture, and any preferences they share), suggest a complete blouse design. Describe the neckline, back design, sleeve style, and any add-ons you recommend — explaining WHY each choice suits them.
5. Once the user is happy with your suggestion, call generate_design_image with a detailed description of the design and the current camera frame. Show them the result and refine based on their feedback.

IMPORTANT RULES:
- Be conversational — short sentences, natural pauses. Don't monologue.
- Ask one question at a time and wait for the answer.
- When describing designs, be specific: "I recommend a sweetheart neckline with elbow-length sleeves and a deep back with tie-up detail."
- Always use the get_garment_components tool to know exactly what options are available — never invent options.
- Always use the generate_design_image tool to create visual previews — never just describe without showing.
- Keep the tone warm, confident, and professional — like a master tailor who loves their craft.`;

// ── Hook ────────────────────────────────────────────────────────────────

let _transcriptId = 0;
let _designId = 0;

export function useGeminiLiveCall() {
  const [status, setStatus] = useState<CallStatus>("idle");
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const [designImages, setDesignImages] = useState<DesignImage[]>([]);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [muted, setMuted] = useState(false);

  // Refs
  const wsRef = useRef<WebSocket | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  // Audio playback (output) — separate context at 24kHz
  const outputAudioCtxRef = useRef<AudioContext | null>(null);
  const nextAudioTimeRef = useRef(0);

  // Audio capture (input) — separate context at 16kHz
  const inputAudioCtxRef = useRef<AudioContext | null>(null);
  const audioProcessorRef = useRef<ScriptProcessorNode | null>(null);
  const audioSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);

  const frameTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const componentListRef = useRef<string>("");

  const mutedRef = useRef(false);
  const statusRef = useRef<CallStatus>("idle");
  const setupDoneRef = useRef(false);

  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  // ── Audio playback (model → speaker) at 24kHz ───────────────────────

  const playAudioChunk = useCallback((base64Data: string) => {
    try {
      const ctx = outputAudioCtxRef.current;
      if (!ctx) return;

      // Decode base64 → bytes
      const binaryStr = atob(base64Data);
      const len = binaryStr.length;
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) {
        bytes[i] = binaryStr.charCodeAt(i);
      }

      // Gemini sends raw PCM 16-bit LE at 24kHz
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

      const startTime = Math.max(ctx.currentTime, nextAudioTimeRef.current);
      source.start(startTime);
      nextAudioTimeRef.current = startTime + audioBuffer.duration;
    } catch {
      // best-effort
    }
  }, []);

  // ── Handle function calls (browser-side, like reference) ────────────

  const handleToolCalls = useCallback(
    async (calls: Array<{ id: string; name: string; args: Record<string, unknown> }>) => {
      console.log("[GeminiLive] Tool calls received:", calls.map((c) => c.name));

      for (const call of calls) {
        let responseObj: Record<string, unknown>;

        try {
          if (call.name === "get_garment_components") {
            console.log("[GeminiLive] Fetching garment components...");
            if (!componentListRef.current) {
              const result = await getStylistComponents();
              componentListRef.current = result.component_list;
            }
            responseObj = { components: componentListRef.current };
            console.log("[GeminiLive] Components fetched, length:", componentListRef.current.length);
          } else if (call.name === "generate_design_image") {
            const imageData = captureCurrentFrame();
            const description = (call.args.description as string) || "elegant blouse design";

            if (!imageData) {
              responseObj = { error: "Could not capture camera frame." };
            } else {
              console.log("[GeminiLive] Generating design image...");
              const result = await generateDesign({ image: imageData, description });
              console.log("[GeminiLive] Design generated:", result.output_url);

              setDesignImages((prev) => [
                ...prev,
                { id: ++_designId, url: result.output_url, description, timestamp: Date.now() },
              ]);

              responseObj = {
                success: true,
                image_url: result.output_url,
                message: "Design generated successfully.",
              };
            }
          } else {
            responseObj = { error: `Unknown function: ${call.name}` };
          }
        } catch (err) {
          console.error(`[GeminiLive] Tool call ${call.name} failed:`, err);
          responseObj = { error: err instanceof Error ? err.message : "Function call failed" };
        }

        // Send tool_response back to Google via the proxy
        // Using the exact format from the reference: tool_response (snake_case)
        const toolResponseMsg = {
          tool_response: {
            id: call.id,
            response: responseObj,
          },
        };

        const ws = wsRef.current;
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify(toolResponseMsg));
          console.log(`[GeminiLive] Sent tool_response for ${call.name}`);
        } else {
          console.warn(`[GeminiLive] WS closed, couldn't send tool_response for ${call.name}`);
        }
      }
    },
    [],
  );

  // ── Capture current video frame as base64 ───────────────────────────

  function captureCurrentFrame(): string | null {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || !video.videoWidth) return null;

    const maxWidth = 512;
    const scale = Math.min(1, maxWidth / video.videoWidth);
    canvas.width = video.videoWidth * scale;
    canvas.height = video.videoHeight * scale;

    const ctx = canvas.getContext("2d");
    if (!ctx) return null;

    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.8);
  }

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

      // Resample from ctx.sampleRate (usually 48000) to 16000
      const downsampled = downsampleBuffer(input, ctx.sampleRate, AUDIO_INPUT_RATE);
      if (!downsampled) return;

      const pcm16 = float32ToPCM16(downsampled);
      const base64 = arrayBufferToBase64(pcm16.buffer);
      if (!base64) return;

      // Use realtime_input.media_chunks format (matching reference exactly)
      ws.send(
        JSON.stringify({
          realtime_input: {
            media_chunks: [
              {
                mime_type: "audio/pcm",
                data: base64,
              },
            ],
          },
        }),
      );
    };

    source.connect(processor);
    // Connect to a zero-gain node so the processor stays alive but
    // mic audio does NOT play through the speakers (prevents echo/feedback).
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

      // Use realtime_input.media_chunks format (matching reference exactly)
      ws.send(
        JSON.stringify({
          realtime_input: {
            media_chunks: [
              {
                mime_type: "image/jpeg",
                data: base64,
              },
            ],
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

      // ── setupComplete ──
      if ("setupComplete" in msg) {
        console.log("[GeminiLive] Setup complete — session ready");
        setupDoneRef.current = true;
        setStatus("connected");
        startVideoStreaming();

        // Start audio streaming NOW
        if (streamRef.current) {
          startAudioStreaming(streamRef.current);
        }

        // Kick off conversation with initial text turn
        const ws = wsRef.current;
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(
            JSON.stringify({
              client_content: {
                turns: [
                  {
                    role: "user",
                    parts: [{ text: "Hi! I'm ready for my fashion consultation." }],
                  },
                ],
                turn_complete: true,
              },
            }),
          );
          console.log("[GeminiLive] Sent initial greeting turn");
        }
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
            {
              id: ++_transcriptId,
              role: "model",
              text: serverContent.outputTranscription!.text,
              timestamp: Date.now(),
            },
          ]);
        }

        if (serverContent.inputTranscription?.text) {
          setTranscript((prev) => [
            ...prev,
            {
              id: ++_transcriptId,
              role: "user",
              text: serverContent.inputTranscription!.text,
              timestamp: Date.now(),
            },
          ]);
        }

        // Flush audio queue on interruption
        if (serverContent.interrupted) {
          nextAudioTimeRef.current = 0;
        }
      }

      // ── Tool calls ──
      const toolCall = msg.toolCall as
        | { functionCalls: Array<{ id: string; name: string; args: Record<string, unknown> }> }
        | undefined;

      if (toolCall?.functionCalls) {
        void handleToolCalls(toolCall.functionCalls);
      }
    },
    [playAudioChunk, handleToolCalls, startVideoStreaming, startAudioStreaming],
  );

  // ── Connect (start the call) ────────────────────────────────────────

  const connect = useCallback(async () => {
    setStatus("connecting");
    setErrorMsg(null);
    setTranscript([]);
    setDesignImages([]);
    setupDoneRef.current = false;

    try {
      // 1. Get user media (front camera + mic)
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } },
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      streamRef.current = stream;

      // 2. Initialize output audio context at 24kHz (for playback)
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;

      outputAudioCtxRef.current = new AudioCtx({ sampleRate: AUDIO_OUTPUT_RATE });
      if (outputAudioCtxRef.current.state === "suspended") {
        await outputAudioCtxRef.current.resume();
      }
      nextAudioTimeRef.current = 0;

      // 3. Initialize input audio context at 16kHz (for capture)
      inputAudioCtxRef.current = new AudioCtx({ sampleRate: AUDIO_INPUT_RATE });
      if (inputAudioCtxRef.current.state === "suspended") {
        await inputAudioCtxRef.current.resume();
      }

      // 4. Attach video
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => {});
      }

      // 5. Open WebSocket to backend proxy
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000/api/v1";
      const apiHost = apiUrl.replace(/^https?:\/\//, "").replace(/\/api\/v1$/, "");
      const apiProto = apiUrl.startsWith("https") ? "wss:" : "ws:";
      const wsUrl = `${apiProto}//${apiHost}/api/v1/stylist/live-ws`;
      const ws = new WebSocket(wsUrl);
      ws.binaryType = "arraybuffer";
      wsRef.current = ws;

      ws.onopen = () => {
        console.log("[GeminiLive] WebSocket opened, sending setup...");

        // Setup message using snake_case keys (matching Google's reference exactly)
        const setup = {
          model: MODEL,
          generation_config: {
            response_modalities: ["AUDIO"],
            temperature: 1.0,
            speech_config: {
              voice_config: {
                prebuilt_voice_config: {
                  voice_name: "Puck",
                },
              },
            },
          },
          system_instruction: {
            parts: [{ text: SYSTEM_INSTRUCTION }],
          },
          tools: {
            function_declarations: [
              {
                name: "get_garment_components",
                description:
                  "Get the complete list of available blouse style components and their options (necklines, sleeves, back designs, add-ons, etc.). Call this to know exactly what design options are available before making suggestions.",
                parameters: { type: "object", properties: {} },
              },
              {
                name: "generate_design_image",
                description:
                  "Generate a photorealistic image of the user wearing a specific blouse design. Pass a detailed description of the design. The function captures the current camera frame and overlays the design. Returns the generated image.",
                parameters: {
                  type: "object",
                  properties: {
                    description: {
                      type: "string",
                      description:
                        "Detailed description of the blouse design to generate, e.g. 'Sweetheart neckline, elbow-length sleeves, deep V-back with tie-up, navy blue silk with gold embroidery'",
                    },
                  },
                  required: ["description"],
                },
              },
            ],
          },
          // Proactive audio lets the model speak first without waiting for user input
          proactivity: {
            proactive_audio: true,
          },
          realtime_input_config: {
            automatic_activity_detection: {
              disabled: false,
              silence_duration_ms: 0,
              prefix_padding_ms: 500,
              end_of_speech_sensitivity: "END_SENSITIVITY_HIGH",
              start_of_speech_sensitivity: "START_SENSITIVITY_UNSPECIFIED",
            },
            // NO_INTERRUPTION prevents barge-in so the designer's full response plays
            activity_handling: "NO_INTERRUPTION",
          },
          input_audio_transcription: {},
          output_audio_transcription: {},
        };

        ws.send(JSON.stringify({ setup }));
        console.log("[GeminiLive] Setup message sent");
      };

      ws.onmessage = handleWsMessage;

      ws.onerror = (event) => {
        console.error("[GeminiLive] WebSocket error:", event);
      };

      ws.onclose = (event) => {
        console.warn(
          `[GeminiLive] WebSocket closed: code=${event.code}, reason="${event.reason}", wasClean=${event.wasClean}`,
        );

        stopVideoStreaming();
        stopAudioStreaming();

        if (!setupDoneRef.current) {
          const parts: string[] = ["Connection to the designer was lost."];
          if (event.reason) parts.push(event.reason);
          parts.push(`(WebSocket close code: ${event.code})`);
          setErrorMsg(parts.join(" "));
          setStatus("error");
        } else if (statusRef.current !== "ended" && statusRef.current !== "error") {
          setStatus("ended");
        }
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
  }, [
    handleWsMessage,
    stopVideoStreaming,
    stopAudioStreaming,
  ]);

  // ── Disconnect ──────────────────────────────────────────────────────

  const disconnect = useCallback(() => {
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
  }, [stopVideoStreaming, stopAudioStreaming]);

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
  }, [stopVideoStreaming, stopAudioStreaming]);

  return {
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
