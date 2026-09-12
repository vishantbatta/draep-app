/**
 * Normalize raw phone-field input to a bare 10-digit Indian mobile.
 *
 * Pasted or Chrome-autofilled values often arrive with the country code —
 * "+917986147238" or "+91 79861 47238" — so strip the non-digits and keep
 * the LAST 10 digits (drops the country code, not the final digits).
 * Typing one digit at a time never exceeds 10, so ordinary entry is
 * untouched.
 */
export function normalizePhoneInput(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  return digits.length > 10 ? digits.slice(-10) : digits;
}

// Indian mobile numbers are 10 digits after the country code.
export const PHONE_DIGIT_COUNT = 10;

/** A national number is complete exactly when it has all its digits. */
export function isValidNationalPhone(digits: string): boolean {
  return digits.length === PHONE_DIGIT_COUNT;
}
