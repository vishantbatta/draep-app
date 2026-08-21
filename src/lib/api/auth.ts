/**
 * Auth API — anonymous session, OTP send/verify, session check, logout.
 * Mirrors be/app/api/auth.py
 */

import { apiGet, apiPost } from "./client";
import type {
  AnonymousSessionOut,
  OtpSendOut,
  OtpVerifyOut,
  SessionOut,
} from "@/types/api";

export function createAnonymousSession(): Promise<AnonymousSessionOut> {
  return apiPost<AnonymousSessionOut>("/auth/anonymous", undefined, {
    skipAuth: true,
  });
}

export function exchangeLoginLink(token: string): Promise<OtpVerifyOut> {
  return apiPost<OtpVerifyOut>("/auth/login-link/exchange", { token }, {
    skipAuth: true,
  });
}

export function sendOtp(
  phone: string,
  countryCode = "+91",
): Promise<OtpSendOut> {
  return apiPost<OtpSendOut>("/auth/otp/send", { phone, country_code: countryCode });
}

export function verifyOtp(
  phone: string,
  otp: string,
  countryCode = "+91",
  orderId?: string | null,
): Promise<OtpVerifyOut> {
  return apiPost<OtpVerifyOut>("/auth/otp/verify", {
    phone,
    country_code: countryCode,
    otp,
    order_id: orderId ?? null,
  });
}

/**
 * Complete login after the MSG91 widget verified the OTP in-browser.
 * `otpToken` is the one-time JWT from the widget's verify success callback
 * (see lib/msg91.ts); the backend re-verifies it with MSG91.
 */
export function verifyOtpWidget(
  phone: string,
  otpToken: string,
  countryCode = "+91",
  orderId?: string | null,
): Promise<OtpVerifyOut> {
  return apiPost<OtpVerifyOut>("/auth/otp/widget/verify", {
    phone,
    country_code: countryCode,
    otp_token: otpToken,
    order_id: orderId ?? null,
  });
}

export function getSession(): Promise<SessionOut> {
  return apiGet<SessionOut>("/auth/session");
}

export function logout(): Promise<void> {
  return apiPost<void>("/auth/logout");
}
