"use client";

/**
 * LoginGateSheet — bottom-sheet phone+OTP login for mid-flow gates.
 *
 * The same anonymous → user upgrade as the Profile tab's inline card (MSG91
 * widget when configured, legacy test endpoints otherwise), but modal: hosts
 * open it when a visitor taps something that needs an account — e.g. the
 * MYOD Generate Blouse CTA — instead of navigating away and losing flow
 * state. onSuccess fires once the store holds a user session; input ids are
 * gate-prefixed so the form can coexist with the Profile tab's card (tabs
 * stay mounted on /app).
 */

import { useEffect, useState } from "react";

import { Banner } from "@/components/ui/Banner";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { Button } from "@/components/ui/Button";
import { MonoNumber } from "@/components/ui/MonoNumber";
import { Check, ShieldCheck } from "@/components/ui/icons";
import { useAuthStore } from "@/lib/auth-store";
import { msg91Enabled, otpLength, sendOtpViaMsg91, verifyOtpViaMsg91 } from "@/lib/msg91";
import { normalizePhoneInput } from "@/lib/phone";
import { strings } from "@/lib/strings";

const RESEND_COOLDOWN_S = 30;

/** "9876543210" → "98765 43210" for display only (same as the Profile card). */
function formatPhoneDisplay(phone: string): string {
  return phone.length === 10 ? `${phone.slice(0, 5)} ${phone.slice(5)}` : phone;
}

