/**
 * MSG91 OTP widget — client-side send/verify with our own UI.
 *
 * Loads https://verify.msg91.com/otp-provider.js once with
 * `exposeMethods: true`, which suppresses MSG91's default popup so the app
 * keeps its own phone/OTP inputs. MSG91 verifies the code in-browser and
 * returns a one-time JWT ("otp token") which the backend re-verifies at
 * POST /auth/otp/widget/verify before minting a session — the OTP code
 * itself never reaches our API.
 *
 * Enable with NEXT_PUBLIC_MSG91_WIDGET_ID + NEXT_PUBLIC_MSG91_TOKEN_AUTH
 * (msg91.com → OTP → widget settings). When unset, callers fall back to the
 * legacy test-mode endpoints (/auth/otp/send + /auth/otp/verify, code 123456).
 *
 * Docs: https://msg91.com/help/sendotp/how-to-integrate-the-new-login-with-otp-widget
 */

const WIDGET_ID = process.env.NEXT_PUBLIC_MSG91_WIDGET_ID ?? "";
const TOKEN_AUTH = process.env.NEXT_PUBLIC_MSG91_TOKEN_AUTH ?? "";

/** True when the widget env vars are set → real OTP login is live. */
export const msg91Enabled = Boolean(WIDGET_ID && TOKEN_AUTH);

/**
 * OTP length the UI accepts. Must match the "OTP length" configured on the
 * MSG91 widget (currently 4). The legacy test-mode code is 6 digits.
 */
export const otpLength = msg91Enabled ? 4 : 6;

/** Widget callbacks receive a `{ type, message }` envelope. */
interface Msg91CallbackData {
  type?: string;
  message?: string;
  access_token?: string;
  token?: string;
}

type SuccessCallback = (data: Msg91CallbackData) => void;
type FailureCallback = (error: Msg91CallbackData) => void;

interface Msg91Window {
  initSendOTP?: (config: Record<string, unknown>) => void;
  sendOtp?: (identifier: string, onSuccess?: SuccessCallback, onFailure?: FailureCallback) => void;
  verifyOtp?: (otp: string, onSuccess?: SuccessCallback, onFailure?: FailureCallback) => void;
}

declare global {
  interface Window extends Msg91Window {}
}

const SCRIPT_ID = "msg91-otp-provider";
const SCRIPT_SRC = "https://verify.msg91.com/otp-provider.js";

/** How long initSendOTP may take to expose sendOtp/verifyOtp. */
const METHODS_TIMEOUT_MS = 15_000;

let loadPromise: Promise<void> | null = null;

/**
 * initSendOTP boots the widget asynchronously — window.sendOtp/verifyOtp only
 * appear once it finishes. Calling them earlier is a silent no-op, so every
 * send/verify must first wait for the methods to exist.
 */
function waitForMethods(timeoutMs = METHODS_TIMEOUT_MS): Promise<void> {
  if (typeof window.sendOtp === "function" && typeof window.verifyOtp === "function") {
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const timer = window.setInterval(() => {
      const ready =
        typeof window.sendOtp === "function" && typeof window.verifyOtp === "function";
      if (ready) {
        window.clearInterval(timer);
        resolve();
      } else if (Date.now() - startedAt > timeoutMs) {
        window.clearInterval(timer);
        reject(new Error("The OTP service took too long to load. Please try again."));
      }
    }, 200);
  });
}

/** Inject the widget script and init it with our config. Idempotent. */
function loadWidget(): Promise<void> {
  if (loadPromise) return loadPromise;

  loadPromise = (async () => {
    if (!document.getElementById(SCRIPT_ID)) {
      await new Promise<void>((resolve, reject) => {
        const script = document.createElement("script");
        script.id = SCRIPT_ID;
        script.src = SCRIPT_SRC;
        script.async = true;
        script.onload = () => resolve();
        script.onerror = () => {
          script.remove();
          reject(
            new Error("Couldn't reach the OTP service. Check your connection and try again."),
          );
        };
        document.body.appendChild(script);
      });
    }

    if (typeof window.sendOtp !== "function") {
      window.initSendOTP?.({
        widgetId: WIDGET_ID,
        tokenAuth: TOKEN_AUTH,
        exposeMethods: true,
        // Config-level callbacks stay no-op — we use per-call callbacks to
        // avoid the double success/failure events the widget docs warn about.
        success: () => {},
        failure: () => {},
      });
    }

    await waitForMethods();
  })();

  // A failed load should be retryable on the next send/verify attempt.
  loadPromise.catch(() => {
    loadPromise = null;
  });

  return loadPromise;
}

/**
 * Ask MSG91 to send an OTP.
 * @param identifier mobile with country code and no plus, e.g. "919999999999"
 */
export async function sendOtpViaMsg91(identifier: string): Promise<void> {
  await loadWidget();
  await new Promise<void>((resolve, reject) => {
    window.sendOtp?.(
      identifier,
      () => resolve(),
      (err) => reject(new Error(err?.message || "Couldn't send the OTP. Please try again.")),
    );
  });
}

/**
 * Pull the one-time access token out of the widget's verify success
 * callback. The docs put it in `message`; `access_token`/`token` and a bare
 * string are accepted too, defensively.
 */
function extractToken(data: Msg91CallbackData | string | undefined | null): string | null {
  if (!data) return null;
  if (typeof data === "string") return data || null;
  return data.message ?? data.access_token ?? data.token ?? null;
}

/**
 * Verify the entered OTP with MSG91. Resolves with the one-time token MSG91
 * returns in the callback's `message` — the backend re-verifies that token
 * to mint the session (see authApi.verifyOtpWidget).
 */
export async function verifyOtpViaMsg91(otp: string): Promise<string> {
  await loadWidget();
  return new Promise<string>((resolve, reject) => {
    window.verifyOtp?.(
      otp,
      (data) => {
        const token = extractToken(data);
        if (token) resolve(token);
        else reject(new Error("OTP verified, but no token was returned. Please try again."));
      },
      (err) => reject(new Error(err?.message || "The OTP you entered is incorrect.")),
    );
  });
}
