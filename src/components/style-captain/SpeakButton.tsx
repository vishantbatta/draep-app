"use client";

import { useEffect, useState } from "react";

/**
 * SpeakButton — read a text out loud via the browser's speechSynthesis.
 *
 * Language is set per the multilingual tab that drives the text (en-IN,
 * hi-IN, …) so the spoken gist matches what's on screen. Toggles between
 * Listen / Stop; always cancels on unmount or language/text change so a
 * stale utterance never keeps playing. Renders nothing when the Web Speech
 * API is unavailable (older browsers).
 */

const TTS_LANG: Record<string, string> = {
  en: "en-IN",
  hi: "hi-IN",
  kn: "kn-IN",
  ta: "ta-IN",
  te: "te-IN",
};

export function SpeakButton({
  text,
  lang,
}: {
  text: string;
  lang: string;
}) {
  const [speaking, setSpeaking] = useState(false);
  const supported =
    typeof window !== "undefined" && "speechSynthesis" in window;

  // Cancel any in-flight utterance when the component goes away or the
  // text/language changes underneath it.
  useEffect(() => {
    return () => {
      if (typeof window !== "undefined" && "speechSynthesis" in window) {
        window.speechSynthesis.cancel();
      }
    };
  }, [text, lang]);

  useEffect(() => {
    if (!supported) return;
    // Synthesis can end without our onend firing (e.g. cancel from OS) —
    // settle the label via events only; worst case the toggle resets it.
    const synth = window.speechSynthesis;
    const onEnd = () => setSpeaking(false);
    synth.addEventListener("end", onEnd);
    return () => synth.removeEventListener("end", onEnd);
  }, [supported]);

  if (!supported || !text) return null;

  function toggle() {
    const synth = window.speechSynthesis;
    if (speaking) {
      synth.cancel();
      setSpeaking(false);
      return;
    }
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = TTS_LANG[lang] ?? "en-IN";
    utterance.onend = () => setSpeaking(false);
    utterance.onerror = () => setSpeaking(false);
    synth.cancel();
    synth.speak(utterance);
    setSpeaking(true);
  }

  return (
    <button
      onClick={toggle}
      className={`tap inline-flex shrink-0 items-center gap-1.5 rounded-pill px-3 py-1.5 text-caption font-semibold transition ${
        speaking
          ? "bg-ink-navy text-chalk-white shadow-card"
          : "border border-hairline-strong bg-chalk-white text-ink-navy"
      }`}
      aria-label={speaking ? "Stop reading aloud" : "Read aloud"}
    >
      <span aria-hidden>{speaking ? "■" : "🔊"}</span>
      {speaking ? "Stop" : "Listen"}
    </button>
  );
}
