"use client";

/**
 * Auth store — manages the session token and user identity.
 *
 * Lifecycle:
 *   1. On app load → check for existing token in localStorage
 *   2. If none → POST /auth/anonymous → store token
 *   3. On contact page → sendOtp + verifyOtp → upgrade anonymous → user token
 *   4. Token persists in localStorage with 90-day expiry matching backend JWT
 */

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

import { authApi } from "@/lib/api";
import { setToken, clearToken, getToken } from "@/lib/api/client";
import type { OtpVerifyOut, SessionOut, UserOut } from "@/types/api";

const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;

interface AuthStoreState {
  token: string | null;
  sessionType: "anonymous" | "user" | null;
  user: UserOut | null;
  activeOrderId: string | null;
  expiresAt: number | null; // epoch ms
  hydrated: boolean;

  // Bootstrap
  bootstrap: () => Promise<void>;
  initAnonymous: () => Promise<void>;

  // Admin login link (?token=… URL → user session)
  exchangeLoginLink: (token: string) => Promise<OtpVerifyOut>;
  consumeLoginLinkFromUrl: () => Promise<void>;

  // OTP flow
  sendOtp: (phone: string, countryCode?: string) => Promise<void>;
  verifyOtp: (
    phone: string,
    otp: string,
    countryCode?: string,
    orderId?: string | null,
  ) => Promise<OtpVerifyOut>;
  // MSG91 widget login: swap the widget's verified one-time token for a session
  verifyOtpWidget: (
    phone: string,
    otpToken: string,
    countryCode?: string,
    orderId?: string | null,
  ) => Promise<OtpVerifyOut>;

  // Session
  refreshSession: () => Promise<SessionOut>;
  updateProfile: (name: string, gender?: string | null) => Promise<void>;
  logout: () => Promise<void>;

  // Internal
  setHydrated: () => void;
}

export const useAuthStore = create<AuthStoreState>()(
  persist(
    (set, get) => ({
      token: null,
      sessionType: null,
      user: null,
      activeOrderId: null,
      expiresAt: null,
      hydrated: false,

      setHydrated: () => set({ hydrated: true }),

      /**
       * Called on app mount. Checks if we have a valid token; if not,
       * mints an anonymous session. If the token is expired, re-mints.
       *
       * A `?token=` login link in the URL (admin-issued) takes priority
       * over any persisted session and is exchanged first.
       */
      bootstrap: async () => {
        await get().consumeLoginLinkFromUrl();

        const state = get();
        const now = Date.now();

        // Valid token exists — just validate with the server
        if (state.token && state.expiresAt && state.expiresAt > now) {
          setToken(state.token);
          try {
            await get().refreshSession();
            return;
          } catch {
            // Token is invalid/expired server-side → fall through to re-mint
          }
        }

        // No valid token → mint anonymous
        await get().initAnonymous();
      },

      initAnonymous: async () => {
        try {
          const result = await authApi.createAnonymousSession();
          setToken(result.session_token);
          set({
            token: result.session_token,
            sessionType: "anonymous",
            user: null,
            activeOrderId: null,
            expiresAt: new Date(result.expires_at).getTime() || Date.now() + NINETY_DAYS_MS,
          });
        } catch (err) {
          // If anonymous session creation fails (network), try to use
          // any existing token from localStorage as a fallback
          const existing = getToken();
          if (existing) {
            set({ token: existing, sessionType: "anonymous" });
          }
          // Re-throw so the UI can show an error if needed
          throw err;
        }
      },

      sendOtp: async (phone: string, countryCode = "+91") => {
        await authApi.sendOtp(phone, countryCode);
      },

      verifyOtp: async (
        phone: string,
        otp: string,
        countryCode = "+91",
        orderId?: string | null,
      ) => {
        const result = await authApi.verifyOtp(phone, otp, countryCode, orderId);
        setToken(result.session_token);
        set({
          token: result.session_token,
          sessionType: "user",
          user: result.user,
          activeOrderId: result.active_order_id,
          expiresAt: new Date(result.expires_at).getTime(),
        });
        return result;
      },

      /**
       * MSG91 widget login (real OTP): the widget verified the code
       * in-browser; swap its one-time token for a user session. Mirrors
       * verifyOtp.
       */
      verifyOtpWidget: async (
        phone: string,
        otpToken: string,
        countryCode = "+91",
        orderId?: string | null,
      ) => {
        const result = await authApi.verifyOtpWidget(phone, otpToken, countryCode, orderId);
        setToken(result.session_token);
        set({
          token: result.session_token,
          sessionType: "user",
          user: result.user,
          activeOrderId: result.active_order_id,
          expiresAt: new Date(result.expires_at).getTime(),
        });
        return result;
      },

      /**
       * Exchange a short-lived admin-issued login-link token for a full
       * user session (admin viewing a user's dashboard). Mirrors verifyOtp.
       */
      exchangeLoginLink: async (linkToken: string) => {
        const result = await authApi.exchangeLoginLink(linkToken);
        setToken(result.session_token);
        set({
          token: result.session_token,
          sessionType: "user",
          user: result.user,
          activeOrderId: result.active_order_id,
          expiresAt: new Date(result.expires_at).getTime(),
        });
        return result;
      },

      /**
       * If the current URL carries ?token=<login-link>, exchange it and
       * strip the token from the address bar + history so it can't leak
       * via re-copying the URL. Invalid/expired links fall through to the
       * normal session flow silently.
       */
      consumeLoginLinkFromUrl: async () => {
        if (typeof window === "undefined") return;
        const params = new URLSearchParams(window.location.search);
        const linkToken = params.get("token");
        if (!linkToken) return;

        params.delete("token");
        const qs = params.toString();
        window.history.replaceState(
          null,
          "",
          `${window.location.pathname}${qs ? `?${qs}` : ""}${window.location.hash}`,
        );
        try {
          await get().exchangeLoginLink(linkToken);
        } catch {
          // Expired / invalid link — continue as whatever session we had.
        }
      },

      refreshSession: async () => {
        const result = await authApi.getSession();
        set({
          sessionType: result.session_type as "anonymous" | "user",
          user: result.user,
          activeOrderId: result.active_order_id,
        });
        return result;
      },

      /**
       * Save name + gender for the signed-in user (first-login profile
       * completion). Merges the returned user into the store — `user.name`
       * going non-null is what un-gates the orders dashboard.
       */
      updateProfile: async (name: string, gender?: string | null) => {
        const updated = await authApi.updateProfile(name, gender ?? undefined);
        set({ user: { ...get().user, ...updated } });
      },

      logout: async () => {
        try {
          await authApi.logout();
        } catch {
          // Best effort — clear locally regardless
        }
        clearToken();
        set({
          token: null,
          sessionType: null,
          user: null,
          activeOrderId: null,
          expiresAt: null,
        });
        // Re-mint anonymous for continued browsing
        await get().initAnonymous();
      },
    }),
    {
      name: "draep-auth",
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        token: state.token,
        sessionType: state.sessionType,
        user: state.user,
        activeOrderId: state.activeOrderId,
        expiresAt: state.expiresAt,
      }),
      onRehydrateStorage: () => (state) => {
        state?.setHydrated();
        // Sync token to the api client on hydration
        if (state?.token) {
          setToken(state.token);
        }
      },
    },
  ),
);

/** Convenience hook for components that just need the hydrated flag. */
export function useAuthHydrated(): boolean {
  return useAuthStore((s) => s.hydrated);
}
