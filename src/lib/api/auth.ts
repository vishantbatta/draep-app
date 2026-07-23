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
): Promise<OtpVerifyOut> {
  return apiPost<OtpVerifyOut>("/auth/otp/verify", {
    phone,
    country_code: countryCode,
    otp,
  });
}

export function getSession(): Promise<SessionOut> {
  return apiGet<SessionOut>("/auth/session");
}

export function logout(): Promise<void> {
  return apiPost<void>("/auth/logout");
}
