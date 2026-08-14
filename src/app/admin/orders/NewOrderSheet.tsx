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
  updateTableRow,
  deleteTableRow,
  fetchTableRows,
  fetchGarmentOrderItems,
  fetchGarments,
  fetchStyleCaptains,
  garmentLabel,
  fetchJobReadings,
  adminCreateBooking,
  type UserRow,
  type AddressRow,
  type GarmentRow,
  type GarmentOrderItemRow,
  type MeasurementJobRow,
  type JobStatus,
  type AdminSlotOption,
} from "@/lib/admin-api";
import { SlotPicker } from "@/components/admin/SlotPicker";
import { GarmentOrderEditor, type DraftItem } from "./[id]/GarmentOrderEditor";
import { DesignFromImage } from "./[id]/DesignFromImage";
import { AcquisitionSection } from "@/components/acquisition/AcquisitionSection";
import {
  acquisitionPayload,
  emptyAcquisition,
  type AcquisitionState,
} from "@/lib/acquisition";

// ─── Types ────────────────────────────────────────────────────────────────────

interface GarmentDraft {
  id: string; // unique key for React
  garmentId: string;
  draftItems: DraftItem[];
  computedTotal: number;
  /**
   * AI reference image URLs captured from the "Upload Reference" design flow.
   * Persisted onto `garment_orders.assets_shared` so the inspiration photo
   * shows up on the order detail page and in the measurement-job PDF.
   */
  assetsShared: string[];
}