export function LoginGateSheet({
  open,
  onClose,
  onSuccess,
  title,
  message,
}: {
  open: boolean;
  onClose: () => void;
  /** Called once the visitor has a user session. */
  onSuccess: () => void;
  /** Per-surface overrides of the default gate copy (strings.loginGate.*). */
  title?: string;
  message?: string;
}) {
  const sendOtp = useAuthStore((s) => s.sendOtp);
  const verifyOtp = useAuthStore((s) => s.verifyOtp);
  const verifyOtpWidget = useAuthStore((s) => s.verifyOtpWidget);

  const [phone, setPhone] = useState("");
  const [otp, setOtp] = useState("");
  const [otpSent, setOtpSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resendCooldown, setResendCooldown] = useState(0);
  const [codeResent, setCodeResent] = useState(false);

  // Every gate opens on a fresh form — a half-finished attempt (or its
  // cooldown) shouldn't leak into the next one.
  useEffect(() => {
    if (!open) return;
    setPhone("");
    setOtp("");
    setOtpSent(false);
    setBusy(false);
    setError(null);
    setResendCooldown(0);
    setCodeResent(false);
  }, [open]);

  // Resend cooldown — one interval while it counts down, none once it hits 0.
  const coolingDown = resendCooldown > 0;
  useEffect(() => {
    if (!coolingDown) return;
    const timer = window.setInterval(() => {
      setResendCooldown((s) => Math.max(0, s - 1));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [coolingDown]);

  const handleSendOtp = async () => {
    if (phone.length !== 10) return;
    setBusy(true);
    setError(null);
    try {
      if (msg91Enabled) {
        // MSG91 identifier = country code + phone, no plus.
        await sendOtpViaMsg91(`91${phone}`);
      } else {
        await sendOtp(phone);
      }
      setOtpSent(true);
      setResendCooldown(RESEND_COOLDOWN_S);
      setCodeResent(false);
      // The OTP field mounts on this state flip — focus it after commit.
      window.setTimeout(() => document.getElementById("gate-otp")?.focus(), 0);
    } catch (err) {
      setError(err instanceof Error ? err.message : strings.dashboard.loginError);
    } finally {
      setBusy(false);
    }
  };

  // Auto-send the moment the typed number becomes a valid 10-digit mobile
  // (the form then morphs into OTP entry — that swap is the once-guard).
  // Fires on paste/autofill too, since normalization lands in one change.
  useEffect(() => {
    if (open && /^[6-9]\d{9}$/.test(phone) && !otpSent && !busy) {
      void handleSendOtp();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phone, otpSent, open]);

  const handleResendOtp = async () => {
    if (resendCooldown > 0 || busy) return;
    setBusy(true);
    setError(null);
    try {
      if (msg91Enabled) {
        await sendOtpViaMsg91(`91${phone}`);
      } else {
        await sendOtp(phone);
      }
      // The new code supersedes whatever was typed — start clean.
      setOtp("");
      setCodeResent(true);
      setResendCooldown(RESEND_COOLDOWN_S);
      document.getElementById("gate-otp")?.focus();
    } catch (err) {
      setError(err instanceof Error ? err.message : strings.dashboard.loginError);
    } finally {
      setBusy(false);
    }
  };

  const handleVerifyOtp = async () => {
    if (otp.length !== otpLength) return;
    setBusy(true);
    setError(null);
    try {
      if (msg91Enabled) {
        // Widget verifies the code with MSG91 → one-time token → backend
        // re-verifies it and mints the session.
        const otpToken = await verifyOtpViaMsg91(otp);
        await verifyOtpWidget(phone, otpToken);
      } else {
        await verifyOtp(phone, otp);
      }
      // sessionType flips to "user" in the store before onSuccess runs.
      // busy stays true so the button keeps its spinner until the host closes.
      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : strings.dashboard.loginError);
      setBusy(false);
    }
  };

  return (
    <BottomSheet open={open} onClose={onClose} title={title ?? strings.loginGate.title}>
      <p className="text-caption text-muted">{message ?? strings.loginGate.message}</p>

      {!otpSent ? (
        <div className="mt-3">
          <label htmlFor="gate-phone" className="text-caption text-muted">
            {strings.dashboard.phoneLabel}
          </label>
          <div className="mt-1 flex items-stretch gap-2">
            <span
              aria-hidden
              data-mono
              className="inline-flex min-w-[56px] items-center justify-center rounded-card border-[1.5px] border-hairline bg-mist-navy px-3 font-heading text-body text-ink-navy"
            >
              +91
            </span>
            <input
              id="gate-phone"
              inputMode="numeric"
              autoComplete="tel"
              value={phone}
              onChange={(e) => setPhone(normalizePhoneInput(e.target.value))}
              placeholder="Enter phone number"
              className="min-h-[44px] w-full rounded-card border-[1.5px] border-hairline bg-chalk-white px-3 py-2.5 font-heading text-body text-ink-navy placeholder:text-muted focus:border-navy-interactive focus:outline-none"
            />
          </div>
          <p className="mt-1.5 text-caption text-muted">
            We&apos;ll text a {otpLength}-digit code to verify it&apos;s you.
          </p>
          <Button
            fullWidth
            className="mt-3"
            loading={busy}
            disabled={phone.length !== 10}
            onClick={() => void handleSendOtp()}
          >
            {strings.dashboard.sendCode}
          </Button>
        </div>
      ) : (
        <div className="mt-3">
          {/* Sent confirmation — where the code went */}
          <div
            role="status"
            className="flex items-center gap-2 rounded-card bg-success-bg px-3 py-2"
          >
            <span
              aria-hidden
              className="flex h-6 w-6 flex-none items-center justify-center rounded-pill bg-success text-chalk-white"
            >
              <Check size={13} />
            </span>
            <p className="text-caption text-ink/85">
              Code sent to{" "}
              <MonoNumber className="font-semibold text-data text-ink-navy">
                +91 {formatPhoneDisplay(phone)}
              </MonoNumber>
            </p>
          </div>

          <label htmlFor="gate-otp" className="mt-4 block text-caption text-muted">
            {otpLength}-digit code
          </label>
          <input
            id="gate-otp"
            inputMode="numeric"
            autoComplete="one-time-code"
            value={otp}
            onChange={(e) => setOtp(e.target.value.replace(/\D/g, "").slice(0, otpLength))}
            className="mt-1 min-h-[44px] w-full rounded-card border-[1.5px] border-hairline bg-chalk-white px-3 py-2.5 text-center font-mono text-data tracking-[0.4em] text-ink-navy focus:border-navy-interactive focus:outline-none"
          />
          <Button
            fullWidth
            className="mt-3"
            loading={busy}
            disabled={otp.length !== otpLength}
            onClick={() => void handleVerifyOtp()}
          >
            {strings.dashboard.verify}
          </Button>

          {codeResent && (
            <p role="status" className="mt-2 text-center text-caption text-success-text">
              {strings.dashboard.codeResent}
            </p>
          )}

          {resendCooldown > 0 ? (
            <p className="mt-2 text-center text-caption text-muted">
              {strings.dashboard.resendCodeIn(resendCooldown)}
            </p>
          ) : (
            <button
              type="button"
              disabled={busy}
              onClick={() => void handleResendOtp()}
              className="mt-2 w-full text-center text-caption text-navy-interactive underline disabled:no-underline disabled:text-muted"
            >
              {strings.dashboard.resendCode}
            </button>
          )}

          <button
            type="button"
            onClick={() => {
              setOtpSent(false);
              setOtp("");
              setResendCooldown(0);
              setCodeResent(false);
            }}
            className="mt-2 w-full text-center text-caption text-navy-interactive underline"
          >
            {strings.dashboard.useDifferentNumber}
          </button>
        </div>
      )}

      {error && (
        <Banner variant="error" className="mt-3">
          <p className="text-caption">{error}</p>
        </Banner>
      )}

      {!msg91Enabled && (
        <p className="mt-3 text-center text-caption text-muted">
          {strings.dashboard.demoHint}
        </p>
      )}
      <p className="mt-3 flex items-center justify-center gap-1.5 pb-2 text-center text-caption text-muted">
        <ShieldCheck size={14} className="text-accent-text" aria-hidden />
        Your number is used only for your orders
      </p>
    </BottomSheet>
  );
}
