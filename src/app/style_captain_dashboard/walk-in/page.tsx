"use client";

/**
 * Walk-in v2 wizard — WALKIN_V2_PLAN.md §5.
 *
 * Steps 1–2: phone → OTP → name → address → order created. Step 3: garment
 * pick → per-garment configuration (SelectionSheet against garment_order_id)
 * → review + QR. Step 4: hard block — manual Check Now, no polling. Resume
 * via `?order=<id>` (§4.7 snapshot).
 *
 * Durable state lives on the server (§2 stage machine); the pure reducer in
 * `lib/walkin-state.ts` owns the client-only wizard steps.
 */

import { Suspense, useEffect, useMemo, useReducer, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";

import {
  AddressPicker,
  EMPTY_NEW_ADDRESS,
  type SavedAddress,
} from "@/components/shared/AddressPicker";
import { PhoneLookupField } from "@/components/shared/PhoneLookupField";
import { UserLookupResultPanel, type LookupUser } from "@/components/shared/UserLookupResultPanel";
import { SelectionSheet } from "@/components/style-captain/SelectionSheet";
import { WalkInQrCard } from "@/components/style-captain/WalkInQrCard";
import { ArrowLeft } from "@/components/ui/icons";
import { Button } from "@/components/ui/Button";
import { isValidNationalPhone } from "@/lib/phone";
import { garmentName } from "@/lib/sc-helpers";
import {
  GO_BACK_STEPS,
  initialState,
  walkInReducer,
  walkInTokenExpired,
} from "@/lib/walkin-state";
import { walkInPayUrl } from "@/lib/walkin-qr";
import {
  scFetchCatalogueGarments,
  scWalkInAddGarment,
  scWalkInCancelOrder,
  scWalkInCreateOrder,
  scWalkInOrderSnapshot,
  scWalkInOrderStatus,
  scWalkInOtpSend,
  scWalkInOtpVerify,
  scWalkInStartMeasurement,
  scWalkInUserLookup,
  type SCGarmentBrief,
  type SCWalkInCreateOrderInput,
  type SCWalkInOrderSnapshot,
} from "@/lib/style-captain-api";

const OTP_LENGTH = 4; // real MSG91 OTPs are always 4 digits
const RESEND_SECONDS = 30;
const LOOKUP_DEBOUNCE_MS = 350;

/** Existing-user note shown inside the green lookup panel. */
const LOOKUP_NOTE =
  "Booking for someone else? Please use their own phone number — OTP and order access are tied to it.";

const STEP_TITLES: Record<string, string> = {
  phone: "Customer's phone",
  otp: "Verify customer",
  name: "New customer",
  address: "Delivery address",
  "order-created": "Order created",
  "garment-pick": "Choose a garment",
  "garment-config": "Configure garment",
  review: "Review order",
  wait: "Waiting for payment",
  done: "Measurement started",
  cancelled: "Walk-in dropped",
};

const inputCls =
  "w-full rounded-card border border-hairline-strong bg-chalk-white px-4 py-3 text-body " +
  "focus:border-accent-text focus:ring-2 focus:ring-accent-text/30 focus:outline-none";

const bannerCls =
  "rounded-card border border-error-border bg-error-bg px-4 py-3 text-caption text-error-text";

function WalkInWizard() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [state, dispatch] = useReducer(walkInReducer, undefined, () => initialState());

  // ── Page-owned API/lookup state (the reducer stays pure) ─────────────────
  const [countryCode, setCountryCode] = useState("+91");
  const [phoneInput, setPhoneInput] = useState("");
  const [phoneTouched, setPhoneTouched] = useState(false);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);
  const [foundUser, setFoundUser] = useState<LookupUser | null>(null);
  const [blockedRole, setBlockedRole] = useState<string | null>(null);
  const [newUserName, setNewUserName] = useState("");
  const [savedAddresses, setSavedAddresses] = useState<SavedAddress[]>([]);

  // The lookup response's user id isn't wizard state — keep the last matched
  // customer id here for the create-order call (§4.4 user_id).
  const lookupUserIdRef = useRef<string | null>(null);

  const [otp, setOtp] = useState("");
  const [otpSending, setOtpSending] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);

  const [nameInput, setNameInput] = useState("");

  const [selectedAddressId, setSelectedAddressId] = useState("");
  const [showNewForm, setShowNewForm] = useState(false);
  const [newAddress, setNewAddress] = useState(EMPTY_NEW_ADDRESS);
  const [pinCoords, setPinCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [skipChecked, setSkipChecked] = useState(false);
  const [creatingOrder, setCreatingOrder] = useState(false);

  const [pageError, setPageError] = useState<string | null>(null);
  const [resuming, setResuming] = useState(false);
  const [resumeError, setResumeError] = useState<string | null>(null);

  // ── Step 3: garment pick / config / review (§5.4–§5.5) ───────────────────
  const [catalogue, setCatalogue] = useState<SCGarmentBrief[]>([]);
  const [catalogueError, setCatalogueError] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<SCWalkInOrderSnapshot | null>(null);
  /** garment_order_id the SelectionSheet is editing (config step). */
  const [activeGarmentOrderId, setActiveGarmentOrderId] = useState<string | null>(null);
  /** garment_id currently being added — disables its card while in flight. */
  const [addingGarment, setAddingGarment] = useState<string | null>(null);

  const phoneValid = isValidNationalPhone(phoneInput);
  const isNewUserLookup = searched && !foundUser && !blockedRole;
  const nameValid = newUserName.trim().length >= 2;
  const canSubmitPhone =
    phoneValid && !searching && !blockedRole && (!isNewUserLookup || nameValid);

  // ── Debounced lookup (§4.1) — admin-parity validation, 10-digit trigger ──
  useEffect(() => {
    if (state.step !== "phone") return;
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
          if (addrs.length === 1) setSelectedAddressId(addrs[0].id);
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
  }, [phoneInput, countryCode, state.step]);

  // ── Auto-send the OTP exactly once per phone when the step flips ─────────
  const sentForRef = useRef<string | null>(null);
  useEffect(() => {
    if (state.step !== "otp") return;
    const key = `${countryCode}${state.phone}`;
    if (sentForRef.current === key) return;
    sentForRef.current = key;
    void handleSendOtp();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.step, state.phone, countryCode]);

  // Resend cooldown ticker.
  useEffect(() => {
    if (resendCooldown <= 0) return;
    const timer = setTimeout(() => setResendCooldown((c) => c - 1), 1000);
    return () => clearTimeout(timer);
  }, [resendCooldown]);

  // Clear stale API errors whenever the step moves on.
  useEffect(() => {
    setPageError(null);
  }, [state.step]);

  // Seed the name input from whatever the captain typed at lookup time.
  useEffect(() => {
    if (state.step === "name") setNameInput(state.customerName ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.step]);

  // ── Verification-token watchdog (§4.3 — 15 min window) ───────────────────
  useEffect(() => {
    if (state.step !== "name" && state.step !== "address") return;
    if (!state.tokenExpiresAt) return;
    const check = () => {
      if (walkInTokenExpired(state.tokenExpiresAt)) {
        dispatch({ type: "TOKEN_EXPIRED" });
      }
    };
    check();
    const interval = setInterval(check, 15_000);
    return () => clearInterval(interval);
  }, [state.step, state.tokenExpiresAt]);

  // ── Resume: /style_captain_dashboard/walk-in?order=<id> (§4.7) ───────────
  const resumeId = searchParams.get("order");
  useEffect(() => {
    if (!resumeId) return;
    let cancelled = false;
    setResuming(true);
    scWalkInOrderSnapshot(resumeId)
      .then((snap) => {
        if (cancelled) return;
        // The review screen renders garments straight from the snapshot —
        // keep it beside the reducer so resume lands with data in hand.
        setSnapshot(snap);
        dispatch({ type: "RESUME", snapshot: snap });
      })
      .catch((err) => {
        if (!cancelled) {
          setResumeError(err instanceof Error ? err.message : "Could not load this walk-in.");
        }
      })
      .finally(() => {
        if (!cancelled) setResuming(false);
      });
    return () => {
      cancelled = true;
    };
  }, [resumeId]);

  // ── Catalogue (§4.5 garment pick list) — cached for the session ──────────
  const catalogueLoadedRef = useRef(false);
  useEffect(() => {
    if (state.step !== "garment-pick" || catalogueLoadedRef.current) return;
    catalogueLoadedRef.current = true;
    setCatalogueError(null);
    scFetchCatalogueGarments()
      .then((rows) => {
        setCatalogue(rows);
      })
      .catch((err) => {
        // Allow a retry the next time the step is entered.
        catalogueLoadedRef.current = false;
        setCatalogueError(err instanceof Error ? err.message : "Could not load the catalogue");
      });
  }, [state.step]);

  // ── Handlers ──────────────────────────────────────────────────────────────
  function resetAll() {
    dispatch({ type: "RESET" });
    sentForRef.current = null;
    setPhoneInput("");
    setPhoneTouched(false);
    setSearched(false);
    setSearching(false);
    setFoundUser(null);
    setBlockedRole(null);
    setNewUserName("");
    setSavedAddresses([]);
    setOtp("");
    setResendCooldown(0);
    setNameInput("");
    setSelectedAddressId("");
    setShowNewForm(false);
    setNewAddress(EMPTY_NEW_ADDRESS);
    setPinCoords(null);
    setSkipChecked(false);
    setSnapshot(null);
    setActiveGarmentOrderId(null);
    setAddingGarment(null);
    setPageError(null);
  }

  async function handleSendOtp() {
    setOtpSending(true);
    setPageError(null);
    try {
      await scWalkInOtpSend(state.phone, countryCode);
      setResendCooldown(RESEND_SECONDS);
    } catch (err) {
      setPageError(err instanceof Error ? err.message : "Could not send the code");
    } finally {
      setOtpSending(false);
    }
  }

  async function handleVerifyOtp() {
    if (otp.length !== OTP_LENGTH || verifying) return;
    setVerifying(true);
    setPageError(null);
    try {
      const res = await scWalkInOtpVerify(state.phone, otp, countryCode);
      setOtp("");
      dispatch({ type: "OTP_VERIFIED", token: res.verification_token, expiresAt: res.expires_at });
    } catch (err) {
      setPageError(err instanceof Error ? err.message : "Verification failed");
    } finally {
      setVerifying(false);
    }
  }

  function handleSubmitPhone() {
    if (!canSubmitPhone) return;
    dispatch({
      type: "PHONE_SUBMITTED",
      phone: phoneInput,
      isNewUser: isNewUserLookup,
      customerName: isNewUserLookup ? newUserName.trim() : (foundUser?.name ?? null),
    });
  }

  async function handleCreateOrder() {
    if (creatingOrder) return;
    if (walkInTokenExpired(state.tokenExpiresAt)) {
      dispatch({ type: "TOKEN_EXPIRED" });
      return;
    }
    const usingNewForm =
      state.isNewUser || showNewForm || savedAddresses.length === 0;

    if (!skipChecked) {
      if (usingNewForm) {
        const a = newAddress;
        if (!a.address_line_1.trim() || !a.city.trim() || !a.state.trim() || !/^\d{6}$/.test(a.pincode)) {
          setPageError("Fill the required address fields (line 1, city, state, 6-digit pincode) or skip for now.");
          return;
        }
      } else if (!selectedAddressId) {
        setPageError("Pick a saved address, add a new one, or skip for now.");
        return;
      }
    }

    const input: SCWalkInCreateOrderInput = {
      verification_token: state.verificationToken ?? "",
    };
    if (state.isNewUser) {
      input.new_user = {
        name: state.customerName ?? newUserName.trim(),
        phone: state.phone,
        country_code: countryCode,
      };
    } else {
      if (!lookupUserIdRef.current) {
        setPageError("Missing customer reference — go back and re-verify the OTP.");
        return;
      }
      input.user_id = lookupUserIdRef.current;
    }
    if (!skipChecked) {
      if (usingNewForm) {
        input.new_address = {
          address_line_1: newAddress.address_line_1.trim(),
          address_line_2: newAddress.address_line_2.trim() || null,
          city: newAddress.city.trim(),
          state: newAddress.state.trim(),
          pincode: newAddress.pincode.trim(),
          coordinates:
            pinCoords && Number.isFinite(pinCoords.lat) && Number.isFinite(pinCoords.lng)
              ? pinCoords
              : null,
        };
      } else {
        input.address_id = selectedAddressId;
      }
    }

    setCreatingOrder(true);
    setPageError(null);
    try {
      const res = await scWalkInCreateOrder(input);
      dispatch({
        type: "ORDER_CREATED",
        orderId: res.order_id,
        orderNumber: res.order_number,
        userId: res.user_id,
        isNewUser: res.is_new_user,
      });
    } catch (err) {
      setPageError(err instanceof Error ? err.message : "Could not create the order");
    } finally {
      setCreatingOrder(false);
    }
  }

  /** Re-fetch the §4.7 snapshot into page state; null on failure (pageError set). */
  async function refreshSnapshot(orderId: string): Promise<SCWalkInOrderSnapshot | null> {
    try {
      const snap = await scWalkInOrderSnapshot(orderId);
      setSnapshot(snap);
      return snap;
    } catch (err) {
      setPageError(err instanceof Error ? err.message : "Could not refresh the order");
      return null;
    }
  }

  async function handleAddGarment(garmentId: string) {
    if (!state.orderId || addingGarment) return;
    setAddingGarment(garmentId);
    setPageError(null);
    try {
      const res = await scWalkInAddGarment(state.orderId, garmentId);
      await refreshSnapshot(state.orderId);
      // Defaults are materialized server-side; the sheet edits whatever the
      // snapshot now carries.
      setActiveGarmentOrderId(res.garment_order_id);
      dispatch({ type: "GARMENT_PICKED" });
    } catch (err) {
      setPageError(err instanceof Error ? err.message : "Could not add the garment");
    } finally {
      setAddingGarment(null);
    }
  }

  /** SelectionSheet closed (saved via Done or cancelled — defaults kept). */
  function handleConfigClosed() {
    if (!state.orderId) return;
    void refreshSnapshot(state.orderId);
    dispatch({ type: "GARMENT_CONFIG_DONE" });
  }

  function handleEditGarment(garmentOrderId: string) {
    setActiveGarmentOrderId(garmentOrderId);
    dispatch({ type: "EDIT_GARMENT" });
  }

  async function handleCheckNow() {
    if (!state.orderId || state.checking) return;
    dispatch({ type: "CHECK_NOW_START" });
    try {
      const res = await scWalkInOrderStatus(state.orderId);
      dispatch({
        type: "CHECK_NOW_RESULT",
        ready: res.ready_for_measurement,
        codSelected: res.cod_selected,
        fulfillmentStatus: res.fulfillment_status,
        now: Date.now(),
      });
    } catch (err) {
      dispatch({
        type: "CHECK_NOW_ERROR",
        message: err instanceof Error ? err.message : "Could not check payment status",
      });
    }
  }

  async function handleStartMeasurement() {
    if (!state.orderId || !state.paid) return;
    setPageError(null);
    try {
      const res = await scWalkInStartMeasurement(state.orderId);
      dispatch({ type: "MEASUREMENT_STARTED", jobId: res.job_id });
    } catch (err) {
      setPageError(err instanceof Error ? err.message : "Could not start the measurement");
    }
  }

  async function handleDrop() {
    if (!state.orderId) return;
    if (!window.confirm("Drop this walk-in? The draft order will be cancelled.")) return;
    setPageError(null);
    try {
      await scWalkInCancelOrder(state.orderId);
      dispatch({ type: "WALKIN_CANCELLED" });
    } catch (err) {
      setPageError(err instanceof Error ? err.message : "Could not drop the walk-in");
    }
  }

  const lastCheckedLabel = useMemo(() => {
    if (!state.lastCheckedAt) return null;
    return new Date(state.lastCheckedAt).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });
  }, [state.lastCheckedAt]);

  /** Snapshot garment backing the open SelectionSheet. */
  const activeGarment = useMemo(
    () =>
      snapshot?.garments.find((g) => g.garment_order_id === activeGarmentOrderId) ??
      null,
    [snapshot, activeGarmentOrderId],
  );

  const hasGarments = (snapshot?.garments.length ?? 0) > 0;

  // The QR encodes the direct app order URL (§5.5) — same renderer as the
  // shortlink QRs.
  const payUrl = state.orderId
    ? walkInPayUrl(window.location.origin, state.orderId, state.phone)
    : null;

  const backTarget = GO_BACK_STEPS[state.step];

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

  return (
    <div className="mx-auto min-h-screen max-w-lg px-4 pb-28 pt-6">
      {/* Header */}
      <div className="mb-6 flex items-center gap-3">
        {(state.step === "phone" || backTarget) && (
          <button
            onClick={() => {
              if (state.step === "phone") router.push("/style_captain_dashboard");
              else dispatch({ type: "GO_BACK" });
            }}
            aria-label="Go back"
            className="rounded-full border border-hairline-strong bg-chalk-white p-2 text-ink transition hover:bg-mist-navy/20"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
        )}
        <div>
          <div className="text-eyebrow text-accent-text">Walk-in</div>
          <h1 className="font-heading text-head-3 text-ink">
            {STEP_TITLES[state.step] ?? "Walk-in"}
          </h1>
        </div>
      </div>

      {(state.error || pageError) && (
        <div className={`mb-4 ${bannerCls}`}>{state.error ?? pageError}</div>
      )}

      {/* ── Step 1: phone + lookup ───────────────────────────────────────── */}
      {state.step === "phone" && (
        <div className="space-y-4">
          <p className="text-caption text-muted">
            Enter the customer&apos;s phone number. If they already have a DRAEP account,
            their saved addresses will be available.
          </p>
          <PhoneLookupField
            countryCode={countryCode}
            onCountryCodeChange={setCountryCode}
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
          <Button
            fullWidth
            disabled={!canSubmitPhone}
            onClick={handleSubmitPhone}
          >
            Send OTP
          </Button>
        </div>
      )}

      {/* ── Step 1.1: OTP typed by the captain ───────────────────────────── */}
      {state.step === "otp" && (
        <div className="space-y-4">
          <p className="text-caption text-muted">
            Ask the customer to read the 4-digit code from their SMS. Sent to{" "}
            <span className="font-medium text-ink">
              {countryCode} {state.phone}
            </span>
            .
          </p>
          <input
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            autoFocus
            maxLength={OTP_LENGTH}
            value={otp}
            onChange={(e) => setOtp(e.target.value.replace(/\D/g, "").slice(0, OTP_LENGTH))}
            onKeyDown={(e) => e.key === "Enter" && void handleVerifyOtp()}
            placeholder="••••"
            className={`${inputCls} text-center font-mono text-2xl tracking-[0.5em]`}
          />
          <div className="flex items-center justify-between text-caption text-muted">
            <span>Didn&apos;t arrive?</span>
            {resendCooldown > 0 ? (
              <span>Resend in {resendCooldown}s</span>
            ) : (
              <button
                onClick={() => void handleSendOtp()}
                disabled={otpSending}
                className="text-accent-text underline disabled:opacity-50"
              >
                {otpSending ? "Sending…" : "Resend code"}
              </button>
            )}
          </div>
          <Button
            fullWidth
            loading={verifying}
            disabled={otp.length !== OTP_LENGTH}
            onClick={() => void handleVerifyOtp()}
          >
            Verify code
          </Button>
        </div>
      )}

      {/* ── New-customer name ────────────────────────────────────────────── */}
      {state.step === "name" && (
        <div className="space-y-4">
          <p className="text-caption text-muted">
            A new DRAEP account will be created for this number.
          </p>
          <div>
            <label className="mb-1 block text-caption font-medium text-muted">
              Customer name <span className="text-error-text">*</span>
            </label>
            <input
              type="text"
              autoFocus
              value={nameInput}
              onChange={(e) => setNameInput(e.target.value)}
              onKeyDown={(e) =>
                e.key === "Enter" && nameInput.trim().length >= 2 &&
                dispatch({ type: "NAME_CONFIRMED", name: nameInput.trim() })
              }
              placeholder="Full name"
              className={inputCls}
            />
          </div>
          <Button
            fullWidth
            disabled={nameInput.trim().length < 2}
            onClick={() => dispatch({ type: "NAME_CONFIRMED", name: nameInput.trim() })}
          >
            Continue
          </Button>
        </div>
      )}

      {/* ── Step 2: address ──────────────────────────────────────────────── */}
      {state.step === "address" && (
        <div className="space-y-4">
          <AddressPicker
            customerName={state.customerName}
            hasExistingCustomer={!state.isNewUser}
            addresses={savedAddresses}
            selectedId={selectedAddressId}
            onSelect={setSelectedAddressId}
            showNewForm={showNewForm}
            onShowNewFormChange={(show) => {
              setShowNewForm(show);
              if (show) setSkipChecked(false);
            }}
            newAddress={newAddress}
            onNewAddressChange={setNewAddress}
            pinCoords={pinCoords}
            onPinCoordsChange={setPinCoords}
            skipChecked={skipChecked}
            onSkipChange={setSkipChecked}
          />
          <Button
            fullWidth
            loading={creatingOrder}
            onClick={() => void handleCreateOrder()}
          >
            Create walk-in order
          </Button>
        </div>
      )}

      {/* ── Step 3 entry: order created ──────────────────────────────────── */}
      {state.step === "order-created" && (
        <div className="space-y-5">
          <div className="rounded-card border border-green-200 bg-green-50 px-4 py-4">
            <div className="text-caption font-semibold text-green-800">
              ✓ Order {state.orderNumber} created for{" "}
              {state.customerName ?? "the customer"}
            </div>
            <div className="mt-1 text-[11px] text-green-900/80">
              An empty draft order is saved against {countryCode} {state.phone}. Next,
              configure the garments they picked in-store.
            </div>
          </div>
          <Button fullWidth onClick={() => dispatch({ type: "BEGIN_GARMENTS" })}>
            Add garments
          </Button>
        </div>
      )}

      {/* ── Step 3a: garment pick (§5.4) ─────────────────────────────────── */}
      {state.step === "garment-pick" && (
        <div className="space-y-4">
          <div className="text-caption text-muted">
            Tap a garment the customer is ordering — it&apos;s added to order{" "}
            {state.orderNumber} with catalog defaults you can edit next.
          </div>
          {catalogueError && <div className={bannerCls}>{catalogueError}</div>}
          {catalogue.length === 0 && !catalogueError && (
            <div className="rounded-card border border-hairline bg-mist-navy/10 px-4 py-6 text-center text-caption text-muted">
              Loading garments…
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            {catalogue.map((g) => (
              <button
                key={g.id}
                onClick={() => void handleAddGarment(g.id)}
                disabled={addingGarment !== null}
                className={`tap rounded-card border px-4 py-5 text-left text-body font-medium transition ${
                  addingGarment === g.id
                    ? "border-ink-navy bg-mist-navy/30 text-ink-navy"
                    : "border-hairline-strong bg-chalk-white text-ink hover:bg-mist-navy/10"
                } disabled:opacity-50`}
              >
                {addingGarment === g.id ? "Adding…" : garmentName(g)}
              </button>
            ))}
          </div>
          {hasGarments && (
            <Button
              fullWidth
              variant="secondary"
              onClick={() => dispatch({ type: "REVIEW_NOW", hasGarments: true })}
            >
              Review order
            </Button>
          )}
        </div>
      )}

      {/* ── Step 3b: per-garment configuration (§5.4) ──────────────────────
          The measure-flow SelectionSheet, minus the checklist diff — no job
          exists yet, so jobId stays omitted. Cancel keeps server defaults. */}
      {state.step === "garment-config" &&
        (activeGarment ? (
          <SelectionSheet
            garmentOrderId={activeGarment.garment_order_id}
            selections={activeGarment.selections}
            availableAddons={activeGarment.available_addons}
            onClose={handleConfigClosed}
            onDone={handleConfigClosed}
          />
        ) : (
          <div className="space-y-4">
            <div className={bannerCls}>
              Could not load this garment&apos;s configuration.
            </div>
            <Button
              fullWidth
              variant="secondary"
              onClick={() => state.orderId && void refreshSnapshot(state.orderId)}
            >
              Retry
            </Button>
            <Button fullWidth onClick={() => dispatch({ type: "GO_BACK" })}>
              Back
            </Button>
          </div>
        ))}

      {/* ── Step 3c: review + QR (§5.5) ──────────────────────────────────── */}
      {state.step === "review" && (
        <div className="space-y-5">
          <div className="rounded-card border border-hairline bg-chalk-white p-4">
            <div className="flex items-baseline justify-between">
              <div className="text-body font-semibold text-ink">
                Order {state.orderNumber}
              </div>
              {snapshot?.total_price != null && (
                <div className="text-body font-semibold text-ink">
                  ₹{snapshot.total_price.toLocaleString("en-IN")}
                </div>
              )}
            </div>
            <div className="mt-0.5 text-caption text-muted">
              {state.customerName ?? "Customer"} · {countryCode} {state.phone}
            </div>
          </div>

          <div className="space-y-2">
            <div className="text-caption font-medium text-muted">Garments</div>
            {(snapshot?.garments ?? []).map((g) => (
              <div
                key={g.garment_order_id}
                className="flex items-center justify-between rounded-card border border-hairline-strong bg-chalk-white px-4 py-3"
              >
                <div className="text-body text-ink">{g.label}</div>
                <button
                  onClick={() => handleEditGarment(g.garment_order_id)}
                  className="text-caption font-medium text-ink-navy underline"
                >
                  Edit
                </button>
              </div>
            ))}
            {snapshot && snapshot.garments.length === 0 && (
              <div className="rounded-card border border-hairline bg-mist-navy/10 px-4 py-3 text-caption text-muted">
                No garments yet — add one to continue.
              </div>
            )}
          </div>

          <Button
            fullWidth
            variant="secondary"
            onClick={() => dispatch({ type: "ADD_ANOTHER_GARMENT" })}
          >
            + Add another garment
          </Button>

          {payUrl && (
            <WalkInQrCard
              url={payUrl}
              caption="Ask the customer to scan — the order opens in the Draep app for payment."
            />
          )}

          <Button
            fullWidth
            disabled={!hasGarments}
            onClick={() => dispatch({ type: "QR_SHOWN" })}
          >
            Continue — wait for payment
          </Button>
        </div>
      )}

      {/* ── Step 4: hard block — manual Check Now only (§5.6) ────────────── */}
      {state.step === "wait" && (
        <div className="space-y-5">
          <div className="rounded-card border border-hairline-strong bg-chalk-white px-4 py-3 text-center">
            <div className="text-body font-medium text-ink">
              Waiting for payment — order {state.orderNumber}
            </div>
            <div className="mt-1 text-caption text-muted">
              The customer must pay (or choose COD) in the app before the
              measurement can start. Re-show the QR below.
            </div>
          </div>

          {payUrl && (
            <WalkInQrCard
              url={payUrl}
              caption="Customer scans → pays in the Draep app. Then tap Check now."
            />
          )}

          {state.paid && (
            <div className="rounded-card border border-green-200 bg-green-50 px-4 py-3 text-caption font-medium text-green-800">
              ✓ Payment confirmed{state.codSelected ? " (Cash on delivery)" : ""} — you can
              start the measurement.
            </div>
          )}

          <Button
            fullWidth
            variant="secondary"
            loading={state.checking}
            onClick={() => void handleCheckNow()}
          >
            Check now
          </Button>
          {lastCheckedLabel && !state.paid && (
            <div className="text-center text-[11px] text-muted">
              Last checked {lastCheckedLabel}
            </div>
          )}

          <div className="space-y-2 pt-2">
            <Button
              fullWidth
              disabled={!state.paid}
              onClick={() => void handleStartMeasurement()}
            >
              Start measurement
            </Button>
            {!state.paid && (
              <button
                onClick={() => void handleDrop()}
                className="w-full text-center text-caption text-error-text underline"
              >
                Drop this walk-in
              </button>
            )}
          </div>
        </div>
      )}

      {/* ── Terminal states ──────────────────────────────────────────────── */}
      {state.step === "done" && (
        <div className="space-y-5">
          <div className="rounded-card border border-green-200 bg-green-50 px-4 py-4 text-caption text-green-800">
            <span className="font-semibold">✓ Measurement started.</span> Order{" "}
            {state.orderNumber} moved to the measurement wizard.
          </div>
          <Link href="/style_captain_dashboard">
            <Button fullWidth>Back to dashboard</Button>
          </Link>
        </div>
      )}
      {state.step === "cancelled" && (
        <div className="space-y-5">
          <div className="rounded-card border border-hairline-strong bg-chalk-white px-4 py-4 text-caption text-muted">
            This walk-in was dropped. The draft order stays cancelled.
          </div>
          <Button fullWidth onClick={resetAll}>
            Start a new walk-in
          </Button>
        </div>
      )}
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
      <WalkInWizard />
    </Suspense>
  );
}