interface NewOrderSheetProps {
  open: boolean;
  onClose: () => void;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const STEPS = ["Customer", "Garments & Style", "Address", "Measurement Job"] as const;

// ─── Country codes (dialing prefixes) ──────────────────────────────────────
// India is the default market — +91 first, the rest alphabetical by label.
const COUNTRY_CODES = [
  { code: "+91", label: "🇮🇳 +91" },
  { code: "+1", label: "🇺🇸 +1" },
  { code: "+44", label: "🇬🇧 +44" },
  { code: "+61", label: "🇦🇺 +61" },
  { code: "+971", label: "🇦🇪 +971" },
  { code: "+65", label: "🇸🇬 +65" },
] as const;

// Indian mobile numbers are 10 digits after the country code.
const PHONE_DIGIT_COUNT = 10;

/**
 * Sanitize a raw phone input down to the digits we want to store/search:
 *  - strip every non-digit char (letters, +, dashes, spaces, brackets, dots…)
 *  - drop a single leading 0 (e.g. "0987654321" → "9876543210")
 * Trims to the first PHONE_DIGIT_COUNT digits so over-long pastes don't overflow.
 */
function sanitizePhone(raw: string): string {
  const digits = raw.replace(/\D+/g, "");
  const withoutLeadingZero = digits.startsWith("0")
    ? digits.slice(1)
    : digits;
  return withoutLeadingZero.slice(0, PHONE_DIGIT_COUNT);
}

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

// ─── Component ────────────────────────────────────────────────────────────────

export function NewOrderSheet({ open, onClose }: NewOrderSheetProps) {
  const router = useRouter();

  const [step, setStep] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ── Step 1: Customer ──────────────────────────────────────────────────────
  const [phoneInput, setPhoneInput] = useState("");
  const [countryCode, setCountryCode] = useState<string>("+91");
  const [phoneTouched, setPhoneTouched] = useState(false);
  const [foundUser, setFoundUser] = useState<UserRow | null>(null);
  const [searchingUser, setSearchingUser] = useState(false);
  const [newUserName, setNewUserName] = useState("");
  const [acquisition, setAcquisition] = useState<AcquisitionState>(emptyAcquisition);
  const [userSearched, setUserSearched] = useState(false);
  const [nonCustomerRole, setNonCustomerRole] = useState<string | null>(null);
  const phoneTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Step 2: Garments ──────────────────────────────────────────────────────
  const [garments, setGarments] = useState<GarmentRow[]>([]);
  const [garmentsLoading, setGarmentsLoading] = useState(false);
  const [garmentDrafts, setGarmentDrafts] = useState<GarmentDraft[]>([]);
  const draftIdCounter = useRef(0);
  // Per-draft tab state: "upload" (AI) vs "manual" (accordion editor).
  // When prefilledItems are set, tabs disappear and only the editor shows.
  const [draftTabs, setDraftTabs] = useState<Record<string, "upload" | "manual">>({});
  // AI-prefilled initial items per draft. When set, the editor opens directly
  // with these selections pre-loaded (no tab toggle shown).
  const [prefilledByDraft, setPrefilledByDraft] = useState<
    Record<string, { items: GarmentOrderItemRow[]; imageUrl: string }>
  >({});
  // Per-draft iteration counter — bumps each time the AI returns new
  // selections so the GarmentOrderEditor remounts with fresh initialItems.
  const [draftIterations, setDraftIterations] = useState<Record<string, number>>({});
  // Stable AI thread id per draft, shared between the upload-zone instance
  // and the composerOnly instance so conversation context survives the
  // upload-zone → editor+composer transition.
  const [draftThreadIds] = useState<Record<string, string>>({});

  // ── Draft persistence ────────────────────────────────────────────────────
  // When the admin advances past the Garments step, the in-progress order is
  // written to the DB with fulfillment_status = "draft". The ids below track
  // the rows created so the later steps UPDATE them instead of recreating.
  const [draftOrderId, setDraftOrderId] = useState<string | null>(null);
  const [draftCustomerId, setDraftCustomerId] = useState<string | null>(null);
  // Map: wizard draft.id → created garment_order DB id.
  const [draftGarmentOrderIds, setDraftGarmentOrderIds] = useState<
    Record<string, string>
  >({});
  const [persistingDraft, setPersistingDraft] = useState(false);

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
  const [selectedSlotDate, setSelectedSlotDate] = useState<string | undefined>();
  const [selectedSlot, setSelectedSlot] = useState<AdminSlotOption | undefined>();
  const [captains, setCaptains] = useState<UserRow[]>([]);
  const [selectedCaptainId, setSelectedCaptainId] = useState("");

  // ── Reset everything on close ─────────────────────────────────────────────
  function fullReset() {
    setStep(0);
    setError(null);
    setPhoneInput("");
    setCountryCode("+91");
    setPhoneTouched(false);
    setFoundUser(null);
    setNewUserName("");
    setAcquisition(emptyAcquisition());
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
    setSelectedSlotDate(undefined);
    setSelectedSlot(undefined);
    setSelectedCaptainId("");
    setPrefilledByDraft({});
    setDraftIterations({});
    setDraftOrderId(null);
    setDraftCustomerId(null);
    setDraftGarmentOrderIds({});
    setPersistingDraft(false);
  }

  function handleClose() {
    fullReset();
    onClose();
  }

  // ── Phone search (debounced) ──────────────────────────────────────────────
  // phoneInput is already sanitized to digits only (see sanitizePhone on the
  // input's onChange). We only hit the DB once we have a full, valid
  // PHONE_DIGIT_COUNT-digit number — no search on partial keystrokes.
  useEffect(() => {
    if (phoneTimer.current) clearTimeout(phoneTimer.current);
    const cleanPhone = phoneInput.trim();
    if (!cleanPhone || cleanPhone.length !== PHONE_DIGIT_COUNT) {
      setFoundUser(null);
      setUserSearched(false);
      setNonCustomerRole(null);
      return;
    }
    setSearchingUser(true);
    phoneTimer.current = setTimeout(async () => {
      try {
        const { rows } = await fetchTableRows<UserRow>("users", {
          filters: { phone: cleanPhone },
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
    const draftId = `draft-${draftIdCounter.current}`;
    // Assign a stable AI conversation thread id for this draft so the
    // upload-zone and composerOnly DesignFromImage instances share context.
    draftThreadIds[draftId] = `thread-${draftIdCounter.current}-${Math.random()
      .toString(36)
      .slice(2, 8)}`;
    setGarmentDrafts((prev) => [
      ...prev,
      {
        id: draftId,
        garmentId: "",
        draftItems: [],
        computedTotal: 0,
        assetsShared: [],
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

  /**
   * Apply an AI design result (from DesignFromImage) to a garment draft:
   * stores prefilled editor items, the reference image, the raw draft items,
   * and bumps the iteration counter so the editor remounts with fresh data.
   */
  function applyAIDraft(
    draftId: string,
    items: DraftItem[],
    imageUrl: string,
  ) {
    const prefilled: GarmentOrderItemRow[] = items.map((it, i) => ({
      id: `prefilled-${draftId}-${i}`,
      garment_order_id: "draft",
      garment_style_component_id: it.garment_style_component_id,
      type: it.type,
      variation_id: it.variation_id,
      variation_type_id: it.variation_type_id,
      addon_id: it.addon_id,
      addon_variation_id: it.addon_variation_id,
      placement: it.placement,
      price: it.price,
      custom_input: null,
      label_snapshot: it.label_snapshot,
    }));
    setPrefilledByDraft((prev) => ({
      ...prev,
      [draftId]: { items: prefilled, imageUrl },
    }));
    // Carry the AI reference image onto the draft so it is persisted as
    // assets_shared when the garment_order is created/updated. Dedupe so
    // repeated AI iterations on the same draft don't pile up copies.
    setGarmentDrafts((prev) =>
      prev.map((d) =>
        d.id === draftId
          ? {
              ...d,
              assetsShared: Array.from(
                new Set([...d.assetsShared, imageUrl].filter(Boolean)),
              ),
            }
          : d,
      ),
    );
    updateGarmentDraft(draftId, { draftItems: items });
    setDraftIterations((prev) => ({
      ...prev,
      [draftId]: (prev[draftId] ?? 0) + 1,
    }));
  }

  /**
   * A reference image was uploaded at selection time (before any analysis).
   * Record it onto the draft's assets_shared and persist the draft order
   * immediately so the photo lands in the DB right away — the admin doesn't
   * have to advance to the Address step. Unlike applyAIDraft this does NOT
   * touch the editor's items, so manual edits are preserved. Only persists
   * once a customer is resolvable (step 0 done); otherwise persistDraftOrder
   * would create a user prematurely, so it defers to the normal Next flow.
   */
  function applyImageUrl(draftId: string, imageUrl: string) {
    if (!imageUrl) return;
    setGarmentDrafts((prev) =>
      prev.map((d) =>
        d.id === draftId
          ? {
              ...d,
              assetsShared: Array.from(
                new Set([...d.assetsShared, imageUrl].filter(Boolean)),
              ),
            }
          : d,
      ),
    );
    const customerReady = !!draftCustomerId || !!foundUser ||
      (userSearched && !foundUser && newUserName.trim().length > 0);
    if (customerReady) {
      void Promise.resolve().then(() => {
        persistDraftOrder().catch(() => {
          // surfaced inside persistDraftOrder via setError
        });
      });
    }
  }

  // ── Persist draft order (advance from Garments step) ──────────────────────
  /**
   * Write the in-progress order to the DB with fulfillment_status = "draft":
   * creates the customer (if new), the order row, and a garment_order +
   * items per draft. Idempotent — on re-entry (admin went Back to Garments,
   * edited, then Next again) it updates existing rows. Items are
   * delete-then-reinserted per garment_order to avoid the
   * ix_goi_unique_variation partial unique index when the picked variation
   * for a component changes.
   *
   * NOTE: if the admin closes the sheet after this runs, the draft order and
   * (for a new customer) the users row remain in the DB. That is intentional
   * — drafts are reopenable from the orders list.
   */
  async function persistDraftOrder() {
    if (persistingDraft) return;
    setPersistingDraft(true);
    setError(null);
    try {
      // 1. Resolve / create customer (once)
      let customerId: string;
      if (draftCustomerId) {
        customerId = draftCustomerId;
      } else if (foundUser) {
        customerId = foundUser.id;
      } else {
        const newUser = await createTableRow<UserRow>("users", {
          name: newUserName.trim(),
          phone: phoneInput.trim(),
          country_code: countryCode,
          role: "customer",
          // New customer → acquisition is first-touch; mirror onto the user.
          ...acquisitionPayload(acquisition),
        });
        customerId = newUser.id;
      }
      if (!draftCustomerId) setDraftCustomerId(customerId);

      // 2. Create draft order (once). Totals are derived by the backend from
      //    garment-order items + adjustments (see PRICING.md) — never set
      //    directly, and never re-pushed on re-persist: item writes trigger the
      //    backend resync hook that recomputes the order total.
      let orderId = draftOrderId;
      if (!orderId) {
        const order = await createOrder({
          user_id: customerId,
          address_id: null,
          fulfillment_status: "draft",
          payment_status: null,
          // Per-order attribution (last-touch for this conversion). Always
          // written, whether the customer is new or existing.
          ...acquisitionPayload(acquisition),
        });
        orderId = order.id;
        setDraftOrderId(orderId);
      }

      // 3. Sync garment_orders + items for each draft
      const newGoIds: Record<string, string> = { ...draftGarmentOrderIds };
      for (const draft of garmentDrafts) {
        const garment = garments.find((g) => g.id === draft.garmentId);
        const basePrice = garment?.base_price ?? null;
        const existingGoId = newGoIds[draft.id];

        if (existingGoId) {
          // Tear down old items (avoids unique-index conflicts on re-insert),
          // then update the garment_order and re-insert the current items.
          const oldItems = await fetchGarmentOrderItems(existingGoId);
          await Promise.all(
            oldItems.map((it) => deleteTableRow("garment_orders_items", it.id)),
          );
          await updateTableRow("garment_orders", existingGoId, {
            garment_id: draft.garmentId,
            price: draft.computedTotal > 0 ? draft.computedTotal : basePrice,
            assets_shared: draft.assetsShared.length > 0 ? draft.assetsShared : null,
          });
          for (const item of draft.draftItems) {
            await createTableRow<GarmentOrderItemRow>("garment_orders_items", {
              garment_order_id: existingGoId,
              type: item.type,
              garment_style_component_id: item.garment_style_component_id,
              variation_id: item.variation_id,
              variation_type_id: item.variation_type_id,
              addon_id: item.addon_id,
              addon_variation_id: item.addon_variation_id,
              placement: item.placement,
              label_snapshot: item.label_snapshot,
            });
          }
        } else {
          const go = await createTableRow<{ id: string }>("garment_orders", {
            order_id: orderId,
            garment_id: draft.garmentId,
            price: draft.computedTotal > 0 ? draft.computedTotal : basePrice,
            status: "pending",
            assets_shared: draft.assetsShared.length > 0 ? draft.assetsShared : null,
          });
          newGoIds[draft.id] = go.id;
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
              label_snapshot: item.label_snapshot,
            });
          }
        }
      }

      // 4. Clean up garment_orders for drafts that were removed
      for (const [oldDraftId, goId] of Object.entries(draftGarmentOrderIds)) {
        if (!garmentDrafts.find((d) => d.id === oldDraftId)) {
          const items = await fetchGarmentOrderItems(goId);
          await Promise.all(
            items.map((it) => deleteTableRow("garment_orders_items", it.id)),
          );
          await deleteTableRow("garment_orders", goId);
          delete newGoIds[oldDraftId];
        }
      }

      setDraftGarmentOrderIds(newGoIds);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save draft order");
      throw e;
    } finally {
      setPersistingDraft(false);
    }
  }

  // ── Step-aware next ───────────────────────────────────────────────────────
  async function handleNext() {
    if (step === 1) {
      // Garments → Address: persist the draft order first.
      try {
        await persistDraftOrder();
        setStep((s) => s + 1);
      } catch {
        // error already surfaced in persistDraftOrder
      }
    } else {
      setStep((s) => s + 1);
    }
  }

  // ── Submit ─────────────────────────────────────────────────────────────────
  async function handleSubmit() {
    setSubmitting(true);
    setError(null);
    try {
      // 1. Resolve customer
      let customerId: string;
      if (draftCustomerId) {
        customerId = draftCustomerId;
      } else if (foundUser) {
        customerId = foundUser.id;
      } else {
        const newUser = await createTableRow<UserRow>("users", {
          name: newUserName.trim(),
          phone: phoneInput.trim(),
          country_code: countryCode,
          role: "customer",
          // New customer → acquisition is first-touch; mirror onto the user.
          ...acquisitionPayload(acquisition),
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

      let orderId: string;

      if (draftOrderId) {
        // ── Finalize the existing draft ──
        // Re-sync garments (idempotent no-op if unchanged), then flip the
        // order from "draft" → "pending" and attach the address.
        await persistDraftOrder();
        orderId = draftOrderId;
        await updateTableRow("orders", orderId, {
          user_id: customerId,
          address_id: addressId,
          fulfillment_status: "pending",
          payment_status: "pending",
        });
      } else {
        // ── Fallback: full create (draft was never persisted) ──
        const order = await createOrder({
          user_id: customerId,
          address_id: addressId,
          fulfillment_status: "pending",
          payment_status: "pending",
          // Per-order attribution (last-touch). New customers also mirrored
          // it onto the user row above; existing customers → order only.
          ...acquisitionPayload(acquisition),
        });
        orderId = order.id;

        for (const draft of garmentDrafts) {
          const garment = garments.find((g) => g.id === draft.garmentId);
          const basePrice = garment?.base_price ?? null;
          const go = await createTableRow<{ id: string }>("garment_orders", {
            order_id: orderId,
            garment_id: draft.garmentId,
            price: draft.computedTotal > 0 ? draft.computedTotal : basePrice,
            status: "pending",
            assets_shared: draft.assetsShared.length > 0 ? draft.assetsShared : null,
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
              label_snapshot: item.label_snapshot,
            });
          }
        }
      }

      // 3. Schedule the visit (if requested) via the booking endpoint so the
      // slot claim is held immediately and "Auto-assign" picks the
      // least-utilized free captain — same as the customer flow. (The old
      // raw measurement_jobs insert left auto-assigned jobs captain-less
      // and blocked nothing.)
      if (jobChoice === "schedule" && selectedSlot) {
        await adminCreateBooking(
          orderId,
          selectedSlot.start_at,
          selectedCaptainId || undefined,
        );
      }

      handleClose();
      router.push(`/admin/orders/${orderId}`);
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
      className="max-w-5xl"
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
                onClick={handleNext}
                disabled={!stepValid || submitting || persistingDraft}
                className="rounded-lg bg-ink-navy px-5 py-2 text-xs font-semibold text-chalk-white transition hover:bg-tape disabled:opacity-40"
              >
                {persistingDraft && step === 1 ? "Saving draft…" : "Next →"}
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
            <div className="flex gap-2">
              {/* Country code dropdown */}
              <select
                value={countryCode}
                onChange={(e) => setCountryCode(e.target.value)}
                className="shrink-0 rounded-lg border border-hairline-strong bg-chalk-white px-2.5 py-2.5 text-sm focus:border-ink-navy focus:outline-none"
                aria-label="Country code"
              >
                {COUNTRY_CODES.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.label}
                  </option>
                ))}
              </select>
              {/* Phone number (sanitized to digits only) */}
              <input
                type="tel"
                inputMode="numeric"
                value={phoneInput}
                onChange={(e) => setPhoneInput(sanitizePhone(e.target.value))}
                onBlur={() => setPhoneTouched(true)}
                placeholder="10-digit mobile number"
                className="w-full rounded-lg border border-hairline-strong bg-chalk-white px-3 py-2.5 text-sm focus:border-ink-navy focus:outline-none"
                autoFocus
              />
            </div>
            {/* Validation only on blur (focus out) — not on every keystroke. */}
            {phoneTouched &&
              phoneInput.length > 0 &&
              phoneInput.length !== PHONE_DIGIT_COUNT && (
                <div className="mt-1 text-[11px] text-red-500">
                  Enter a valid {PHONE_DIGIT_COUNT}-digit mobile number.
                </div>
              )}
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
                {foundUser.country_code ?? countryCode} {foundUser.phone}
                {foundUser.email ? ` • ${foundUser.email}` : ""}
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

          {/* Acquisition source — drives THIS ORDER's attribution.
              For a new customer it is also mirrored onto the user (first-touch). */}
          {(foundUser || (userSearched && !foundUser && !nonCustomerRole && newUserName.trim().length > 0)) && (
            <AcquisitionSection
              value={acquisition}
              onChange={setAcquisition}
              summaryLabel={
                foundUser
                  ? "Acquisition source (this order)"
                  : "Acquisition source"
              }
              hint={
                foundUser
                  ? "Optional — what drove this order. (The customer's original source is kept on their profile.)"
                  : "Optional — how this customer/order was acquired. Saved to both the customer and this order."
              }
            />
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
                onChange={(e) => {
                  updateGarmentDraft(draft.id, {
                    garmentId: e.target.value,
                    draftItems: [],
                    computedTotal: 0,
                    // Clear the AI reference image when the garment type
                    // changes — the old inspiration photo no longer applies.
                    assetsShared: [],
                  });
                  // Clear AI prefill when garment changes
                  setPrefilledByDraft((prev) => {
                    const next = { ...prev };
                    delete next[draft.id];
                    return next;
                  });
                }}
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
                  {prefilledByDraft[draft.id] ? (
                    /* ── AI prefilled: show reference image on top, editor below — no tabs ── */
                    <div className="space-y-3">
                      {/* Reference image */}
                      <div className="flex items-start justify-between gap-3">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={prefilledByDraft[draft.id].imageUrl}
                          alt="Reference design"
                          className="max-h-[280px] rounded-lg border border-hairline object-contain"
                        />
                        <button
                          onClick={() => {
                            setPrefilledByDraft((prev) => {
                              const next = { ...prev };
                              delete next[draft.id];
                              return next;
                            });
                            updateGarmentDraft(draft.id, {
                              draftItems: [],
                              computedTotal: 0,
                            });
                          }}
                          className="shrink-0 rounded-md border border-hairline-strong px-2 py-1 text-[11px] text-muted hover:bg-mist-navy"
                        >
                          Reset
                        </button>
                      </div>

                      {/* Editor with prefilled selections.
                          key includes the iteration counter so the editor
                          remounts whenever the AI returns new selections. */}
                      <GarmentOrderEditor
                        key={`${draft.id}-prefilled-${draftIterations[draft.id] ?? 0}`}
                        garmentId={draft.garmentId}
                        garmentOrderId="draft"
                        initialItems={prefilledByDraft[draft.id].items}
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

                      {/* Composer (upload · mic · text) for further AI
                          refinement. Shares the draft's thread id so it keeps
                          the conversation context from the Analyze step. */}
                      <DesignFromImage
                        garmentId={draft.garmentId}
                        draftMode
                        composerOnly
                        threadId={draftThreadIds[draft.id]}
                        onDraftChange={(items, imageUrl) =>
                          applyAIDraft(draft.id, items, imageUrl)
                        }
                        onImageUrl={(imageUrl) =>
                          applyImageUrl(draft.id, imageUrl)
                        }
                      />
                    </div>
                  ) : (
                    /* ── Tabbed: AI upload vs manual select ── */
                    <>
                      <div className="mb-2 flex gap-1 border-b border-hairline">
                        <button
                          onClick={() =>
                            setDraftTabs((prev) => ({ ...prev, [draft.id]: "upload" }))
                          }
                          className={`border-b-2 px-3 py-1.5 text-xs font-medium transition ${
                            (draftTabs[draft.id] ?? "upload") === "upload"
                              ? "border-ink-navy text-ink-navy"
                              : "border-transparent text-muted hover:text-ink"
                          }`}
                        >
                          Upload Reference
                        </button>
                        <button
                          onClick={() =>
                            setDraftTabs((prev) => ({ ...prev, [draft.id]: "manual" }))
                          }
                          className={`border-b-2 px-3 py-1.5 text-xs font-medium transition ${
                            draftTabs[draft.id] === "manual"
                              ? "border-ink-navy text-ink-navy"
                              : "border-transparent text-muted hover:text-ink"
                          }`}
                        >
                          Manual Select
                        </button>
                      </div>

                      {(draftTabs[draft.id] ?? "upload") === "upload" ? (
                        <DesignFromImage
                          garmentId={draft.garmentId}
                          draftMode
                          threadId={draftThreadIds[draft.id]}
                          onDraftChange={(items, imageUrl) =>
                            applyAIDraft(draft.id, items, imageUrl)
                          }
                          onImageUrl={(imageUrl) =>
                            applyImageUrl(draft.id, imageUrl)
                          }
                        />
                      ) : (
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
                      )}
                    </>
                  )}
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
                  <SlotPicker
                    selectedDate={selectedSlotDate ?? null}
                    selectedSlot={selectedSlot ?? null}
                    selectedCaptainId={selectedCaptainId}
                    onDateChange={(d) => setSelectedSlotDate(d ?? undefined)}
                    onSlotChange={(s) => setSelectedSlot(s ?? undefined)}
                    onCaptainChange={setSelectedCaptainId}
                    captains={captains}
                  />
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
