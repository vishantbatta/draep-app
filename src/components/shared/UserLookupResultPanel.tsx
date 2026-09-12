"use client";

/**
 * Shared post-lookup result panels for customer-by-phone flows.
 *
 * Extracted from the admin NewOrderSheet (2026-09-11) for reuse by the
 * style-captain walk-in flow. Renders exactly one of three states after a
 * completed phone lookup: found (green), found-but-not-a-customer (red),
 * or not-found → ask for a name (amber + name input). The consumer keeps
 * owning the lookup state; this panel is purely presentational.
 */

import type { ReactNode } from "react";

export interface LookupUser {
  name: string | null;
  phone: string | null;
  country_code?: string | null;
  email?: string | null;
}

interface UserLookupResultPanelProps {
  /** A completed search (10-digit number, lookup finished at least once). */
  searched: boolean;
  foundUser: LookupUser | null;
  /** When the phone belongs to an admin/captain/etc — their role, raw. */
  nonCustomerRole: string | null;
  searching?: boolean;
  /** Name typed for a brand-new customer. */
  newUserName: string;
  onNewUserNameChange: (name: string) => void;
  /** Country code shown next to the found user's phone when their profile has none. */
  fallbackCountryCode?: string;
  /** Optional extra note rendered inside the "existing user found" panel. */
  note?: ReactNode;
}

export function UserLookupResultPanel({
  searched,
  foundUser,
  nonCustomerRole,
  searching,
  newUserName,
  onNewUserNameChange,
  fallbackCountryCode,
  note,
}: UserLookupResultPanelProps) {
  return (
    <>
      {/* Found user */}
      {searched && foundUser && (
        <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-3">
          <div className="text-xs font-medium text-green-800">✓ Existing user found</div>
          <div className="mt-1 text-sm font-medium text-ink">{foundUser.name ?? "Unnamed"}</div>
          <div className="text-[11px] text-muted">
            {foundUser.country_code ?? fallbackCountryCode} {foundUser.phone}
            {foundUser.email ? ` • ${foundUser.email}` : ""}
          </div>
          {note && <div className="mt-2 text-[11px] text-green-900/80">{note}</div>}
        </div>
      )}

      {/* Found but not a customer */}
      {searched && !foundUser && nonCustomerRole && !searching && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-800">
          <div className="font-medium">This phone number belongs to a {nonCustomerRole.replace("_", " ")}, not a customer.</div>
          <div className="mt-0.5 opacity-80">
            Orders can only be created for customers. Please use a different phone number.
          </div>
        </div>
      )}

      {/* Not found → ask for name */}
      {searched && !foundUser && !nonCustomerRole && !searching && (
        <div className="space-y-2">
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5 text-xs text-amber-800">
            No user found with this phone number. Enter a name to create a new customer.
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-muted">
              Customer name <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={newUserName}
              onChange={(e) => onNewUserNameChange(e.target.value)}
              placeholder="Full name"
              className="w-full rounded-lg border border-hairline-strong bg-chalk-white px-3 py-2.5 text-sm focus:border-ink-navy focus:outline-none"
            />
          </div>
        </div>
      )}
    </>
  );
}
