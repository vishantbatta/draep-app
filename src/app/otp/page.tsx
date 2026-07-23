"use client";

/**
 * OTP verification page — spec S5.2-S5.3.
 *
 * Flow:
 *   1. User enters phone number (pre-filled from contact form if available)
 *   2. POST /auth/otp/send → backend sends OTP (test mode: constant 123456)
 *   3. User enters 6-digit OTP
 *   4. POST /auth/otp/verify → upgrades anonymous session → user session
 *   5. On success: redirect back to contact page to continue
 *
 * If the backend has an active draft for this user, it gets re-parented.
 */

import { useState, useEffect, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";

import { ScreenShell } from "@/components/layout/ScreenShell";
import { Button } from "@/components/ui/Button";
import { Banner } from "@/components/ui/Banner";
import { useAuthStore } from "@/lib/auth-store";
import { strings } from "@/lib/strings";
import { track } from "@/lib/analytics";

function OtpContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const phoneFromQuery = searchParams.get("phone") ?? "";

  const verifyOtp = useAuthStore((s) => s.verifyOtp);
  const sendOtp = useAuthStore((s) => s.sendOtp);
  const authHydrated = useAuthStore((s) => s.hydrated);
  const authToken = useAuthStore((s) => s.token);

  const [phone, setPhone] = useState(phoneFromQuery);
  const [otp, setOtp] = useState("");
  const [step, setStep] = useState<"phone" | "otp">(phoneFromQuery ? "otp" : "phone");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resendCooldown, setResendCooldown] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // Auto-send OTP once auth is ready and we arrived with a phone number.
  // We wait for authHydrated AND a token to exist so that the API client
  // has a valid bearer token before calling POST /auth/otp/send.
  const otpSentRef = useRef(false);
  useEffect(() => {
    if (phoneFromQuery && authHydrated && authToken && !otpSentRef.current) {
      otpSentRef.current = true;
      handleSendOtp(phoneFromQuery);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phoneFromQuery, authHydrated, authToken]);

  // Focus OTP input when step changes
  useEffect(() => {
    if (step === "otp" && inputRef.current) {
      inputRef.current.focus();
    }
  }, [step]);

  // Resend cooldown timer
  useEffect(() => {
    if (resendCooldown <= 0) return;
    const timer = setTimeout(() => setResendCooldown((c) => c - 1), 1000);
    return () => clearTimeout(timer);
  }, [resendCooldown]);

  const handleSendOtp = async (phoneToUse?: string) => {
    const p = phoneToUse ?? phone;
    if (!p || !/^[6-9]\d{9}$/.test(p)) {
      setError("Enter a valid 10-digit mobile number");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      await sendOtp(p);
      setStep("otp");
      setResendCooldown(30);
      track({ event: "option_changed", categoryId: "auth", from: null, to: "otp_sent" });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send OTP");
    } finally {
      setLoading(false);
    }
  };

  const handleVerify = async () => {
    if (otp.length < 4) {
      setError("Enter the OTP you received");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      await verifyOtp(phone, otp);
      // OTP verified — redirect back to contact to save address
      router.push("/contact");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Invalid OTP. Try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleResend = () => {
    if (resendCooldown > 0) return;
    setOtp("");
    handleSendOtp();
  };

  return (
    <ScreenShell className="pt-4">
      <p className="eyebrow">Verify your number</p>
      <h1 className="font-heading text-h1 text-ink-navy">
        {step === "phone" ? "Enter your mobile number" : "Enter the OTP"}
      </h1>

      {error && (
        <div className="mt-4">
          <Banner variant="error" title="Something went wrong">
            <p>{error}</p>
          </Banner>
        </div>
      )}

      {step === "phone" ? (
        <div className="mt-5 space-y-5">
          <label className="block">
            <span className="mb-1 block text-caption text-muted">Mobile number</span>
            <div className="flex items-stretch gap-2">
              <span
                data-mono
                className="inline-flex min-w-[58px] items-center justify-center rounded-card border border-hairline-strong bg-mist-navy px-3 font-mono text-body text-ink-navy"
              >
                +91
              </span>
              <input
                type="tel"
                inputMode="numeric"
                autoComplete="tel-national"
                maxLength={10}
                className="w-full rounded-card border border-hairline-strong bg-chalk-white px-3 py-2.5 min-h-[44px] text-body focus-visible:outline-none"
                value={phone}
                onChange={(e) => setPhone(e.target.value.replace(/\D/g, ""))}
                onKeyDown={(e) => e.key === "Enter" && handleSendOtp()}
              />
            </div>
          </label>
          <Button onClick={() => handleSendOtp()} loading={loading} fullWidth>
            Send OTP
          </Button>
          <button
            onClick={() => router.back()}
            className="w-full text-center text-caption text-navy-interactive underline"
          >
            Go back
          </button>
        </div>
      ) : (
        <div className="mt-5 space-y-5">
          <p className="text-body text-ink/80">
            Sent to <span className="font-mono font-semibold">+91 {phone}</span>
          </p>
          <label className="block">
            <span className="mb-1 block text-caption text-muted">6-digit OTP</span>
            <input
              ref={inputRef}
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={8}
              data-mono
              className="w-full rounded-card border border-hairline-strong bg-chalk-white px-3 py-2.5 min-h-[44px] text-center font-mono text-h2 tracking-[0.5em] focus-visible:outline-none"
              value={otp}
              onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))}
              onKeyDown={(e) => e.key === "Enter" && handleVerify()}
            />
          </label>
          <Button onClick={handleVerify} loading={loading} fullWidth>
            Verify & continue
          </Button>
          <div className="flex items-center justify-between">
            <button
              onClick={() => setStep("phone")}
              className="text-caption text-navy-interactive underline"
            >
              Change number
            </button>
            <button
              onClick={handleResend}
              disabled={resendCooldown > 0}
              className="text-caption text-navy-interactive underline disabled:opacity-40"
            >
              {resendCooldown > 0 ? `Resend in ${resendCooldown}s` : "Resend OTP"}
            </button>
          </div>
          <p className="text-center text-caption text-muted">
            Test mode: use OTP <span className="font-mono font-semibold">123456</span>
          </p>
        </div>
      )}
    </ScreenShell>
  );
}

export default function OtpPage() {
  return (
    <Suspense
      fallback={
        <div className="column flex min-h-dvh items-center justify-center">
          <div aria-hidden className="h-1 w-24 overflow-hidden rounded-pill bg-tape-silver">
            <div className="h-full w-1/2 animate-pulse bg-draep-orange" />
          </div>
        </div>
      }
    >
      <OtpContent />
    </Suspense>
  );
}
