/**
 * Cashfree drop-in SDK loader — the v3 JS SDK opens a payment session in a
 * modal (or redirect) with the amount/name/phone the backend pre-filled at
 * order creation; the session id is the only thing the client ever holds.
 *
 * The mode MUST match where the session was created: the SDK defaults to
 * sandbox when no mode is given, which breaks live sessions. Accepted
 * values are "production" | "sandbox" (lowercase, per the SDK source).
 */

export type CashfreeMode = "production" | "sandbox";

export interface CashfreeSDK {
  checkout: (options: {
    paymentSessionId: string;
    redirectTarget: "_modal" | "_self" | "_blank";
  }) => Promise<unknown>;
}

type CashfreeFactory = {
  (options?: { mode?: CashfreeMode }): CashfreeSDK;
};

export function loadCashfree(mode: CashfreeMode): Promise<CashfreeSDK> {
  return new Promise((resolve, reject) => {
    if (typeof window === "undefined") {
      reject(new Error("Cashfree SDK can only be loaded in the browser"));
      return;
    }

    const w = window as unknown as Record<string, CashfreeFactory | undefined>;

    if (w.Cashfree) {
      resolve(w.Cashfree({ mode }));
      return;
    }

    const script = document.createElement("script");
    script.src = "https://sdk.cashfree.com/js/v3/cashfree.js";
    script.async = true;
    script.onload = () => {
      if (w.Cashfree) {
        resolve(w.Cashfree({ mode }));
      } else {
        reject(new Error("Cashfree SDK failed to initialize"));
      }
    };
    script.onerror = () => reject(new Error("Failed to load payment SDK"));
    document.head.appendChild(script);
  });
}
