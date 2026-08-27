"use client";

/**
 * ProfileCompletionGate — the app-wide blocking step for a signed-in user
 * still missing their name or gender.
 *
 * Mounted once in the /app layout; while either field is empty it covers
 * the whole surface (above every sheet and toast) and cannot be dismissed —
 * the only way past it is saving the profile. This includes the moment a
 * fresh OTP signup lands: the mid-flow LoginGateSheet succeeds, its host's
 * next step opens underneath, and this gate collects the profile on top.
 * Anonymous visitors never see it — they get the login gates first.
 *
 * Only the missing fields are asked: a user with a name but no gender gets
 * just the gender chips, and vice versa.
 */

import { useEffect, useState } from "react";

import { Banner } from "@/components/ui/Banner";
import { Button } from "@/components/ui/Button";
import { Chip } from "@/components/ui/Chip";
import { useAuthStore, useAuthHydrated } from "@/lib/auth-store";
import { GENDER_OPTIONS } from "@/lib/gender";
import { strings } from "@/lib/strings";

export function ProfileCompletionGate() {
  const updateProfile = useAuthStore((s) => s.updateProfile);
  const sessionType = useAuthStore((s) => s.sessionType);
  const user = useAuthStore((s) => s.user);
  const hydrated = useAuthHydrated();

  const isLoggedIn = sessionType === "user";
  const needsName = isLoggedIn && !user?.name;
  const needsGender = isLoggedIn && !user?.gender;

  const [name, setName] = useState("");
  const [gender, setGender] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const blocked = hydrated && (needsName || needsGender);

  // Reset the form whenever the block re-arms (e.g. logout of a complete
  // user into an incomplete one) so a half-typed attempt never leaks.
  useEffect(() => {
    if (blocked) {
      setName("");
      setGender("");
      setBusy(false);
      setError(null);
    }
  }, [blocked]);

  if (!blocked) return null;

  const handleSave = async () => {
    const trimmed = name.trim();
    if ((needsName && !trimmed) || (needsGender && !gender)) return;
    setBusy(true);
    setError(null);
    try {
      // Always send a full payload — fields the user wasn't asked for keep
      // their stored values through the PATCH.
      await updateProfile(
        needsName ? trimmed : user!.name!,
        needsGender ? gender : user!.gender!,
      );
      // Store user updates → the block disarms and this unmounts.
    } catch (err) {
      setError(err instanceof Error ? err.message : strings.dashboard.profileError);
    } finally {
      setBusy(false);
    }
  };

  const body = needsName && needsGender
    ? strings.dashboard.profileBody
    : needsName
      ? strings.dashboard.profileBodyName
      : strings.dashboard.profileBodyGender;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={strings.dashboard.profileTitle}
      className="fixed inset-0 z-[100] flex flex-col overflow-y-auto bg-warm-sand"
    >
      <div className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-4 py-10">
        <div className="overflow-hidden rounded-card border border-hairline bg-chalk-white shadow-card">
          <div className="flex flex-col items-center border-b border-hairline bg-warm-sand px-4 py-6 text-center">
            <span className="inline-block animate-logo-float motion-reduce:animate-none drop-shadow-[0_12px_14px_rgba(168,80,16,0.28)]">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/logo_alpha_icon.png" alt="draep" className="block h-[48px] w-auto" />
            </span>
            <h2 className="mt-4 font-heading text-h3 text-ink-navy">
              {strings.dashboard.profileTitle}
            </h2>
            <p className="mt-0.5 font-heading text-body text-accent-text">{body}</p>
          </div>

          <div className="p-4">
            {needsName && (
              <>
                <label htmlFor="profile-gate-name" className="text-caption text-muted">
                  {strings.dashboard.nameLabel}
                </label>
                <input
                  id="profile-gate-name"
                  autoComplete="name"
                  autoFocus
                  maxLength={160}
                  value={name}
                  onChange={(e) => setName(e.target.value.slice(0, 160))}
                  placeholder={strings.dashboard.namePlaceholder}
                  className="mt-1 min-h-[44px] w-full rounded-card border-[1.5px] border-hairline bg-chalk-white px-3 py-2.5 font-heading text-body text-ink-navy placeholder:text-muted focus:border-navy-interactive focus:outline-none"
                />
              </>
            )}

            {needsGender && (
              <>
                <p aria-hidden className={needsName ? "mt-4 text-caption text-muted" : "text-caption text-muted"}>
                  {strings.dashboard.genderLabel}
                </p>
                <div className="mt-1.5 flex flex-wrap gap-2" role="group" aria-label={strings.dashboard.genderLabel}>
                  {GENDER_OPTIONS.map((option) => (
                    <Chip
                      key={option.value}
                      selected={gender === option.value}
                      onClick={() => setGender(option.value)}
                      ariaLabel={option.label}
                    >
                      {option.label}
                    </Chip>
                  ))}
                </div>
              </>
            )}

            <Button
              fullWidth
              className="mt-4"
              loading={busy}
              disabled={(needsName && !name.trim()) || (needsGender && !gender)}
              onClick={() => void handleSave()}
            >
              {strings.dashboard.profileSubmit}
            </Button>

            {error && (
              <Banner variant="error" className="mt-3">
                <p className="text-caption">{error}</p>
              </Banner>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
