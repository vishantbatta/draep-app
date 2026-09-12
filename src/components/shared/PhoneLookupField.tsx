"use client";

/**
 * Shared phone-input field for customer lookup flows.
 *
 * Extracted from the admin NewOrderSheet (2026-09-11) for reuse by the
 * style-captain walk-in flow. Purely presentational: the consumer owns the
 * phone/country-code state and the debounced lookup; this field sanitizes
 * input via the canonical `normalizePhoneInput` (drops a pasted country
 * code by keeping the last 10 digits) and renders blur-only validation.
 */

import { normalizePhoneInput, PHONE_DIGIT_COUNT } from "@/lib/phone";

// Country codes (dialing prefixes).
// India is the default market — +91 first, the rest alphabetical by label.
export const COUNTRY_CODES = [
  { code: "+91", label: "🇮🇳 +91" },
  { code: "+1", label: "🇺🇸 +1" },
  { code: "+44", label: "🇬🇧 +44" },
  { code: "+61", label: "🇦🇺 +61" },
  { code: "+971", label: "🇦🇪 +971" },
  { code: "+65", label: "🇸🇬 +65" },
] as const;

export type CountryCodeOption = { code: string; label: string };

interface PhoneLookupFieldProps {
  /** Selected dialing prefix, e.g. "+91". */
  countryCode: string;
  onCountryCodeChange: (code: string) => void;
  /** National number, digits only (already sanitized by this field). */
  phone: string;
  onPhoneChange: (nationalDigits: string) => void;
  /** Set once the field has been focused and left — gates the hint. */
  touched?: boolean;
  onBlur?: () => void;
  /** Renders the "Searching…" affordance while a lookup is in flight. */
  searching?: boolean;
  /** Fixed market: renders a static +91 chip instead of the dropdown. */
  fixedCountry?: boolean;
  autoFocus?: boolean;
  countryCodes?: readonly CountryCodeOption[];
  disabled?: boolean;
}

export function PhoneLookupField({
  countryCode,
  onCountryCodeChange,
  phone,
  onPhoneChange,
  touched,
  onBlur,
  searching,
  fixedCountry,
  autoFocus,
  countryCodes = COUNTRY_CODES,
  disabled,
}: PhoneLookupFieldProps) {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-muted">
        Phone number <span className="text-red-500">*</span>
      </label>
      <div className="flex gap-2">
        {fixedCountry ? (
          <span className="flex shrink-0 items-center rounded-lg border border-hairline-strong bg-mist-navy px-3 text-sm font-medium text-muted">
            {countryCode}
          </span>
        ) : (
          <select
            value={countryCode}
            onChange={(e) => onCountryCodeChange(e.target.value)}
            disabled={disabled}
            className="shrink-0 rounded-lg border border-hairline-strong bg-chalk-white px-2.5 py-2.5 text-sm focus:border-ink-navy focus:outline-none"
            aria-label="Country code"
          >
            {countryCodes.map((c) => (
              <option key={c.code} value={c.code}>
                {c.label}
              </option>
            ))}
          </select>
        )}
        {/* Phone number (sanitized to digits only) */}
        <input
          type="tel"
          inputMode="numeric"
          value={phone}
          onChange={(e) => onPhoneChange(normalizePhoneInput(e.target.value))}
          onBlur={onBlur}
          disabled={disabled}
          placeholder="10-digit mobile number"
          className="w-full rounded-lg border border-hairline-strong bg-chalk-white px-3 py-2.5 text-sm focus:border-ink-navy focus:outline-none"
          autoFocus={autoFocus}
        />
      </div>
      {/* Validation only on blur (focus out) — not on every keystroke. */}
      {touched && phone.length > 0 && phone.length !== PHONE_DIGIT_COUNT && (
        <div className="mt-1 text-[11px] text-red-500">
          Enter a valid {PHONE_DIGIT_COUNT}-digit mobile number.
        </div>
      )}
      {searching && (
        <div className="mt-1 text-[11px] text-muted">Searching…</div>
      )}
    </div>
  );
}
