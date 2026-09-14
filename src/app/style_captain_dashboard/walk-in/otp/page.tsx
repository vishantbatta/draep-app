"use client";

/**
 * /style_captain_dashboard/walk-in/otp — the captain types the customer's
 * code. On success the USER is created/linked immediately (walk-in UTM
 * stamped if absent) and the wizard moves to /address. The order still only
 * comes into existence with the first garment.
 */

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { ArrowLeft } from "@/components/ui/icons";
import { Button } from "@/components/ui/Button";
import { msg91Enabled, sendOtpViaMsg91, verifyOtpViaMsg91 } from "@/lib/msg91";
import { useWalkInDraft } from "@/lib/walkin-draft-store";
import { scWalkInOtpSend, scWalkInOtpVerify, scWalkInUser } from "@/lib/style-captain-api";

const OTP_LENGTH = 4; // real MSG91 OTPs are always 4 digits
const RESEND_SECONDS = 30;

const inputCls =
  "w-full rounded-card border border-hairline-strong bg-chalk-white px-4 py-3 text-body " +
  "focus:border-accent-text focus:ring-2 focus:ring-accent-text/30 focus:outline-none";

const bannerCls =
  "rounded-card border border-error-border bg-error-bg px-4 py-3 text-caption text-error-text";

export default function WalkInOtpPage() {
  const router = useRouter();
  const draft = useWalkInDraft();

  const [otp, setOtp] = useState("");
  const [otpSending, setOtpSending] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);
  const [error, setError] = useState<string | null>(null);

  // No draft (direct load / refresh) → back to the front door.
  useEffect(() => {
    if (!draft.phone) router.replace("/style_captain_dashboard/walk-in");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft.phone]);

  async function sendOtp() {
    setOtpSending(true);
    setError(null);
    try {
      if (msg91Enabled) {
        // Real OTP, exactly like the /app login: the MSG91 widget sends to
        // the customer's phone from the captain's browser.
        await sendOtpViaMsg91(`91${draft.phone}`);
      } else {
        await scWalkInOtpSend(draft.phone, draft.countryCode);
      }
      setResendCooldown(RESEND_SECONDS);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send the code");
    } finally {
      setOtpSending(false);
    }
  }

  // Send exactly once per phone on mount.
  const sentForRef = useRef<string | null>(null);
  useEffect(() => {
    if (!draft.phone) return;
    if (sentForRef.current === draft.phone) return;
    sentForRef.current = draft.phone;
    void sendOtp();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft.phone]);

  // Resend cooldown ticker.
  useEffect(() => {
    if (resendCooldown <= 0) return;
    const timer = setTimeout(() => setResendCooldown((c) => c - 1), 1000);
    return () => clearTimeout(timer);
  }, [resendCooldown]);

  async function handleVerify() {
    if (otp.length !== OTP_LENGTH || verifying) return;
    setVerifying(true);
    setError(null);
    try {
      let otpToken: string | undefined;
      if (msg91Enabled) {
        // The widget verifies the code in-browser and returns a one-time
        // token — the BE re-verifies it with MSG91 before accepting.
        otpToken = await verifyOtpViaMsg91(otp);
      }
      const res = await scWalkInOtpVerify(draft.phone, otp, draft.countryCode, otpToken);

      // The user is created (and UTM-stamped) RIGHT AFTER verification —
      // new customers' names were captured at lookup, existing ones are
      // linked by id.
      const user = await scWalkInUser(
        draft.isNewUser
          ? {
              verification_token: res.verification_token,
              new_user: {
                name: draft.customerName ?? "",
                phone: draft.phone,
                country_code: draft.countryCode,
              },
            }
          : {
              verification_token: res.verification_token,
              user_id: draft.lookupUserId ?? "",
            },
      );
      draft.setUser(user.user_id);
      router.push("/style_captain_dashboard/walk-in/address");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Verification failed");
    } finally {
      setVerifying(false);
    }
  }

  return (
    <div className="mx-auto min-h-screen max-w-lg px-4 pb-28 pt-6">
      <div className="mb-6 flex items-center gap-3">
        <button
          onClick={() => router.back()}
          aria-label="Go back"
          className="rounded-full border border-hairline-strong bg-chalk-white p-2 text-ink transition hover:bg-mist-navy/20"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <div>
          <div className="text-eyebrow text-accent-text">Walk-in</div>
          <h1 className="font-heading text-head-3 text-ink">Verify customer</h1>
        </div>
      </div>

      {error && <div className={`mb-4 ${bannerCls}`}>{error}</div>}

      <div className="space-y-4">
        <p className="text-caption text-muted">
          Ask the customer to read the 4-digit code from their SMS. Sent to{" "}
          <span className="font-medium text-ink">
            {draft.countryCode} {draft.phone}
          </span>
          .
        </p>
        <input
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          autoFocus
          maxLength={OTP_LENGTH}
          value={otp}
          onChange={(e) => setOtp(e.target.value.replace(/\D/g, "").slice(0, OTP_LENGTH))}
          onKeyDown={(e) => e.key === "Enter" && void handleVerify()}
          placeholder="••••"
          className={`${inputCls} text-center font-mono text-2xl tracking-[0.5em]`}
        />
        <div className="flex items-center justify-between text-caption text-muted">
          <span>Didn&apos;t arrive?</span>
          {resendCooldown > 0 ? (
            <span>Resend in {resendCooldown}s</span>
          ) : (
            <button
              onClick={() => void sendOtp()}
              disabled={otpSending}
              className="text-accent-text underline disabled:opacity-50"
            >
              {otpSending ? "Sending…" : "Resend code"}
            </button>
          )}
        </div>
        <Button
          fullWidth
          loading={verifying}
          disabled={otp.length !== OTP_LENGTH}
          onClick={() => void handleVerify()}
        >
          Verify code
        </Button>
      </div>
    </div>
  );
}
