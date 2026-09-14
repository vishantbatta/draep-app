"use client";

/**
 * /style_captain_dashboard/walk-in — the wizard's front door.
 *
 * Real-route wizard: each screen is its own URL (phone → /otp → /address →
 * /garments → /review), so browser back/forward is native — no history
 * tricks. This screen is the phone + customer lookup. `?order=<id>` (the
 * dashboard Walk-ins tab) resumes: the server snapshot decides which route
 * to land on; a cancelled order shows the dropped card right here.
 */

import { Suspense, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";

import { PhoneLookupField } from "@/components/shared/PhoneLookupField";
import { UserLookupResultPanel, type LookupUser } from "@/components/shared/UserLookupResultPanel";
import { ArrowLeft } from "@/components/ui/icons";
import { Button } from "@/components/ui/Button";
import { isValidNationalPhone } from "@/lib/phone";
import { useWalkInDraft } from "@/lib/walkin-draft-store";
import { scWalkInOrderSnapshot, scWalkInUserLookup } from "@/lib/style-captain-api";

const LOOKUP_DEBOUNCE_MS = 350;

/** Existing-user note shown inside the green lookup panel. */
const LOOKUP_NOTE =
  "Booking for someone else? Please use their own phone number — OTP and order access are tied to it.";

const bannerCls =
  "rounded-card border border-error-border bg-error-bg px-4 py-3 text-caption text-error-text";

function WalkInStart() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const draft = useWalkInDraft();

  const resumeId = searchParams.get("order");

  // ── Resume: ?order=<id> → snapshot decides the landing route ───────────
  const [resuming, setResuming] = useState(false);
  const [resumeError, setResumeError] = useState<string | null>(null);
  const [cancelled, setCancelled] = useState<{ orderNumber: string | null } | null>(null);
  const resumeRanRef = useRef(false);
  useEffect(() => {
    if (!resumeId || resumeRanRef.current) return;
    resumeRanRef.current = true;
    let cancelledFlag = false;
    setResuming(true);
    scWalkInOrderSnapshot(resumeId)
      .then((snap) => {
        if (cancelledFlag) return;
        if (snap.stage === "cancelled") {
          setCancelled({ orderNumber: snap.order_number });
          return;
        }
        // A booked future slot lands on review (its paid block shows the
        // slot); a started measurement lands on review's done state.
        const target =
          snap.stage === "measuring" || snap.stage === "ready" || snap.garments.length > 0
            ? `/style_captain_dashboard/walk-in/review?order=${encodeURIComponent(resumeId)}`
            : `/style_captain_dashboard/walk-in/garments?order=${encodeURIComponent(resumeId)}`;
        router.replace(target);
      })
      .catch((err) => {
        if (!cancelledFlag) {
          setResumeError(err instanceof Error ? err.message : "Could not load this walk-in.");
        }
      })
      .finally(() => {
        if (!cancelledFlag) setResuming(false);
      });
    return () => {
      cancelledFlag = true;
    };
  }, [resumeId, router]);

  // ── Phone + lookup (fresh walk-in) ──────────────────────────────────────
  const countryCode = draft.countryCode;
  const [phoneInput, setPhoneInput] = useState("");
  const [phoneTouched, setPhoneTouched] = useState(false);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);
  const [foundUser, setFoundUser] = useState<LookupUser | null>(null);
  const [blockedRole, setBlockedRole] = useState<string | null>(null);
  const [newUserName, setNewUserName] = useState("");
  const [savedAddresses, setSavedAddresses] = useState<
    Awaited<ReturnType<typeof scWalkInUserLookup>>["addresses"]
  >([]);
  const [pageError, setPageError] = useState<string | null>(null);
  const lookupUserIdRef = useRef<string | null>(null);

  const phoneValid = isValidNationalPhone(phoneInput);
  const isNewUserLookup = searched && !foundUser && !blockedRole;
  const canSubmitPhone =
    phoneValid && !searching && !blockedRole && (!isNewUserLookup || newUserName.trim().length >= 2);

  // Debounced lookup — admin-parity validation, 10-digit trigger.
  useEffect(() => {
    if (!phoneValid) {
      setSearching(false);
      setSearched(false);
      setFoundUser(null);
      setBlockedRole(null);
      return;
    }
    let cancelled = false;
    setSearching(true);
    const timer = setTimeout(async () => {
      try {
        const res = await scWalkInUserLookup(phoneInput, countryCode);
        if (cancelled) return;
        setSearched(true);
        setPageError(null);
        if (res.found && res.user) {
          if (res.user.is_customer) {
            setFoundUser({
              name: res.user.name,
              phone: res.user.phone,
              country_code: res.user.country_code,
            });
            setBlockedRole(null);
            lookupUserIdRef.current = res.user.id;
          } else {
            setFoundUser(null);
            setBlockedRole("staff member");
            lookupUserIdRef.current = null;
          }
          const addrs = res.addresses ?? [];
          setSavedAddresses(addrs);
        } else {
          setFoundUser(null);
          setBlockedRole(null);
          setSavedAddresses([]);
          lookupUserIdRef.current = null;
        }
      } catch (err) {
        if (!cancelled) setPageError(err instanceof Error ? err.message : "Lookup failed");
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, LOOKUP_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phoneInput, countryCode]);

  function handleSubmitPhone() {
    if (!canSubmitPhone) return;
    draft.setLookup({
      phone: phoneInput,
      countryCode,
      isNewUser: isNewUserLookup,
      customerName: isNewUserLookup ? newUserName.trim() : (foundUser?.name ?? null),
      lookupUserId: isNewUserLookup ? null : lookupUserIdRef.current,
      savedAddresses: (savedAddresses ?? []) as never,
    });
    router.push("/style_captain_dashboard/walk-in/otp");
  }

  // ── Render ────────────────────────────────────────────────────────────────
  if (resuming) {
    return (
      <div className="mx-auto max-w-lg px-4 py-10 text-center text-caption text-muted">
        Loading walk-in…
      </div>
    );
  }
  if (resumeError) {
    return (
      <div className="mx-auto max-w-lg space-y-4 px-4 py-10">
        <div className={bannerCls}>{resumeError}</div>
        <Link
          href="/style_captain_dashboard"
          className="block text-center text-caption text-accent-text underline"
        >
          Back to dashboard
        </Link>
      </div>
    );
  }
  if (cancelled) {
    return (
      <div className="mx-auto min-h-screen max-w-lg space-y-5 px-4 pt-6">
        <div className="rounded-card border border-hairline-strong bg-chalk-white px-4 py-4 text-caption text-muted">
          Walk-in {cancelled.orderNumber ?? ""} was dropped. The draft order stays cancelled.
        </div>
        <Button fullWidth onClick={() => draft.reset()}>
          Start a new walk-in
        </Button>
      </div>
    );
  }

  return (
    <div className="mx-auto min-h-screen max-w-lg px-4 pb-28 pt-6">
      <div className="mb-6 flex items-center gap-3">
        <button
          onClick={() => router.push("/style_captain_dashboard")}
          aria-label="Go back"
          className="rounded-full border border-hairline-strong bg-chalk-white p-2 text-ink transition hover:bg-mist-navy/20"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <div>
          <div className="text-eyebrow text-accent-text">Walk-in</div>
          <h1 className="font-heading text-head-3 text-ink">Customer&apos;s phone</h1>
        </div>
      </div>

      {pageError && <div className={`mb-4 ${bannerCls}`}>{pageError}</div>}

      <div className="space-y-4">
        <p className="text-caption text-muted">
          Enter the customer&apos;s phone number. If they already have a DRAEP account,
          their saved addresses will be available.
        </p>
        <PhoneLookupField
          countryCode={countryCode}
          onCountryCodeChange={draft.setCountryCode}
          phone={phoneInput}
          onPhoneChange={(p) => setPhoneInput(p)}
          touched={phoneTouched}
          onBlur={() => setPhoneTouched(true)}
          searching={searching}
          autoFocus
        />
        <UserLookupResultPanel
          searched={searched}
          foundUser={foundUser}
          nonCustomerRole={blockedRole}
          searching={searching}
          newUserName={newUserName}
          onNewUserNameChange={setNewUserName}
          fallbackCountryCode={countryCode}
          note={foundUser ? LOOKUP_NOTE : undefined}
        />
        <Button fullWidth disabled={!canSubmitPhone} onClick={handleSubmitPhone}>
          Send OTP
        </Button>
      </div>
    </div>
  );
}

export default function WalkInPage() {
  return (
    <Suspense
      fallback={
        <div className="mx-auto max-w-lg px-4 py-10 text-center text-caption text-muted">
          Loading…
        </div>
      }
    >
      <WalkInStart />
    </Suspense>
  );
}
