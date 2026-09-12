"use client";

/**
 * WalkInLoginGate — inline OTP login for a walk-in QR landing
 * (WALKIN_V2_PLAN.md §5.8).
 *
 * The QR encodes /app/orders/<id>?wi=1&ph=<phone>. A 404 on that URL means
 * the current session isn't the order's owner — for an anonymous visitor the
 * order page swaps its "not found" card for this gate instead. It mirrors the
 * AppTabs inline-OTP pattern: send to the walk-in phone, captain handed the
 * customer their code, verify upgrades the session, and the host refetches.
 */

import { useEffect, useState } from "react";

import { ScreenShell } from "@/components/layout/ScreenShell";
import { Button } from "@/components/ui/Button";
import { useAuthStore } from "@/lib/auth-store";
import { msg91Enabled, otpLength, sendOtpViaMsg91, verifyOtpViaMsg91 } from "@/lib/msg91";

const RESEND_COOLDOWN_S = 30;

export function WalkInLoginGate({
  phone,
  onVerified,
}: {
  /** 10-digit national number the walk-in order was created for. */
  phone: string;
  /** Fires after the session upgrades — the host strips ?wi/?ph and refetches. */
  onVerified: () => void;
}) {
  const sendOtp = useAuthStore((s) => s.sendOtp);
  const verifyOtp = useAuthStore((s) => s.verifyOtp);
  const verifyOtpWidget = useAuthStore((s) => s.verifyOtpWidget);

  const [otp, setOtp] = useState("");
  const [otpSent, setOtpSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resendCooldown, setResendCooldown] = useState(0);

  // Send exactly once on mount — the phone is fixed (it came from the QR).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setBusy(true);
      setError(null);
      try {
        if (msg91Enabled) {
          await sendOtpViaMsg91(`91${phone}`);
        } else {
          await sendOtp(phone);
        }
        if (!cancelled) {
          setOtpSent(true);
          setResendCooldown(RESEND_COOLDOWN_S);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Could not send the code");
        }
      } finally {
        if (!cancelled) setBusy(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phone]);

  // Resend cooldown ticker.
  useEffect(() => {
    if (resendCooldown <= 0) return;
    const timer = window.setTimeout(() => setResendCooldown((s) => s - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [resendCooldown]);

  async function handleResend() {
    if (resendCooldown > 0 || busy) return;
    setBusy(true);
    setError(null);
    try {
      if (msg91Enabled) {
        await sendOtpViaMsg91(`91${phone}`);
      } else {
        await sendOtp(phone);
      }
      setOtp("");
      setResendCooldown(RESEND_COOLDOWN_S);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not resend the code");
    } finally {
      setBusy(false);
    }
  }

  async function handleVerify() {
    if (otp.length !== otpLength || busy) return;
    setBusy(true);
    setError(null);
    try {
      if (msg91Enabled) {
        const otpToken = await verifyOtpViaMsg91(otp);
        await verifyOtpWidget(phone, otpToken);
      } else {
        await verifyOtp(phone, otp);
      }
      onVerified();
    } catch (err) {
      setError(err instanceof Error ? err.message : "That code didn't match — try again");
    } finally {
      setBusy(false);
    }
  }

  return (
    <ScreenShell className="px-4 pt-6">
      <div className="mx-auto mt-6 max-w-md rounded-card border border-hairline bg-chalk-white p-6 text-center shadow-card">
        <p className="eyebrow">In-store order</p>
        <h1 className="mt-1 font-heading text-h2 text-ink-navy">
          Log in to see your order
        </h1>
        <p className="mt-2 text-caption text-muted">
          This order was started for you in-store with the number +91 {phone}.
          We&apos;ve sent a verification code to it — enter the code to open your
          order and pay.
        </p>

        <input
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={otpLength}
          value={otp}
          onChange={(e) => setOtp(e.target.value.replace(/\D/g, "").slice(0, otpLength))}
          onKeyDown={(e) => e.key === "Enter" && void handleVerify()}
          placeholder="••••••"
          disabled={!otpSent}
          aria-label="Verification code"
          className="mt-5 w-full rounded-card border border-hairline-strong bg-chalk-white px-4 py-3 text-center font-mono text-h2 tracking-[0.4em] text-ink outline-none focus:border-navy-interactive focus:ring-2 focus:ring-navy-interactive/30 disabled:opacity-50"
        />

        {error && (
          <div
            role="alert"
            className="mt-3 rounded-card border border-error-border bg-error-bg px-4 py-3 text-caption text-error-text"
          >
            {error}
          </div>
        )}

        <div className="mt-4 space-y-2">
          <Button
            fullWidth
            loading={busy}
            disabled={otp.length !== otpLength}
            onClick={() => void handleVerify()}
          >
            Verify & open order
          </Button>
          <Button
            fullWidth
            variant="secondary"
            disabled={resendCooldown > 0 || busy || !otpSent}
            onClick={() => void handleResend()}
          >
            {resendCooldown > 0 ? `Resend code in ${resendCooldown}s` : "Resend code"}
          </Button>
        </div>
      </div>
    </ScreenShell>
  );
}
