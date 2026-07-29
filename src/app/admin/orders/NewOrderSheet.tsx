"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { MapPinPicker } from "@/components/contact/MapPinPicker";
import {
  searchAddresses,
  reverseGeocode,
  type GeocodeAddressResult,
} from "@/lib/api/geocode";
import {
  createOrder,
  createTableRow,
  fetchTableRows,
  fetchGarments,
  fetchStyleCaptains,
  fetchOpenSlots,
  garmentLabel,
  fetchJobReadings,
  type UserRow,
  type AddressRow,
  type GarmentRow,
  type GarmentOrderItemRow,
  type MeasurementJobRow,
  type JobStatus,
  type AdminDaySlots,
  type AdminSlotOption,
} from "@/lib/admin-api";
import { GarmentOrderEditor, type DraftItem } from "./[id]/GarmentOrderEditor";

// ─── Types ────────────────────────────────────────────────────────────────────

interface GarmentDraft {
  id: string; // unique key for React
  garmentId: string;
  draftItems: DraftItem[];
  computedTotal: number;
}

interface NewOrderSheetProps {
  open: boolean;
  onClose: () => void;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const STEPS = ["Customer", "Garments & Style", "Address", "Measurement Job"] as const;

function formatPrice(v: number | null | undefined): string {
  if (v === null || v === undefined) return "—";
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(v);
}

function truncateId(id: string): string {
  return id.slice(0, 8);
}

/** Convert "HH:MM" (24-hour) → "h:MM AM/PM" for display. */
function formatTimeLabel(hhmm: string): string {
  const [hStr, m] = hhmm.split(":");
  const h = parseInt(hStr, 10);
  const ampm = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${m} ${ampm}`;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function NewOrderSheet({ open, onClose }: NewOrderSheetProps) {
  const router = useRouter();

  const [step, setStep] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ── Step 1: Customer ──────────────────────────────────────────────────────
  const [phoneInput, setPhoneInput] = useState("");
  const [foundUser, setFoundUser] = useState<UserRow | null>(null);
  const [searchingUser, setSearchingUser] = useState(false);
  const [newUserName, setNewUserName] = useState("");
  const [userSearched, setUserSearched] = useState(false);
  const [nonCustomerRole, setNonCustomerRole] = useState<string | null>(null);
  const phoneTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Step 2: Garments ──────────────────────────────────────────────────────
  const [garments, setGarments] = useState<GarmentRow[]>([]);
  const [garmentsLoading, setGarmentsLoading] = useState(false);
  const [garmentDrafts, setGarmentDrafts] = useState<GarmentDraft[]>([]);
  const draftIdCounter = useRef(0);

  // ── Step 3: Address ───────────────────────────────────────────────────────
  const [addresses, setAddresses] = useState<AddressRow[]>([]);
  const [addressesLoading, setAddressesLoading] = useState(false);
  const [selectedAddressId, setSelectedAddressId] = useState<string>("");
  const [showNewAddressForm, setShowNewAddressForm] = useState(false);
  const [newAddr, setNewAddr] = useState({
    address_line_1: "",
    address_line_2: "",
    city: "",
    state: "",
    pincode: "",
  });

  // Address autocomplete search
  const [addrSearch, setAddrSearch] = useState("");
  const [addrResults, setAddrResults] = useState<GeocodeAddressResult[]>([]);
  const [addrDropdownOpen, setAddrDropdownOpen] = useState(false);
  const [addrSearching, setAddrSearching] = useState(false);
  const [pinCoords, setPinCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [flyTo, setFlyTo] = useState<{ lat: number; lng: number; nonce: number } | undefined>(undefined);
  const [reverseLookupLoading, setReverseLookupLoading] = useState(false);
  const addrSearchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flyNonceRef = useRef(0);

  // ── Step 4: Measurement Job ───────────────────────────────────────────────
  const [existingJobs, setExistingJobs] = useState<MeasurementJobRow[]>([]);
  const [hasPreviousMeasurements, setHasPreviousMeasurements] = useState(false);
  const [jobsLoading, setJobsLoading] = useState(false);
  const [jobChoice, setJobChoice] = useState<"skip" | "schedule" | "reuse">("schedule");
  const [slotDays, setSlotDays] = useState<AdminDaySlots[]>([]);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [slotsError, setSlotsError] = useState<string | null>(null);
  const [selectedSlotDate, setSelectedSlotDate] = useState<string | undefined>();
  const [selectedSlot, setSelectedSlot] = useState<AdminSlotOption | undefined>();
  const [captains, setCaptains] = useState<UserRow[]>([]);
  const [selectedCaptainId, setSelectedCaptainId] = useState("");

  // ── Reset everything on close ─────────────────────────────────────────────
  function fullReset() {
    setStep(0);
    setError(null);
    setPhoneInput("");
    setFoundUser(null);
    setNewUserName("");
    setUserSearched(false);
    setNonCustomerRole(null);
    setGarmentDrafts([]);
    setAddresses([]);
    setSelectedAddressId("");
    setShowNewAddressForm(false);
    setNewAddr({ address_line_1: "", address_line_2: "", city: "", state: "", pincode: "" });
    setAddrSearch("");
    setAddrResults([]);
    setAddrDropdownOpen(false);
    setPinCoords(null);
    setFlyTo(undefined);
    setReverseLookupLoading(false);
    setExistingJobs([]);
    setHasPreviousMeasurements(false);
    setJobChoice("schedule");
    setSlotDays([]);
    setSlotsLoading(false);
    setSlotsError(null);
    setSelectedSlotDate(undefined);
    setSelectedSlot(undefined);
    setSelectedCaptainId("");
  }

  function handleClose() {
    fullReset();
    onClose();
  }

  // ── Phone search (debounced) ──────────────────────────────────────────────
  useEffect(() => {
    if (phoneTimer.current) clearTimeout(phoneTimer.current);
    if (!phoneInput.trim() || phoneInput.trim().length < 4) {
      setFoundUser(null);
      setUserSearched(false);
      setNonCustomerRole(null);
      return;
    }
    setSearchingUser(true);
    phoneTimer.current = setTimeout(async () => {
      try {
        const { rows } = await fetchTableRows<UserRow>("users", {
          filters: { phone: phoneInput.trim() },
          perPage: 1,
        });
        const user = rows[0] ?? null;
        if (user && user.role && user.role !== "customer") {
          // Exists but is not a customer (e.g. style_captain, admin)
          setFoundUser(null);
          setNonCustomerRole(user.role);
          setUserSearched(true);
        } else {
          setFoundUser(user);
          setNonCustomerRole(null);
          setUserSearched(true);
        }
      } catch {
        setFoundUser(null);
        setUserSearched(true);
      } finally {
        setSearchingUser(false);
      }
    }, 350);
    return () => {
      if (phoneTimer.current) clearTimeout(phoneTimer.current);
    };
  }, [phoneInput]);

  // ── Load garments when sheet opens ────────────────────────────────────────
  useEffect(() => {
    if (!open || garments.length > 0) return;
    let cancelled = false;
    setGarmentsLoading(true);
    fetchGarments()
      .then((g) => {
        if (cancelled) return;
        setGarments(g);
        // Auto-draft the first garment so the user lands directly on the dropdown
        if (g.length > 0 && garmentDrafts.length === 0) {
          addGarmentDraft();
        }
      })
      .catch(() => {})
      .finally(() => !cancelled && setGarmentsLoading(false));
    return () => {
      cancelled = true;
    };
  }, [open, garments.length]);

  // ── Load captains when sheet opens ────────────────────────────────────────
  useEffect(() => {
    if (!open || captains.length > 0) return;
    fetchStyleCaptains()
      .then(setCaptains)
      .catch(() => {});
  }, [open, captains.length]);

  // ── Load open slots when entering step 4 ──────────────────────────────────
  useEffect(() => {
    if (!open || step !== 3 || slotDays.length > 0) return;
    setSlotsLoading(true);
    setSlotsError(null);
    fetchOpenSlots()
      .then((res) => {
        setSlotDays(res.days);
        if (res.days.length > 0 && !selectedSlotDate) {
          setSelectedSlotDate(res.days[0].date);
        }
      })
      .catch((e) => {
        setSlotsError(
          e instanceof Error ? e.message : "Couldn't load available slots.",
        );
      })
      .finally(() => setSlotsLoading(false));
  }, [open, step]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Load addresses & existing measurements when user is found ─────────────
  useEffect(() => {
    if (!foundUser) {
      setAddresses([]);
      setExistingJobs([]);
      setHasPreviousMeasurements(false);
      return;
    }
    setAddressesLoading(true);
    setJobsLoading(true);

    fetchTableRows<AddressRow>("addresses", {
      filters: { user_id: foundUser.id },
      perPage: 50,
    })
      .then(({ rows }) => setAddresses(rows))
      .catch(() => setAddresses([]))
      .finally(() => setAddressesLoading(false));

    fetchTableRows<MeasurementJobRow>("measurement_jobs", {
      filters: { user_id: foundUser.id },
      perPage: 50,
      sortColumn: "created_at",
      sortDirection: "desc",
    })
      .then(async ({ rows }) => {
        setExistingJobs(rows);
        // Check if any completed job has actual readings
        const completedJobs = rows.filter((j) => j.status === "completed");
        for (const job of completedJobs) {
          try {
            const readings = await fetchJobReadings(job.id);
            if (readings.length > 0) {
              setHasPreviousMeasurements(true);
              return;
            }
          } catch {
            /* ignore */
          }
        }
        setHasPreviousMeasurements(false);
      })
      .catch(() => {
        setExistingJobs([]);
        setHasPreviousMeasurements(false);
      })
      .finally(() => setJobsLoading(false));
  }, [foundUser]);

  // ── Computed total across all garment drafts ───────────────────────────────
  const grandTotal = useMemo(
    () => garmentDrafts.reduce((sum, g) => sum + g.computedTotal, 0),
    [garmentDrafts],
  );

  // ── Slots for the currently selected date ──────────────────────────────────
  const currentDaySlots = useMemo(
    () => slotDays.find((d) => d.date === selectedSlotDate)?.slots ?? [],
    [slotDays, selectedSlotDate],
  );

  // ── Captains available at the selected slot ────────────────────────────────
  const availableCaptains = useMemo(
    () =>
      selectedSlot
        ? captains.filter((c) => selectedSlot.captain_ids.includes(c.id))
        : [],
    [selectedSlot, captains],
  );

  // ── Step validation ───────────────────────────────────────────────────────
  const stepValid = useMemo(() => {
    switch (step) {
      case 0: // Customer
        if (foundUser) return true;
        return userSearched && !foundUser && newUserName.trim().length > 0;
      case 1: // Garments
        return garmentDrafts.length > 0 && garmentDrafts.every((g) => g.garmentId);
      case 2: // Address
        // The new-address form is active when:
        //   - user explicitly toggled it on, OR
        //   - there are no existing addresses to choose from, OR
        //   - it's a brand-new user (no foundUser)
        const isNewAddressMode =
          showNewAddressForm || !foundUser || addresses.length === 0;
        if (isNewAddressMode) {
          return !!(
            newAddr.address_line_1.trim() &&
            newAddr.city.trim() &&
            newAddr.state.trim() &&
            newAddr.pincode.trim()
          );
        }
        return !!selectedAddressId;
      case 3: // Measurement job
        if (jobChoice === "skip") return true;
        if (jobChoice === "reuse") return true;
        return !!selectedSlot; // slot from picker; captain auto-assigned
      default:
        return false;
    }
  }, [step, foundUser, userSearched, newUserName, garmentDrafts, showNewAddressForm, newAddr, selectedAddressId, jobChoice, selectedSlot]);

  // ── Garment draft helpers ──────────────────────────────────────────────────
  function addGarmentDraft() {
    draftIdCounter.current += 1;
    setGarmentDrafts((prev) => [
      ...prev,
      {
        id: `draft-${draftIdCounter.current}`,
        garmentId: "",
        draftItems: [],
        computedTotal: 0,
      },
    ]);
  }

  function updateGarmentDraft(id: string, patch: Partial<GarmentDraft>) {
    setGarmentDrafts((prev) =>
      prev.map((g) => (g.id === id ? { ...g, ...patch } : g)),
    );
  }

  function removeGarmentDraft(id: string) {
    setGarmentDrafts((prev) => prev.filter((g) => g.id !== id));
  }

  // ── Submit ─────────────────────────────────────────────────────────────────
  async function handleSubmit() {
    setSubmitting(true);
    setError(null);
    try {
      // 1. Resolve customer
      let customerId: string;
      if (foundUser) {
        customerId = foundUser.id;
      } else {
        const newUser = await createTableRow<UserRow>("users", {
          name: newUserName.trim(),
          phone: phoneInput.trim(),
          role: "customer",
        });
        customerId = newUser.id;
      }

      // 2. Resolve address
      let addressId: string | null = null;
      const isNewAddressMode =
        showNewAddressForm || !foundUser || addresses.length === 0;
      if (isNewAddressMode) {
        const created = await createTableRow<AddressRow>("addresses", {
          user_id: customerId,
          address_line_1: newAddr.address_line_1.trim() || null,
          address_line_2: newAddr.address_line_2.trim() || null,
          city: newAddr.city.trim() || null,
          state: newAddr.state.trim() || null,
          pincode: newAddr.pincode.trim() || null,
          coordinates: pinCoords ?? null,
        });
        addressId = created.id;
      } else {
        addressId = selectedAddressId || null;
      }

      // 3. Create order
      const order = await createOrder({
        user_id: customerId,
        address_id: addressId,
        total_price: grandTotal > 0 ? grandTotal : null,
        fulfillment_status: "pending",
        payment_status: "pending",
      });

      // 4. Create garment orders + items
      for (const draft of garmentDrafts) {
        const garment = garments.find((g) => g.id === draft.garmentId);
        const basePrice = garment?.base_price ?? null;

        const go = await createTableRow<{ id: string }>("garment_orders", {
          order_id: order.id,
          garment_id: draft.garmentId,
          price: draft.computedTotal > 0 ? draft.computedTotal : basePrice,
          status: "pending",
        });

        for (const item of draft.draftItems) {
          await createTableRow<GarmentOrderItemRow>("garment_orders_items", {
            garment_order_id: go.id,
            type: item.type,
            garment_style_component_id: item.garment_style_component_id,
            variation_id: item.variation_id,
            variation_type_id: item.variation_type_id,
            addon_id: item.addon_id,
            addon_variation_id: item.addon_variation_id,
            placement: item.placement,
            price: item.price,
            label_snapshot: item.label_snapshot,
          });
        }
      }

      // 5. Create measurement job (if requested)
      if (jobChoice === "schedule" && selectedSlot) {
        await createTableRow<MeasurementJobRow>("measurement_jobs", {
          user_id: customerId,
          order_id: order.id,
          style_captain_id: selectedCaptainId || null,
          scheduled_at: selectedSlot.start_at,
          status: "scheduled" as JobStatus,
        });
      }

      handleClose();
      router.push(`/admin/orders/${order.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create order");
    } finally {
      setSubmitting(false);
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  const canGoBack = step > 0;
  const isLastStep = step === STEPS.length - 1;

  return (
    <BottomSheet
      open={open}
      onClose={handleClose}
      title="Create New Order"
      footer={
        <div className="flex items-center justify-between gap-3">
          <div className="text-xs text-muted">
            {garmentDrafts.length > 0 && (
              <span>Total: <span className="font-mono font-medium text-ink-navy">{formatPrice(grandTotal)}</span></span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {canGoBack && (
              <button
                onClick={() => setStep((s) => s - 1)}
                disabled={submitting}
                className="rounded-lg border border-hairline-strong px-4 py-2 text-xs font-medium text-ink transition hover:bg-mist-navy/30 disabled:opacity-40"
              >
                ← Back
              </button>
            )}
            {!isLastStep ? (
              <button
                onClick={() => setStep((s) => s + 1)}
                disabled={!stepValid || submitting}
                className="rounded-lg bg-ink-navy px-5 py-2 text-xs font-semibold text-chalk-white transition hover:bg-tape disabled:opacity-40"
              >
                Next →
              </button>
            ) : (
              <button
                onClick={handleSubmit}
                disabled={!stepValid || submitting}
                className="rounded-lg bg-green-700 px-5 py-2 text-xs font-semibold text-white transition hover:bg-green-800 disabled:opacity-40"
              >
                {submitting ? "Creating…" : "Create Order"}
              </button>
            )}
          </div>
        </div>
      }
    >
      {/* Step indicator */}
      <div className="mb-4 flex items-center gap-2">
        {STEPS.map((label, i) => (
          <div key={label} className="flex items-center gap-2">
            <div
              className={`flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-medium transition ${
                i < step
                  ? "bg-green-600 text-white"
                  : i === step
                    ? "bg-ink-navy text-chalk-white"
                    : "bg-mist-navy/40 text-muted"
              }`}
            >
              {i < step ? "✓" : i + 1}
            </div>
            <span className={`text-[11px] ${i === step ? "font-medium text-ink-navy" : "text-muted"}`}>
              {label}
            </span>
            {i < STEPS.length - 1 && <div className="mx-1 h-px w-4 bg-hairline-strong" />}
          </div>
        ))}
      </div>

      {/* Error */}
      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* ── Step 1: Customer ───────────────────────────────────────────────── */}
      {step === 0 && (
        <div className="space-y-4 pb-4">
          <div>
            <label className="mb-1 block text-xs font-medium text-muted">
              Phone number <span className="text-red-500">*</span>
            </label>
            <input
              type="tel"
              value={phoneInput}
              onChange={(e) => setPhoneInput(e.target.value)}
              placeholder="Enter customer phone number…"
              className="w-full rounded-lg border border-hairline-strong bg-chalk-white px-3 py-2.5 text-sm focus:border-ink-navy focus:outline-none"
              autoFocus
            />
            {searchingUser && (
              <div className="mt-1 text-[11px] text-muted">Searching…</div>
            )}
          </div>

          {/* Found user */}
          {userSearched && foundUser && (
            <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-3">
              <div className="text-xs font-medium text-green-800">✓ Existing user found</div>
              <div className="mt-1 text-sm font-medium text-ink">{foundUser.name ?? "Unnamed"}</div>
              <div className="text-[11px] text-muted">
                {foundUser.phone} {foundUser.email ? `• ${foundUser.email}` : ""}
              </div>
            </div>
          )}

          {/* Found but not a customer */}
          {userSearched && !foundUser && nonCustomerRole && !searchingUser && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-800">
              <div className="font-medium">This phone number belongs to a {nonCustomerRole.replace("_", " ")}, not a customer.</div>
              <div className="mt-0.5 opacity-80">
                Orders can only be created for customers. Please use a different phone number.
              </div>
            </div>
          )}

          {/* Not found → ask for name */}
          {userSearched && !foundUser && !nonCustomerRole && !searchingUser && (
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
                  onChange={(e) => setNewUserName(e.target.value)}
                  placeholder="Full name"
                  className="w-full rounded-lg border border-hairline-strong bg-chalk-white px-3 py-2.5 text-sm focus:border-ink-navy focus:outline-none"
                />
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Step 2: Garments & Style ──────────────────────────────────────── */}
      {step === 1 && (
        <div className="space-y-4 pb-4">
          {garmentDrafts.map((draft, idx) => (
            <div key={draft.id} className="rounded-xl border border-hairline bg-mist-navy/10 p-3">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-xs font-semibold text-ink-navy">Garment {idx + 1}</span>
                {garmentDrafts.length > 1 && (
                  <button
                    onClick={() => removeGarmentDraft(draft.id)}
                    className="text-[11px] text-red-600 hover:underline"
                  >
                    ✕ Remove
                  </button>
                )}
              </div>
              <select
                value={draft.garmentId}
                onChange={(e) =>
                  updateGarmentDraft(draft.id, {
                    garmentId: e.target.value,
                    draftItems: [],
                    computedTotal: 0,
                  })
                }
                className="w-full rounded-lg border border-hairline-strong bg-chalk-white px-3 py-2 text-sm focus:border-ink-navy focus:outline-none"
              >
                <option value="">{garmentsLoading ? "Loading…" : "— Select garment —"}</option>
                {garments.map((g) => (
                  <option key={g.id} value={g.id}>
                    {garmentLabel(g)} {g.base_price ? `(${formatPrice(g.base_price)})` : ""}
                  </option>
                ))}
              </select>

              {/* Inline editor for this garment */}
              {draft.garmentId && (
                <div className="mt-2">
                  <GarmentOrderEditor
                    key={draft.id}
                    garmentId={draft.garmentId}
                    garmentOrderId="draft"
                    initialItems={[]}
                    basePrice={
                      garments.find((g) => g.id === draft.garmentId)?.base_price ?? null
                    }
                    draftMode
                    draftSaving={submitting}
                    onDraftChange={(items) =>
                      updateGarmentDraft(draft.id, { draftItems: items })
                    }
                    onComputedTotalChange={(total) =>
                      updateGarmentDraft(draft.id, { computedTotal: total })
                    }
                  />
                </div>
              )}
            </div>
          ))}

          <button
            onClick={addGarmentDraft}
            className="w-full rounded-lg border border-dashed border-hairline-strong py-2 text-xs font-medium text-ink-navy transition hover:bg-mist-navy/30"
          >
            + Add another garment
          </button>

          {garmentDrafts.length === 0 && (
            <div className="text-center text-xs text-muted py-2">
              Add at least one garment to continue.
            </div>
          )}
        </div>
      )}

      {/* ── Step 3: Address ───────────────────────────────────────────────── */}
      {step === 2 && (
        <div className="space-y-3 pb-4">
          {/* ── Toggle: "Select existing" vs "Add new" ───────────────────── */}
          {foundUser && addresses.length > 0 && (
            <div className="flex gap-2">
              <button
                onClick={() => {
                  setShowNewAddressForm(false);
                  setNewAddr({ address_line_1: "", address_line_2: "", city: "", state: "", pincode: "" });
                  setAddrSearch("");
                  setPinCoords(null);
                  setFlyTo(undefined);
                }}
                className={`flex-1 rounded-lg border px-3 py-2 text-xs font-medium transition ${
                  !showNewAddressForm
                    ? "border-ink-navy bg-ink-navy text-chalk-white"
                    : "border-hairline-strong bg-chalk-white text-ink-navy hover:bg-mist-navy/30"
                }`}
              >
                Saved addresses ({addresses.length})
              </button>
              <button
                onClick={() => {
                  setShowNewAddressForm(true);
                  setSelectedAddressId("");
                }}
                className={`flex-1 rounded-lg border px-3 py-2 text-xs font-medium transition ${
                  showNewAddressForm
                    ? "border-ink-navy bg-ink-navy text-chalk-white"
                    : "border-hairline-strong bg-chalk-white text-ink-navy hover:bg-mist-navy/30"
                }`}
              >
                + Add new address
              </button>
            </div>
          )}

          {/* ── Existing user addresses ──────────────────────────────────── */}
          {foundUser && addresses.length > 0 && !showNewAddressForm && (
            <div className="space-y-2">
              <label className="block text-xs font-medium text-muted">
                Select an address for {foundUser.name ?? "this customer"}
              </label>
              {addressesLoading && <div className="text-xs text-muted">Loading addresses…</div>}
              {addresses.map((addr) => (
                <label
                  key={addr.id}
                  className={`flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-2.5 transition ${
                    selectedAddressId === addr.id
                      ? "border-ink-navy bg-mist-navy/20"
                      : "border-hairline-strong bg-chalk-white hover:bg-mist-navy/10"
                  }`}
                >
                  <input
                    type="radio"
                    name="address"
                    value={addr.id}
                    checked={selectedAddressId === addr.id}
                    onChange={(e) => setSelectedAddressId(e.target.value)}
                    className="mt-0.5"
                  />
                  <div className="text-xs text-ink">
                    <div className="font-medium">{addr.address_line_1 ?? "—"}</div>
                    {addr.address_line_2 && <div>{addr.address_line_2}</div>}
                    <div className="text-muted">
                      {[addr.city, addr.state, addr.pincode].filter(Boolean).join(", ") || "—"}
                    </div>
                  </div>
                </label>
              ))}
            </div>
          )}

          {/* ── New address form (for new users or when toggled) ─────────── */}
          {(showNewAddressForm || !foundUser || addresses.length === 0) && (
            <div className="space-y-3 rounded-lg border border-hairline bg-mist-navy/10 p-3">
              <div className="text-xs font-semibold text-ink-navy">New Address</div>

              {/* ── Address autocomplete search ────────────────────────────── */}
              <div className="relative">
                <label className="mb-1 block text-[11px] font-medium text-muted">
                  Search address <span className="text-muted">(type like Google Maps)</span>
                </label>
                <input
                  type="text"
                  value={addrSearch}
                  onChange={(e) => {
                    setAddrSearch(e.target.value);
                    if (addrSearchTimer.current) clearTimeout(addrSearchTimer.current);
                    if (e.target.value.trim().length < 3) {
                      setAddrResults([]);
                      setAddrDropdownOpen(false);
                      return;
                    }
                    setAddrSearching(true);
                    addrSearchTimer.current = setTimeout(async () => {
                      const results = await searchAddresses(e.target.value);
                      setAddrResults(results);
                      setAddrDropdownOpen(results.length > 0);
                      setAddrSearching(false);
                    }, 400);
                  }}
                  onFocus={() => addrResults.length > 0 && setAddrDropdownOpen(true)}
                  onBlur={() => setTimeout(() => setAddrDropdownOpen(false), 250)}
                  placeholder="e.g. 5th Avenue, HSR Layout, Bangalore"
                  className="w-full rounded-lg border border-hairline-strong bg-chalk-white px-3 py-2 text-sm focus:border-ink-navy focus:outline-none"
                />
                {addrSearching && (
                  <div className="mt-0.5 text-[10px] text-muted">Searching…</div>
                )}
                {addrDropdownOpen && addrResults.length > 0 && (
                  <div className="absolute z-10 mt-1 max-h-52 w-full overflow-auto rounded-lg border border-hairline-strong bg-chalk-white shadow-lg">
                    {addrResults.map((r, i) => (
                      <button
                        key={`${r.lat},${r.lng}-${i}`}
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => {
                          setAddrSearch(r.label);
                          setAddrDropdownOpen(false);
                          setAddrResults([]);
                          // Autofill address fields
                          setNewAddr({
                            address_line_1: r.addressLine1 ?? "",
                            address_line_2: r.addressLine2 ?? "",
                            city: r.city ?? "",
                            state: r.state ?? "",
                            pincode: r.pincode ?? "",
                          });
                          // Set pin + fly to location
                          setPinCoords({ lat: r.lat, lng: r.lng });
                          flyNonceRef.current += 1;
                          setFlyTo({ lat: r.lat, lng: r.lng, nonce: flyNonceRef.current });
                        }}
                        className="block w-full px-3 py-2 text-left text-xs transition hover:bg-mist-navy/30"
                      >
                        <div className="font-medium text-ink">{r.label.split(",")[0]}</div>
                        <div className="text-muted text-[10px] truncate">
                          {r.label.split(",").slice(1).join(",").trim()}
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* ── Map pin picker ─────────────────────────────────────────── */}
              <MapPinPicker
                lat={pinCoords?.lat}
                lng={pinCoords?.lng}
                onPinChange={(lat, lng) => {
                  setPinCoords({ lat, lng });
                  // Reverse geocode to autofill (debounced via quick check)
                  setReverseLookupLoading(true);
                  reverseGeocode(lat, lng)
                    .then((result) => {
                      if (result) {
                        setNewAddr({
                          address_line_1: result.addressLine1 ?? newAddr.address_line_1,
                          address_line_2: result.addressLine2 ?? newAddr.address_line_2,
                          city: result.city ?? newAddr.city,
                          state: result.state ?? newAddr.state,
                          pincode: result.pincode ?? newAddr.pincode,
                        });
                      }
                    })
                    .finally(() => setReverseLookupLoading(false));
                }}
                flyTo={flyTo}
              />
              {reverseLookupLoading && (
                <div className="text-[10px] text-muted">Updating address from pin…</div>
              )}

              {/* ── Editable address fields (autofilled, but editable) ─────── */}
              <div className="grid grid-cols-1 gap-3">
                <div>
                  <label className="mb-1 block text-[11px] font-medium text-muted">
                    Address Line 1 <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={newAddr.address_line_1}
                    onChange={(e) => setNewAddr({ ...newAddr, address_line_1: e.target.value })}
                    placeholder="House no, building, street"
                    className="w-full rounded-lg border border-hairline-strong bg-chalk-white px-3 py-2 text-sm focus:border-ink-navy focus:outline-none"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-[11px] font-medium text-muted">Address Line 2</label>
                  <input
                    type="text"
                    value={newAddr.address_line_2}
                    onChange={(e) => setNewAddr({ ...newAddr, address_line_2: e.target.value })}
                    placeholder="Area, landmark (optional)"
                    className="w-full rounded-lg border border-hairline-strong bg-chalk-white px-3 py-2 text-sm focus:border-ink-navy focus:outline-none"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="mb-1 block text-[11px] font-medium text-muted">
                      City <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="text"
                      value={newAddr.city}
                      onChange={(e) => setNewAddr({ ...newAddr, city: e.target.value })}
                      placeholder="Bangalore"
                      className="w-full rounded-lg border border-hairline-strong bg-chalk-white px-3 py-2 text-sm focus:border-ink-navy focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-[11px] font-medium text-muted">
                      State <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="text"
                      value={newAddr.state}
                      onChange={(e) => setNewAddr({ ...newAddr, state: e.target.value })}
                      placeholder="Karnataka"
                      className="w-full rounded-lg border border-hairline-strong bg-chalk-white px-3 py-2 text-sm focus:border-ink-navy focus:outline-none"
                    />
                  </div>
                </div>
                <div>
                  <label className="mb-1 block text-[11px] font-medium text-muted">
                    Pincode <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={newAddr.pincode}
                    onChange={(e) => setNewAddr({ ...newAddr, pincode: e.target.value })}
                    placeholder="560102"
                    className="w-full rounded-lg border border-hairline-strong bg-chalk-white px-3 py-2 text-sm focus:border-ink-navy focus:outline-none"
                  />
                </div>
              </div>
            </div>
          )}

          {foundUser && addressesLoading && addresses.length === 0 && (
            <div className="text-center text-xs text-muted py-2">Loading addresses…</div>
          )}
        </div>
      )}

      {/* ── Step 4: Measurement Job ──────────────────────────────────────── */}
      {step === 3 && (
        <div className="space-y-4 pb-4">
          {/* Previous measurements option */}
          {jobsLoading && (
            <div className="text-xs text-muted">Checking existing measurements…</div>
          )}

          {!jobsLoading && foundUser && hasPreviousMeasurements && (
            <label className={`flex cursor-pointer items-start gap-3 rounded-lg border px-4 py-3 transition ${
              jobChoice === "reuse"
                ? "border-ink-navy bg-mist-navy/20"
                : "border-hairline-strong bg-chalk-white hover:bg-mist-navy/10"
            }`}>
              <input
                type="radio"
                name="jobChoice"
                value="reuse"
                checked={jobChoice === "reuse"}
                onChange={() => setJobChoice("reuse")}
                className="mt-0.5"
              />
              <div>
                <div className="text-sm font-medium text-ink-navy">Use previous measurements</div>
                <div className="text-[11px] text-muted">
                  This customer has existing body measurements on file.
                </div>
              </div>
            </label>
          )}

          {/* Schedule new job */}
          <label className={`flex cursor-pointer items-start gap-3 rounded-lg border px-4 py-3 transition ${
            jobChoice === "schedule"
              ? "border-ink-navy bg-mist-navy/20"
              : "border-hairline-strong bg-chalk-white hover:bg-mist-navy/10"
          }`}>
            <input
              type="radio"
              name="jobChoice"
              value="schedule"
              checked={jobChoice === "schedule"}
              onChange={() => setJobChoice("schedule")}
              className="mt-0.5"
            />
            <div className="flex-1">
              <div className="text-sm font-medium text-ink-navy">Schedule a new measurement job</div>
              {jobChoice === "schedule" && (
                <div className="mt-3 space-y-4">
                  {/* Loading */}
                  {slotsLoading && (
                    <div className="text-xs text-muted py-4 text-center">Loading available slots…</div>
                  )}

                  {/* Error */}
                  {slotsError && !slotsLoading && (
                    <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                      {slotsError}
                    </div>
                  )}

                  {/* No slots */}
                  {!slotsLoading && !slotsError && slotDays.length === 0 && (
                    <div className="rounded-lg border border-hairline bg-mist-navy/10 px-3 py-4 text-center text-xs text-muted">
                      No slots available in the next two weeks.
                    </div>
                  )}

                  {/* Slot picker */}
                  {!slotsLoading && !slotsError && slotDays.length > 0 && (
                    <>
                      {/* Date chips */}
                      <div>
                        <div className="mb-1.5 text-[11px] font-medium text-muted">Date</div>
                        <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-5">
                          {slotDays.map((d) => {
                            const dt = new Date(d.date + "T00:00:00");
                            return (
                              <button
                                key={d.date}
                                onClick={() => {
                                  setSelectedSlotDate(d.date);
                                  setSelectedSlot(undefined);
                                  setSelectedCaptainId("");
                                }}
                                className={`flex flex-col items-center rounded-lg border px-1 py-1.5 transition ${
                                  selectedSlotDate === d.date
                                    ? "border-ink-navy bg-ink-navy text-chalk-white"
                                    : "border-hairline-strong bg-chalk-white text-ink hover:bg-mist-navy/30"
                                }`}
                              >
                                <span className="text-[9px] uppercase opacity-70">
                                  {dt.toLocaleDateString("en-IN", { weekday: "short" })}
                                </span>
                                <span className="text-[11px] font-medium leading-tight">
                                  {dt.toLocaleDateString("en-IN", { day: "numeric", month: "short" })}
                                </span>
                              </button>
                            );
                          })}
                        </div>
                      </div>

                      {/* Time chips */}
                      <div>
                        <div className="mb-1.5 text-[11px] font-medium text-muted">
                          {currentDaySlots.length > 0
                            ? "Available times"
                            : "No times on this day — pick another date."}
                        </div>
                        <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-4">
                          {currentDaySlots.map((s) => (
                            <button
                              key={s.start_at}
                              onClick={() => {
                                setSelectedSlot(s);
                                setSelectedCaptainId("");
                              }}
                              className={`rounded-lg border px-2 py-1.5 text-[11px] font-medium transition ${
                                selectedSlot?.start_at === s.start_at
                                  ? "border-ink-navy bg-ink-navy text-chalk-white"
                                  : "border-hairline-strong bg-chalk-white text-ink hover:bg-mist-navy/30"
                              }`}
                            >
                              {formatTimeLabel(s.label)}
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* Captain selection — only after a slot is picked */}
                      {selectedSlot && (
                        <div>
                          <label className="mb-1 block text-[11px] font-medium text-muted">
                            Style Captain{" "}
                            <span className="text-muted">
                              ({availableCaptains.length} available — auto-assigned if left blank)
                            </span>
                          </label>
                          <select
                            value={selectedCaptainId}
                            onChange={(e) => setSelectedCaptainId(e.target.value)}
                            className="w-full rounded-lg border border-hairline-strong bg-chalk-white px-3 py-2 text-sm focus:border-ink-navy focus:outline-none"
                          >
                            <option value="">— Auto-assign —</option>
                            {availableCaptains.map((c) => (
                              <option key={c.id} value={c.id}>
                                {c.name ?? c.phone ?? truncateId(c.id)}
                              </option>
                            ))}
                          </select>
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}
            </div>
          </label>

          {/* Skip */}
          <label className={`flex cursor-pointer items-start gap-3 rounded-lg border px-4 py-3 transition ${
            jobChoice === "skip"
              ? "border-ink-navy bg-mist-navy/20"
              : "border-hairline-strong bg-chalk-white hover:bg-mist-navy/10"
          }`}>
            <input
              type="radio"
              name="jobChoice"
              value="skip"
              checked={jobChoice === "skip"}
              onChange={() => setJobChoice("skip")}
              className="mt-0.5"
            />
            <div>
              <div className="text-sm font-medium text-ink-navy">Skip for now</div>
              <div className="text-[11px] text-muted">
                Create the order without scheduling a measurement job.
              </div>
            </div>
          </label>
        </div>
      )}
    </BottomSheet>
  );
}
