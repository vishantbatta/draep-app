"use client";

/**
 * /app/orders/{id} — the customer order detail page.
 *
 * Opened by tapping a dashboard card. Shows the full breakdown of the order
 * and each garment order: every selection and add-on as a crisp label → value
 * row with its price, the additive price summary (same math as the invoice),
 * the payment ledger, and the invoice download — which runs the exact PDF
 * generator the /invoice page uses, fetched from the same public invoice
 * endpoint.
 *
 * Every order ends in a pinned bottom bar whose state follows concrete facts
 * (attached address → visit held or measured → how the booking is confirmed),
 * never the order status, in priority order:
 *   1. nothing attached            → "Select Address" (picker sheet, or the
 *                                     full-page address form when none saved)
 *   2. no slot drafted AND
 *      measurements not completed  → "Select Slot" — Select books the
 *                                     measurement visit (POST /orders/{id}/
 *                                     booking; reschedules via PATCH). A
 *                                     completed visit never re-books — its
 *                                     order goes straight to Confirm.
 *   3. slot held (or measured),   → "Confirm Booking" opens the method sheet
 *                                     (online or Cash on Delivery). Until one
 *                                     lands, the slot is only a draft hold —
 *                                     the card above shows the time and
 *                                     address, never "confirmed".
 *   4. COD confirmed               → prominent confirmation card; the CTA
 *                                     demotes to a secondary "Pay ₹<advance>
 *                                     in Advance" (the fee is waived if
 *                                     captured before delivery)
 *   5. money captured              → prominent confirmation card; the CTA
 *                                     follows the balance: pay-balance when
 *                                     the order grew (underpaid), "Explore
 *                                     More Designs" + refund-at-delivery
 *                                     note when it shrank (overpaid),
 *                                     nothing when settled
 * A delivered order with a balance falls through to a plain pay-balance CTA;
 * a delivered order with nothing left to pay hides the bar entirely. Placed
 * orders also get invoice actions above the bar.
 */

import {
  Suspense,
  useCallback,
  useEffect,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";

import { OrderStatusRows, StatusPill } from "@/components/order/OrderStatus";
import { ScreenShell } from "@/components/layout/ScreenShell";
import { Banner } from "@/components/ui/Banner";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { Button } from "@/components/ui/Button";
import { MonoNumber } from "@/components/ui/MonoNumber";
import {
  ArrowLeft,
  Calendar,
  ChatBubble,
  Check,
  Clock,
  HomeVisit,
  MapPin,
  Pencil,
  Plus,
  ShieldCheck,
  Sparkles,
  Thread,
  Trash,
} from "@/components/ui/icons";
import { ApiError, addressesApi, checkoutApi, ordersApi } from "@/lib/api";
import { Loader } from "@/components/ui/Loader";
import { useAuthBootstrapped } from "@/lib/auth-store";
import type { GarmentOrderItemRow } from "@/lib/admin-api";
import { loadCashfree } from "@/lib/cashfree";
import {
  displayOrderNumber,
  formatDate,
  slotVisitLabel,
  visitDateTimeLabel,
} from "@/lib/order-display";
import { formatPrice } from "@/lib/pricing";
import { strings } from "@/lib/strings";
import { AddressForm } from "@/components/contact/AddressForm";
import { SlotSheet } from "@/components/order/SlotSheet";
import { InspirationGallery } from "@/components/order/InspirationGallery";
import {
  GarmentSelectionSheet,
  type SelectionRowPersistence,
  type SelectionSeedItem,
} from "@/components/admin/GarmentSelectionSheet";
import type { Booking } from "@/types/booking";
import type {
  Address,
  CustomerOrderDetail,
  OrderDetailGarmentOrder,
  OrderDetailItem,
} from "@/types/api";

/* ─── Row renderers ───────────────────────────────────────────────────────── */

/** One selection/add-on: label on the left, choice (+ price) on the right. */
function ItemRow({ item }: { item: OrderDetailItem }) {
  const placement = item.placement?.length ? ` · ${item.placement.join(" · ")}` : "";
  // Same fallbacks the admin breakdown uses — a stray unlabeled row still
  // reads, and a label-only row shows its price rather than an empty "—".
  const label = item.label ?? (item.type === "add_on" ? "Add-on" : "Selection");
  const value =
    item.value ?? ((item.price ?? 0) !== 0 ? `+ ${formatPrice(item.price ?? 0)}` : null);
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-hairline py-2.5 last:border-b-0">
      <span className="flex-none text-caption text-muted">{label}</span>
      <span className="min-w-0 text-right">
        <span className="block text-body font-medium text-ink-navy">
          {value ?? "—"}
          {placement}
        </span>
        {item.value != null && (item.price ?? 0) !== 0 && (
          <span className="block text-caption text-muted">
            + {formatPrice(item.price ?? 0)}
          </span>
        )}
      </span>
    </div>
  );
}

function SummaryRow({
  label,
  value,
  strong = false,
}: {
  label: string;
  value: string;
  strong?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3 py-1.5">
      <span className={strong ? "font-heading text-body text-ink-navy" : "text-body text-ink/85"}>
        {label}
      </span>
      <span
        className={
          strong
            ? "font-heading font-semibold text-body text-ink-navy"
            : "font-mono text-data text-ink-navy"
        }
      >
        {value}
      </span>
    </div>
  );
}

/** One labeled job row in the home-visit card: label left, value right. */
function JobRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1">
      <span className="flex-none text-caption text-muted">{label}</span>
      <span className="min-w-0 text-right text-body font-medium text-ink-navy">
        {children}
      </span>
    </div>
  );
}

/* ─── Loading state ──────────────────────────────────────────────────────── */

/** Stagger for the skeleton's entry rise and sheen sweep (globals.css). */
const odDelay = (ms: number): CSSProperties =>
  ({ "--od-delay": `${ms}ms` }) as CSSProperties;

/** One mist-navy slab — the chalk sheen is drawn by .od-block::after. */
function Shimmer({ className = "" }: { className?: string }) {
  return <div aria-hidden className={`od-block rounded-pill ${className}`} />;
}

/**
 * The loading state is the page's own geometry rendered as slabs — back row,
 * header (tape-gradient spinner standing in for the mono order number),
 * status card, visit card, garment breakdown, summary, and the pinned bottom
 * bar — so the real content drops in with zero jump. Each section rises in
 * and catches the sheen one after the next (--od-delay), reading as a single
 * wave down the page. Rendered both while the detail fetch is in flight and
 * as the Suspense fallback, so even a hard load never shows a blank screen.
 */
function OrderLoadingSkeleton() {
  return (
    <ScreenShell className="px-4 pt-6">
      <div
        role="status"
        aria-busy="true"
        aria-label={strings.orderDetail.loadingSr}
        className="flex min-h-[calc(100dvh-1.5rem)] flex-col"
      >
        {/* Back + support */}
        <div className="od-rise flex items-center justify-between" style={odDelay(0)}>
          <Shimmer className="h-4 w-24" />
          <Shimmer className="h-9 w-28" />
        </div>

        {/* Header */}
        <header className="od-rise mt-2" style={odDelay(60)}>
          <p className="eyebrow">{strings.orderDetail.title}</p>
          <div className="mt-1 flex items-center gap-3">
            <span aria-hidden className="od-spinner h-9 w-9 flex-none" />
            <Shimmer className="h-8 flex-1" />
          </div>
          <Shimmer className="mt-2 h-3.5 w-28" />
        </header>

        {/* Statuses */}
        <section
          className="od-rise mt-4 rounded-card border border-hairline bg-chalk-white p-4 shadow-card"
          style={odDelay(120)}
        >
          {[0, 1].map((i) => (
            <div key={i} className="mt-3 flex items-center justify-between first:mt-0">
              <Shimmer className="h-3.5 w-24" />
              <Shimmer className="h-6 w-20" />
            </div>
          ))}
        </section>

        {/* Home visit */}
        <section
          className="od-rise mt-3 rounded-card border border-hairline bg-chalk-white p-4 shadow-card"
          style={odDelay(180)}
        >
          <Shimmer className="h-3 w-24" />
          <div className="mt-3 flex items-center gap-2">
            <Shimmer className="h-4 w-4 flex-none" />
            <Shimmer className="h-4 w-2/3" />
          </div>
          <div className="mt-2 flex items-center gap-2">
            <Shimmer className="h-4 w-4 flex-none" />
            <Shimmer className="h-4 w-1/2" />
          </div>
        </section>

        {/* Garment breakdown */}
        <section
          className="od-rise mt-3 rounded-card border border-hairline bg-chalk-white p-4 shadow-card"
          style={odDelay(240)}
        >
          <div className="flex items-center justify-between">
            <Shimmer className="h-5 w-32" />
            <Shimmer className="h-6 w-16" />
          </div>
          <div className="mt-4 space-y-2.5">
            {["w-3/5", "w-1/2", "w-2/3"].map((w) => (
              <div key={w} className="flex items-center justify-between">
                <Shimmer className={`h-4 ${w}`} />
                <Shimmer className="h-4 w-14" />
              </div>
            ))}
          </div>
          <div className="mt-4 space-y-2 border-t border-hairline pt-3">
            <div className="flex items-center justify-between">
              <Shimmer className="h-3.5 w-16" />
              <Shimmer className="h-3.5 w-12" />
            </div>
            <div className="flex items-center justify-between">
              <Shimmer className="h-4 w-20" />
              <Shimmer className="h-4 w-16" />
            </div>
          </div>
        </section>

        {/* Summary */}
        <section
          className="od-rise mt-3 rounded-card border border-hairline bg-chalk-white p-4 shadow-card"
          style={odDelay(300)}
        >
          <Shimmer className="h-3 w-20" />
          <div className="mt-3 space-y-2">
            {[0, 1].map((i) => (
              <div key={i} className="flex items-center justify-between">
                <Shimmer className="h-3.5 w-28" />
                <Shimmer className="h-3.5 w-14" />
              </div>
            ))}
          </div>
        </section>

        {/* Flexible spacer keeps the bar pinned to the viewport bottom
            while the skeleton is shorter than a screen. */}
        <div aria-hidden className="min-h-5 flex-1" />

        {/* Pinned bottom bar — draft card + CTA */}
        <div
          className="od-rise sticky bottom-0 z-20 -mx-4 -mb-6 border-t border-hairline bg-chalk-white px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 shadow-[0_-6px_16px_-8px_rgba(23,42,72,0.25)]"
          style={odDelay(360)}
        >
          <Shimmer className="h-16 rounded-card" />
          <Shimmer className="mt-3 h-12 w-full" />
        </div>
      </div>
    </ScreenShell>
  );
}

/* ============================================================ */

// Preview amount for the pay-choice sheet (mirrors BE settings.cod_fee_rupees);
// the authoritative fee always comes back on the order's COD adjustment row.
const COD_FEE_PREVIEW = 50;

export default function OrderDetailPage() {
  // useSearchParams (?placed=1) needs a Suspense boundary during prerender;
  // the same skeleton the loading state uses keeps hard loads from ever
  // flashing a blank screen before the client component mounts.
  return (
    <Suspense fallback={<OrderLoadingSkeleton />}>
      <OrderDetailContent />
    </Suspense>
  );
}

/* ─── Selection editing (same sheet as the admin dashboard) ────────────────── */

/** Map the order-detail display rows to the seed shape the selection sheet
 * reads. Only rows carrying their raw catalog ids can seed; the id fields
 * are omitted on the wire only for exotic rows (custom-input-only). */
function seedSelectionItems(g: OrderDetailGarmentOrder): SelectionSeedItem[] {
  return g.items
    .filter((i) =>
      i.type === "selection" ? i.variation_id != null : i.addon_id != null,
    )
    .map((i) => ({
      type: i.type === "selection" ? "variation" : "add_on",
      garment_style_component_id: i.garment_style_component_id,
      variation_id: i.variation_id,
      variation_type_id: i.variation_type_id,
      addon_id: i.addon_id,
      addon_variation_id: i.addon_variation_id,
      placement: i.placement,
    }));
}

/**
 * Customer-side row writer for the selection sheet — the same three ops the
 * admin table editor performs, routed through the customer selection
 * endpoints (scoped to one garment order of this order). The endpoints
 * return the order envelope rather than the written row, so writeRow
 * synthesizes one for the sheet's internal diff state; the page refetches
 * the full detail right after save, so ids/labels re-derive from the server.
 */
function makeCustomerPersistence(
  orderId: string,
  garmentOrderId: string,
): SelectionRowPersistence {
  const writeRow = async (
    existing: GarmentOrderItemRow | undefined,
    payload: Record<string, unknown>,
  ): Promise<GarmentOrderItemRow> => {
    if (payload.type === "add_on") {
      await ordersApi.upsertAddon(
        orderId,
        payload.addon_id as string,
        (payload.addon_variation_id as string | null) ?? null,
        ((payload.placement as string[] | null) ?? [])[0] ?? null,
        garmentOrderId,
      );
    } else {
      await ordersApi.updateSelection(
        orderId,
        payload.garment_style_component_id as string,
        payload.variation_id as string,
        (payload.variation_type_id as string | null) ?? null,
        garmentOrderId,
      );
    }
    return { ...(existing ?? {}), ...payload } as GarmentOrderItemRow;
  };

  return {
    async deleteRow(item) {
      if (item.type === "add_on") {
        await ordersApi.removeAddon(
          orderId,
          item.addon_id ?? "",
          item.placement?.[0] ?? null,
          garmentOrderId,
        );
      } else {
        // The customer API has no "remove component" — DELETE resets the
        // component to its catalog default, the closest safe outcome. (The
        // sheet only emits this op for server rows with no counterpart in
        // the current tree, so it rarely fires.)
        await ordersApi.resetSelection(
          orderId,
          item.garment_style_component_id ?? "",
          garmentOrderId,
        );
      }
    },
    createRow: (payload) => writeRow(undefined, payload),
    updateRow: (existing, payload) => writeRow(existing, payload),
  };
}

function OrderDetailContent() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();

  const [detail, setDetail] = useState<CustomerOrderDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);

  /* ── Address + slot finish flow: deliver-to card → Continue → slot sheet,
     then the Pay-to-Book CTA once a visit is booked ────────────────────── */
  const [savedAddresses, setSavedAddresses] = useState<Address[]>([]);
  const [placeError, setPlaceError] = useState<string | null>(null);
  const [slotOpen, setSlotOpen] = useState(false);
  const [paying, setPaying] = useState(false);

  /* ── Pay-method choice sheet: online vs Cash on Delivery ──────────────── */
  const [payChoiceOpen, setPayChoiceOpen] = useState(false);
  const [codConfirmOpen, setCodConfirmOpen] = useState(false);
  const [choosingCod, setChoosingCod] = useState(false);
  const [choiceError, setChoiceError] = useState<string | null>(null);

  /* ── Address picker + add-address sheets (Change button) ──────────────── */
  const [pickerOpen, setPickerOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [pickingId, setPickingId] = useState<string | null>(null);
  const [pickError, setPickError] = useState<string | null>(null);
  // True while a just-attached address is waiting for the (slow) order
  // detail refetch — the deliver-to card shows a skeleton instead of
  // silently keeping the stale "no address" view for seconds.
  const [addressRefreshing, setAddressRefreshing] = useState(false);

  /* ── Garment note editor — the customer's message for the style captain.
     MYOD orders start empty (the design lives in the selection items), so
     this is both the add and the edit path; editable at any order state. */
  const [noteEditingId, setNoteEditingId] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState("");
  const [noteSaving, setNoteSaving] = useState(false);
  const [noteError, setNoteError] = useState<string | null>(null);

  /* ── Selection editing — the same GarmentSelectionSheet the admin
     dashboard uses, persisted through the customer selection endpoints. */
  const [editingGOId, setEditingGOId] = useState<string | null>(null);

  /* ── Garment removal — allowed while the order is editable (draft through
     the booked visit). Paid orders shrink too: the ledger stays, totals
     resync server-side and an over-collection reads as refund-at-delivery. */
  const [removingGOId, setRemovingGOId] = useState<string | null>(null);
  const [removeError, setRemoveError] = useState<string | null>(null);

  const handleRemoveGarment = async (garmentOrderId: string) => {
    if (removingGOId) return;
    if (!window.confirm(strings.orderDetail.removeGarmentConfirm)) return;
    setRemovingGOId(garmentOrderId);
    setRemoveError(null);
    try {
      await ordersApi.removeGarmentFromOrder(id, garmentOrderId);
      await refreshDetail();
    } catch (err) {
      setRemoveError(
        err instanceof Error && err.message
          ? err.message
          : strings.orderDetail.removeGarmentError,
      );
    } finally {
      setRemovingGOId(null);
    }
  };

  const openNoteEditor = (garmentOrderId: string, currentNote: string | null) => {
    setNoteDraft(currentNote ?? "");
    setNoteError(null);
    setNoteEditingId(garmentOrderId);
  };

  const handleSaveNote = async () => {
    if (noteSaving || noteEditingId == null) return;
    setNoteSaving(true);
    setNoteError(null);
    try {
      await ordersApi.updateOrderNote(id, noteEditingId, noteDraft);
      setNoteEditingId(null);
      await refreshDetail();
    } catch (err) {
      setNoteError(
        err instanceof Error ? err.message : strings.orderDetail.noteError,
      );
    } finally {
      setNoteSaving(false);
    }
  };

  // Saved addresses feed the deliver-to card when the order has none
  // attached. Non-fatal — on failure the card just stays hidden and
  // Continue routes to the add-address page instead.
  useEffect(() => {
    if (!detail) return;
    let cancelled = false;
    addressesApi
      .listAddresses()
      .then((list) => {
        if (!cancelled) setSavedAddresses(list);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [detail]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setNotFound(false);
    try {
      setDetail(await ordersApi.getOrderDetail(id));
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        setNotFound(true);
      } else {
        setError(err instanceof Error ? err.message : strings.errors.generic);
      }
    } finally {
      setLoading(false);
    }
  }, [id]);

  // Wait for auth bootstrap to settle before the first fetch. Admin-issued
  // login links land here as ?token=… and Providers exchanges that for a
  // session in parallel with this page mounting — fetching earlier fires
  // without (or with an anonymous) Authorization header and fails.
  const bootstrapped = useAuthBootstrapped();

  useEffect(() => {
    if (!bootstrapped) return;
    void load();
  }, [bootstrapped, load]);

  /* ── Loading / error states ──────────────────────────────────────────── */
  if (loading) {
    return <OrderLoadingSkeleton />;
  }

  if (notFound || error || !detail) {
    return (
      <ScreenShell className="px-4 pt-6">
        <Link
          href="/app"
          className="inline-flex min-h-[44px] items-center gap-1 text-caption font-semibold text-navy-interactive"
        >
          <ArrowLeft size={16} />
          {strings.orderDetail.back}
        </Link>
        <div
          role="alert"
          className="mt-6 rounded-card border border-hairline bg-chalk-white p-6 text-center text-body text-error-text shadow-card"
        >
          {notFound ? strings.orderDetail.notFound : strings.orderDetail.loadError}
          {!notFound && error ? ` (${error})` : ""}
          <div className="mt-4">
            {!notFound && (
              <Button variant="secondary" onClick={() => void load()}>
                {strings.orderDetail.retry}
              </Button>
            )}
          </div>
        </div>
      </ScreenShell>
    );
  }

  /* ── Detail ──────────────────────────────────────────────────────────── */
  const isDraft = detail.fulfillment_status === "draft";
  // Selection editing mirrors the server gate exactly: garments stay
  // editable until the visit concludes. Money no longer locks edits — a
  // paid order that grows re-derives balance_due; one that shrinks
  // over-collects, which the CTA surfaces as refund-at-delivery.
  const selectionsEditable = [
    "draft",
    "pending",
    "awaiting_visit",
    "visit_scheduled",
  ].includes(detail.fulfillment_status ?? "");
  // The slot drives the visit time; orders booked before slots were linked
  // (slot: null) still have it on the measurement job, so fall back there.
  const visit =
    slotVisitLabel(detail.slot) ??
    visitDateTimeLabel(
      (detail.measurement_jobs.find((j) => j.status !== "cancelled") ??
        detail.measurement_jobs[detail.measurement_jobs.length - 1])
        ?.scheduled_at ?? null,
    );
  const contact = detail.contact;
  const addressLine1 =
    typeof contact?.address_line_1 === "string" ? contact.address_line_1 : null;
  const cityLine = [
    typeof contact?.city === "string" ? contact.city : null,
    typeof contact?.pincode === "string" ? contact.pincode : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const orderAdjustments = detail.adjustments.filter((a) => a.amount !== 0);
  const payments = detail.transactions.filter(
    (t) =>
      (t.type === "payment" && t.status === "captured") ||
      (t.type === "refund" && (t.status === "captured" || t.status === "refunded")),
  );

  /* ── Deliver-to card: the attached address, else the first saved one ──── */
  const attached = Boolean(addressLine1);
  // The contact payload carries the attached address row's id — the picker
  // marks that row as the current selection.
  const attachedAddressId = typeof contact?.id === "string" ? contact.id : null;
  const savedPick = savedAddresses[0] ?? null;
  const deliverTo = attached
    ? {
        id: null as string | null,
        line1: addressLine1 ?? "",
        line2: typeof contact?.address_line_2 === "string" ? contact.address_line_2 : null,
        cityLine: [
          cityLine,
          typeof contact?.state === "string" ? contact.state : null,
        ]
          .filter(Boolean)
          .join(", "),
      }
    : savedPick?.address_line_1
      ? {
          id: savedPick.id,
          line1: savedPick.address_line_1,
          line2: savedPick.address_line_2,
          cityLine: [savedPick.city, savedPick.state, savedPick.pincode]
            .filter(Boolean)
            .join(", "),
        }
      : null;

  /* ── Booked visit — drives the slot sheet mode and the Pay CTA ───────── */
  // 'draft' is a held (unconfirmed) time — it preselects the sheet in PATCH
  // mode and shows the Pay CTA; the captain is assigned at payment.
  const activeJob =
    detail.measurement_jobs.find(
      (j) =>
        j.status === "draft" ||
        j.status === "scheduled" ||
        j.status === "in_progress" ||
        j.status === "needs_reassignment",
    ) ?? null;
  // A COMPLETED measurement means the visit happened — the order moves on
  // to confirming/paying and never asks for another slot (paidUp keeps
  // working because the lock below reads activeJob?.status as not-draft).
  const measuredDone = detail.measurement_jobs.some(
    (j) => j.status === "completed",
  );
  const hasActiveVisit = activeJob !== null || measuredDone;
  // The sheet only needs the scheduled instant to preselect the day and to
  // know it must PATCH (reschedule) instead of POST.
  const currentBooking: Booking | null =
    activeJob?.scheduled_at != null
      ? {
          job_id: activeJob.id,
          captain_id: null,
          captain_name: activeJob.captain_name,
          scheduled_at: activeJob.scheduled_at,
          status: (activeJob.status ?? "scheduled") as Booking["status"],
        }
      : null;
  const payAmount = detail.balance_due ?? (detail.total_price ?? 0);
  const paidUp = hasActiveVisit && payAmount <= 0;
  // Once the visit is a real booking (payment confirmed — no longer a
  // pre-payment draft hold), the address and slot are locked; changes go
  // through support.
  const bookingLocked =
    hasActiveVisit && (activeJob?.status !== "draft" || paidUp);

  /* ── COD — the ₹50 booking-advance fee row, waivable until delivery ────── */
  // The active fee is the order-level adjustment tagged source="cod"; it
  // renders in the summary automatically with the other adjustments.
  const codAdj = orderAdjustments.find((a) => a.source === "cod") ?? null;
  const codFee = codAdj?.amount ?? 0;
  const isDelivered = detail.fulfillment_status === "delivered";
  // Advance CTA: pay the total minus the fee while it can still be waived.
  const advanceAmount = Math.max(payAmount - codFee, 0);

  /* ── Bottom-bar state machine, priority order ────────────────────────────
     Driven by concrete facts (attached address → visit held or measured →
     how the booking is confirmed), never the order status:
       1 "address"   nothing attached              → Select Address
       2 "slot"      attached, no slot held AND
                     measurements not completed   → Select Slot (a completed
                                                     measurement never re-books)
       3 "confirm"   visit held or measured,
                     nothing paid, no COD choice  → Confirm Booking
       4 "cod"       COD confirmed, nothing paid  → Pay-advance (save pill)
       5 "underpaid" money captured, balance left → Pay balance (save pill
                                                     while a COD fee is live)
       6 "overpaid"  captured exceeds the total
                     (the order shrank)           → Explore More Designs +
                                                     refund-at-delivery note
       7 "settled"   captured == total            → confirmed card only
     Garment adds/edits/deletes move the order between these money states
     live — totals resync server-side, balance_due re-derives from the
     ledger. A delivered order with a balance falls through to a plain
     pay-balance CTA; a delivered order with nothing left to pay hides the
     bar entirely. */
  const codChosen = codAdj !== null;
  const advancePaid = detail.paid_amount > 0;
  const barState:
    | "address"
    | "slot"
    | "confirm"
    | "cod"
    | "underpaid"
    | "overpaid"
    | "settled"
    | "balance" =
    !attached
      ? "address"
      : isDelivered
        ? "balance"
        : currentBooking == null && !measuredDone
          ? "slot"
          : advancePaid
            ? payAmount > 0
              ? "underpaid"
              : payAmount < 0
                ? "overpaid"
                : "settled"
            : codChosen
              ? "cod"
              : "confirm";
  // The cards follow the same ladder, strictly: the prominent confirmation
  // card in every money-moved state (COD confirmed or captured > 0) — a
  // slot must exist AND be locked in before anything reads "confirmed".
  // Without a slot it's the draft card with the address only; with an
  // unpaid slot, address + held time.
  const bookingConfirmed =
    barState === "cod" ||
    barState === "underpaid" ||
    barState === "overpaid" ||
    barState === "settled";

  /* ── Pay ₹X to Book — Cashfree drop-in, then the paying page verifies ──── */
  const handlePay = async () => {
    if (paying) return;
    setPaying(true);
    setPlaceError(null);
    try {
      // Amount, name and phone are resolved server-side from the order —
      // the client only receives the session to open.
      const init = await checkoutApi.startOrderPayment(id);
      if (!init.payment_session_id) {
        throw new Error(strings.orderDetail.payInitError);
      }
      // Sandbox sessions (test-mode phones) need the SDK in sandbox mode;
      // live sessions need production — the SDK's default is sandbox.
      const cashfree = await loadCashfree(
        init.environment === "TEST" ? "sandbox" : "production",
      );
      try {
        await cashfree.checkout({
          paymentSessionId: init.payment_session_id,
          redirectTarget: "_modal",
        });
      } catch {
        // Modal dismissed or payment failed inside Cashfree — don't assume;
        // the paying page checks the server (and the gateway) before
        // declaring anything.
      }
      router.push(`/app/orders/${id}/paying`);
    } catch (err) {
      setPlaceError(
        err instanceof Error ? err.message : strings.orderDetail.payInitError,
      );
      // slot_taken means the server already released the dead hold —
      // refetch so the CTA ladder flips back to "Select Slot" at once.
      if (err instanceof ApiError && err.code === "slot_taken") {
        await refreshDetail();
      }
    } finally {
      setPaying(false);
    }
  };

  /* ── Cash on Delivery — confirm the booking now, add the ₹50 fee; the
     server confirms the order (draft hold → booked visit) and returns the
     refreshed totals, so the CTA becomes "Pay ₹<advance> in Advance" ───── */
  const handleChooseCod = async () => {
    if (choosingCod) return;
    setChoosingCod(true);
    setChoiceError(null);
    try {
      await checkoutApi.chooseCodPayment(id);
      setPayChoiceOpen(false);
      setCodConfirmOpen(false);
      await refreshDetail();
    } catch (err) {
      if (err instanceof ApiError && err.code === "slot_taken") {
        // The dead hold is released server-side — drop the sheets, put the
        // message at the CTA (the sheet holding choiceError is closing),
        // and refetch so the ladder flips back to "Select Slot".
        setPayChoiceOpen(false);
        setCodConfirmOpen(false);
        setPlaceError(err.message);
        await refreshDetail();
        return;
      }
      setChoiceError(
        err instanceof Error ? err.message : strings.payChoice.codError,
      );
    } finally {
      setChoosingCod(false);
    }
  };

  /* ── Select Address — saved addresses pick inline from the sheet;
     with none saved, the full-page form saves one AND attaches it ────────── */
  const handleSelectAddress = () => {
    if (savedAddresses.length > 0) {
      setPickerOpen(true);
      return;
    }
    router.push(`/app/orders/${id}/address`);
  };

  /* ── Address picker sheet ──────────────────────────────────────────────── */
  const refreshDetail = async () => {
    try {
      setDetail(await ordersApi.getOrderDetail(id));
    } catch {
      // picker already shows its own error; keep the current detail
    }
  };

  const handlePick = async (addrId: string) => {
    if (pickingId) return;
    if (addrId === attachedAddressId) {
      setPickerOpen(false);
      return;
    }
    setPickingId(addrId);
    setPickError(null);
    try {
      await ordersApi.attachOrderAddress(id, addrId);
      setPickerOpen(false);
      setAddressRefreshing(true);
      await refreshDetail();
    } catch (err) {
      setPickError(err instanceof Error ? err.message : strings.orderDetail.attachError);
    } finally {
      setPickingId(null);
      setAddressRefreshing(false);
    }
  };

  return (
    <ScreenShell className="px-4 pt-6">
      {/* Back + invoice + support */}
      <div className="flex items-center justify-between gap-3">
        <Link
          href="/app"
          className="inline-flex min-h-[44px] items-center gap-1 text-caption font-semibold text-navy-interactive"
        >
          <ArrowLeft size={16} />
          {strings.orderDetail.back}
        </Link>
        <div className="flex items-center gap-2">
          {!isDraft && (
            <Link
              href={`/invoice/${detail.id}`}
              className="inline-flex min-h-[44px] items-center text-caption font-semibold text-navy-interactive"
            >
              {strings.orderDetail.viewInvoice}
            </Link>
          )}
          <a
            href="https://wa.me/918147497006"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-[44px] items-center gap-1.5 rounded-pill border-[1.5px] border-ink-navy px-3 text-caption font-semibold text-ink-navy transition-all duration-200 ease-brand active:scale-[0.97] active:bg-mist-navy"
          >
            <ChatBubble size={16} />
            {strings.orderDetail.support}
          </a>
        </div>
      </div>

      {/* Header */}
      <header className="mt-2">
        <p className="eyebrow">{strings.orderDetail.title}</p>
        <h1 className="mt-1 font-heading text-h1 text-ink-navy">
          <MonoNumber>{displayOrderNumber(detail.order_number, detail.id)}</MonoNumber>
        </h1>
        {detail.created_at && (
          <p className="mt-1 text-caption text-muted">
            Placed {formatDate(detail.created_at)}
          </p>
        )}
      </header>

      {/* Statuses — separate labelled rows, like the dashboard cards */}
      <section className="mt-4 rounded-card border border-hairline bg-chalk-white p-4 shadow-card">
        <OrderStatusRows
          fulfillmentStatus={detail.fulfillment_status}
          paymentStatus={detail.payment_status}
        />
      </section>

      {/* Home visit + address + the style captain's measurement job(s) */}
      {(visit || addressLine1 || detail.measurement_jobs.length > 0) && (
        <section className="mt-3 rounded-card border border-hairline bg-chalk-white p-4 shadow-card">
          <p className="eyebrow">{strings.orderDetail.visitTitle}</p>
          {visit && (
            <div className="mt-2 flex items-start gap-2">
              <Calendar size={16} className="mt-0.5 text-accent-text" />
              <p className="text-body text-ink">{visit}</p>
            </div>
          )}
          {addressLine1 && (
            <div className="mt-2 flex items-start gap-2">
              <MapPin size={16} className="mt-0.5 text-accent-text" />
              <p className="text-body text-ink">
                {addressLine1}
                {typeof contact?.address_line_2 === "string" &&
                  contact.address_line_2 &&
                  `, ${contact.address_line_2}`}
                {cityLine && (
                  <>
                    <br />
                    <span className="text-caption text-muted">{cityLine}</span>
                  </>
                )}
              </p>
            </div>
          )}
          {detail.measurement_jobs.map((job) => (
            <div key={job.id} className="mt-3 border-t border-hairline pt-1">
              {job.status && (
                <div className="flex items-center justify-between gap-3 py-1">
                  <span className="text-caption text-muted">
                    {strings.orderDetail.visitStatusLabel}
                  </span>
                  <StatusPill status={job.status} kind="fulfillment" />
                </div>
              )}
              <JobRow label={strings.orderDetail.captainLabel}>
                {job.captain_name ?? strings.orderDetail.captainUnassigned}
              </JobRow>
              {job.completed_at && (
                <JobRow label={strings.orderDetail.completedLabel}>
                  {visitDateTimeLabel(job.completed_at)}
                </JobRow>
              )}
              {job.notes && (
                <JobRow label={strings.orderDetail.notesLabel}>{job.notes}</JobRow>
              )}
            </div>
          ))}
        </section>
      )}

      {/* Garment orders — the full breakdown */}
      {detail.garment_orders.map((g, gi) => {
        const selections = g.items.filter((i) => i.type === "selection");
        const addons = g.items.filter((i) => i.type === "add_on");
        return (
          <section
            key={g.id}
            className="mt-3 rounded-card border border-hairline bg-chalk-white p-4 shadow-card"
          >
            <div className="flex items-center justify-between gap-3">
              <h2 className="font-heading text-h3 text-ink-navy">
                {g.garment_label ?? "Garment"}
                {detail.garment_orders.length > 1 ? ` ${gi + 1}` : ""}
              </h2>
              <span className="flex flex-none items-center gap-2">
                {g.status && <StatusPill status={g.status} kind="fulfillment" />}
                {/* Remove — never on the last garment (the order is
                    cancelled instead); paid orders shrink the same way and
                    the CTA re-derives. */}
                {selectionsEditable && detail.garment_orders.length > 1 && (
                  <button
                    type="button"
                    aria-label={strings.orderDetail.removeGarmentCta}
                    disabled={removingGOId !== null}
                    onClick={() => void handleRemoveGarment(g.id)}
                    className="flex h-7 w-7 items-center justify-center rounded-pill text-muted transition-all ease-brand hover:bg-warm-sand hover:text-accent-text active:scale-90 disabled:opacity-40"
                  >
                    <Trash size={14} />
                  </button>
                )}
              </span>
            </div>

            {selections.length > 0 && (
              <>
                <p className="eyebrow mt-4">{strings.orderDetail.selectionsTitle}</p>
                <div className="mt-1">
                  {selections.map((item, idx) => (
                    <ItemRow key={idx} item={item} />
                  ))}
                </div>
              </>
            )}

            {addons.length > 0 && (
              <>
                <p className="eyebrow mt-4">{strings.orderDetail.addonsTitle}</p>
                <div className="mt-1">
                  {addons.map((item, idx) => (
                    <ItemRow key={idx} item={item} />
                  ))}
                </div>
              </>
            )}

            {/* Edit selections — same sheet + flow as the admin dashboard's
                edit-selections, persisted via the customer endpoints. Only
                while no money has moved (paid orders are locked). */}
            {selectionsEditable && g.garment_id && (
              <button
                type="button"
                onClick={() =>
                  setEditingGOId((cur) => (cur === g.id ? null : g.id))
                }
                className="mt-4 flex w-full items-center justify-center gap-1.5 rounded-card border border-dashed border-hairline-strong px-3 py-2.5 text-caption font-semibold text-navy-interactive transition-all ease-brand active:scale-[0.98] active:bg-mist-navy"
              >
                <Pencil size={14} />
                {editingGOId === g.id
                  ? strings.orderDetail.selectionsCloseCta
                  : strings.orderDetail.selectionsEditCta}
              </button>
            )}

            {/* Customer note — the customer's message for the style
                captain. Editable at every order state; MYOD orders start
                empty (the design itself lives in the selection rows). */}
            {g.user_note ? (
              <div className="mt-4 flex items-start gap-2 rounded-card bg-warm-sand/70 p-3">
                <Thread size={16} className="mt-0.5 text-accent-text" />
                <p className="min-w-0 flex-1 whitespace-pre-line break-words text-body text-ink">
                  <span className="text-caption text-muted">
                    {strings.orderDetail.noteTitle} —{" "}
                  </span>
                  {g.user_note}
                </p>
                <button
                  type="button"
                  onClick={() => openNoteEditor(g.id, g.user_note)}
                  className="flex-none rounded-pill px-2 py-1 text-caption font-semibold text-navy-interactive transition-all ease-brand active:scale-95 active:bg-mist-navy"
                >
                  {strings.orderDetail.noteEditCta}
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => openNoteEditor(g.id, null)}
                className="mt-4 flex w-full items-center justify-center gap-1.5 rounded-card border border-dashed border-hairline-strong px-3 py-2.5 text-caption font-semibold text-navy-interactive transition-all ease-brand active:scale-[0.98] active:bg-mist-navy"
              >
                <Thread size={14} />
                {strings.orderDetail.noteAddCta}
              </button>
            )}

            {/* Design inspiration — the images (MYOD renders + uploads) the
                tailor receives with the design. Uploads allowed while the
                design is still editable (no money moved). */}
            <InspirationGallery
              orderId={detail.id}
              garmentOrderId={g.id}
              assets={g.assets}
              editable={selectionsEditable}
              onUploaded={() => {
                void refreshDetail();
              }}
            />

            {/* The selection editor — identical UX to the admin dashboard
                (catalog tree, component pills, add-on matrix), saving through
                the customer selection endpoints instead of the admin tables.
                Prices never round-trip: totals re-derive server-side and the
                refetch repaints the card. */}
            {selectionsEditable && g.garment_id && (
              <GarmentSelectionSheet
                open={editingGOId === g.id}
                garmentId={g.garment_id}
                garmentOrderId={g.id}
                initialItems={seedSelectionItems(g)}
                basePrice={g.base_price}
                persistence={makeCustomerPersistence(detail.id, g.id)}
                onClose={() => setEditingGOId(null)}
                onSaveComplete={() => {
                  void refreshDetail();
                }}
              />
            )}

            <div className="mt-4 border-t border-hairline pt-2">
              <SummaryRow
                label={strings.orderDetail.basePrice}
                value={formatPrice(g.base_price ?? 0)}
              />
              <SummaryRow
                label={strings.orderDetail.garmentTotal}
                value={formatPrice(g.total_price ?? 0)}
                strong
              />
            </div>
          </section>
        );
      })}

      {/* Add another garment — routes to Explore; the design's order flow
          offers appending it to this order (one visit for everything). */}
      {selectionsEditable && (
        <button
          type="button"
          onClick={() => router.push("/app/explore")}
          className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-card border border-dashed border-hairline-strong px-3 py-3 text-caption font-semibold text-navy-interactive transition-all ease-brand active:scale-[0.98] active:bg-mist-navy"
        >
          <Plus size={14} />
          {strings.orderDetail.addGarmentCta}
        </button>
      )}

      {removeError && (
        <Banner variant="error" className="mt-3">
          <p className="text-caption">{removeError}</p>
        </Banner>
      )}

      {/* Order-level adjustments + payment summary */}
      <section className="mt-3 rounded-card border border-hairline bg-chalk-white p-4 shadow-card">
        <p className="eyebrow">{strings.orderDetail.summaryTitle}</p>
        <div className="mt-2">
          {/* Order total leads — adjustments (COD fee, discounts) follow it,
              then the ledger rows. */}
          <SummaryRow
            label={strings.orderDetail.total}
            value={formatPrice(detail.total_price ?? 0)}
            strong
          />
          {orderAdjustments.map((a, idx) => (
            <SummaryRow
              key={idx}
              label={a.label ?? (a.type === "discount" ? "Discount" : "Adjustment")}
              value={`${a.amount < 0 ? "−" : "+"}${formatPrice(Math.abs(a.amount))}`}
            />
          ))}
          <SummaryRow
            label={strings.orderDetail.paid}
            value={formatPrice(detail.paid_amount)}
          />
          <SummaryRow
            label={strings.orderDetail.balanceDue}
            value={formatPrice(detail.balance_due)}
          />
        </div>
      </section>

      {/* Payment ledger */}
      {payments.length > 0 && (
        <section className="mt-3 rounded-card border border-hairline bg-chalk-white p-4 shadow-card">
          <p className="eyebrow">{strings.orderDetail.paymentsTitle}</p>
          <div className="mt-2">
            {payments.map((t) => {
              const isRefund = t.type === "refund";
              return (
                <div
                  key={t.id}
                  className="flex items-center justify-between gap-3 border-b border-hairline py-2.5 last:border-b-0"
                >
                  <span className="min-w-0">
                    <span className="block text-body font-medium text-ink-navy">
                      {isRefund ? strings.orderDetail.refund : "Payment"}
                    </span>
                    <span className="block text-caption text-muted">
                      {strings.orderDetail.paymentMethod(t.method)}
                      {t.captured_at || t.refunded_at || t.created_at
                        ? ` · ${formatDate(
                            (t.captured_at ?? t.refunded_at ?? t.created_at) as string,
                          )}`
                        : ""}
                    </span>
                  </span>
                  <span className="font-mono text-data text-ink-navy">
                    {isRefund ? "−" : "+"}
                    {formatPrice(t.amount ?? 0)}
                  </span>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Bottom bar — pinned to the viewport bottom. Its state follows
          concrete facts (attached address → drafted slot → how the booking
          is confirmed), never the order status. Money moved keeps the bar
          up ("Booking confirmed" card) until delivery; only a delivered
          order with nothing left to pay hides it entirely. */}
      {(!isDelivered || payAmount > 0) && (
      <div className="sticky bottom-0 z-20 -mx-4 -mb-6 mt-5 border-t border-hairline bg-chalk-white px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 shadow-[0_-6px_16px_-8px_rgba(23,42,72,0.25)]">
        {/* Draft card — address + held time. Before COD is confirmed or the
            advance is paid the slot is only a draft hold: no check, no
            "confirmed" language, just the time and the address. With no slot
            yet it degrades to the address alone. */}
        {(attached || addressRefreshing) && !bookingConfirmed && (
          <div className="rounded-card border border-hairline bg-chalk-white p-4">
            <div className="flex items-start gap-3">
              <span
                aria-hidden
                className="mt-0.5 flex h-9 w-9 flex-none items-center justify-center rounded-pill bg-warm-sand text-accent-text"
              >
                <MapPin size={16} />
              </span>
              <div className="min-w-0 flex-1">
                {/* stale content stays visible (dimmed) so the card doesn't jump */}
                <div className={addressRefreshing ? "pointer-events-none opacity-40" : ""}>
                  {attached && (
                    <>
                      <p className="text-body font-medium text-ink-navy">
                        {deliverTo?.line1}
                      </p>
                      {(deliverTo?.line2 || deliverTo?.cityLine) && (
                        <p className="text-caption text-muted">
                          {[deliverTo?.line2, deliverTo?.cityLine].filter(Boolean).join(", ")}
                        </p>
                      )}
                      {currentBooking && (
                        <div className="mt-3 flex items-center gap-2 border-t border-hairline pt-3">
                          <Clock size={14} className="flex-none text-muted" />
                          <p className="text-caption font-medium text-ink-navy">
                            {visitDateTimeLabel(currentBooking.scheduled_at)}
                          </p>
                        </div>
                      )}
                    </>
                  )}
                </div>
                {addressRefreshing && (
                  <Loader
                    label={strings.orderDetail.updatingAddress}
                    className={attached ? "mt-2" : ""}
                  />
                )}
              </div>
              {!bookingLocked && !addressRefreshing && (
                <button
                  type="button"
                  onClick={() => setPickerOpen(true)}
                    className="flex-none rounded-pill px-2 py-1 text-caption font-semibold text-navy-interactive transition-all ease-brand active:scale-95 active:bg-mist-navy"
                >
                  {strings.orderDetail.changeAddress}
                </button>
              )}
            </div>
          </div>
        )}

        {/* Prominent confirmation card — the hold became a real booking
            (COD confirmed or advance captured): time + address, front and
            centre above the CTA. */}
        {attached && bookingConfirmed && (
          <div className="rounded-card border-[1.5px] border-success/30 bg-success-bg p-4">
            <div className="flex items-start gap-3">
              <span
                aria-hidden
                className="mt-0.5 flex h-6 w-6 flex-none items-center justify-center rounded-pill bg-success text-chalk-white"
              >
                <Check size={13} strokeWidth={2.5} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-body font-semibold text-ink-navy">
                  {strings.orderDetail.bookingConfirmedTitle}
                </p>
                {currentBooking && (
                  <p className="mt-1 flex items-center gap-1.5 text-caption text-ink/80">
                    <Calendar size={13} className="flex-none text-accent-text" />
                    {visitDateTimeLabel(currentBooking.scheduled_at)}
                  </p>
                )}
                <p className="mt-1 text-caption text-ink/70">
                  {[deliverTo?.line1, deliverTo?.line2, deliverTo?.cityLine]
                    .filter(Boolean)
                    .join(", ")}
                </p>
              </div>
            </div>
          </div>
        )}

        {placeError && (
          <Banner variant="error" className="mt-3">
            <p className="text-caption">{placeError}</p>
          </Banner>
        )}

        {/* CTA ladder — one control per state, priority order. */}
        {barState === "address" && (
          <Button
            fullWidth
            className="mt-3"
            onClick={handleSelectAddress}
            loading={addressRefreshing}
            disabled={addressRefreshing}
          >
            {strings.orderDetail.selectAddressCta}
          </Button>
        )}
        {barState === "slot" && (
          <Button fullWidth className="mt-3" onClick={() => setSlotOpen(true)}>
            {strings.orderDetail.selectSlotCta}
          </Button>
        )}
        {barState === "confirm" && (
          <Button fullWidth className="mt-3" onClick={() => setPayChoiceOpen(true)}>
            {strings.orderDetail.confirmBookingCta}
          </Button>
        )}
        {barState === "cod" && (
          <Button
            variant="secondary"
            fullWidth
            className="mt-3 !px-3"
            loading={paying}
            disabled={paying}
            onClick={() => void handlePay()}
          >
            {/* One line — the advance composition is long, so the label
                gets the pill's full width (trim px) and never wraps. */}
            <span className="whitespace-nowrap">
              {strings.orderDetail.payAdvancePrefix}{" "}
              <span aria-hidden className="line-through opacity-50">
                {formatPrice(payAmount)}
              </span>{" "}
              <span className="font-semibold">{formatPrice(advanceAmount)}</span>{" "}
              {strings.orderDetail.payAdvanceSuffix}{" "}
              <span className="ml-1 inline-block rounded-pill bg-ink-navy px-2 py-px text-[10px] font-semibold uppercase tracking-wider text-chalk-white">
                {strings.orderDetail.saveTag(formatPrice(codFee))}
              </span>
            </span>
          </Button>
        )}
        {barState === "underpaid" &&
          (codChosen ? (
            // COD fee still live on the balance: paying it in full in
            // advance waives the fee — same composition as the COD confirm.
            <Button
              variant="secondary"
              fullWidth
              className="mt-3 !px-3"
              loading={paying}
              disabled={paying}
              onClick={() => void handlePay()}
            >
              <span className="whitespace-nowrap">
                {strings.orderDetail.payAdvancePrefix}{" "}
                <span aria-hidden className="line-through opacity-50">
                  {formatPrice(payAmount)}
                </span>{" "}
                <span className="font-semibold">{formatPrice(advanceAmount)}</span>{" "}
                {strings.orderDetail.payAdvanceSuffix}{" "}
                <span className="ml-1 inline-block rounded-pill bg-ink-navy px-2 py-px text-[10px] font-semibold uppercase tracking-wider text-chalk-white">
                  {strings.orderDetail.saveTag(formatPrice(codFee))}
                </span>
              </span>
            </Button>
          ) : (
            <Button
              fullWidth
              className="mt-3"
              loading={paying}
              disabled={paying}
              onClick={() => void handlePay()}
            >
              {strings.orderDetail.payBalanceCta(formatPrice(payAmount))}
            </Button>
          ))}
        {barState === "overpaid" && (
          <>
            {/* The order shrank below what was captured — the gap is never
                auto-refunded; it reads as refund-at-delivery unless the
                customer fills it with more designs. */}
            <Button
              variant="secondary"
              fullWidth
              className="mt-3"
              onClick={() => router.push("/app/explore")}
            >
              {strings.orderDetail.exploreMoreCta}
            </Button>
            <p className="mt-2 text-center text-caption text-muted">
              {strings.orderDetail.overpaidNote(formatPrice(Math.abs(payAmount)))}
            </p>
          </>
        )}
        {/* barState "settled" renders no CTA — the confirmed card above
            and the Paid summary are the whole story. */}
        {barState === "balance" && (
          <Button
            fullWidth
            className="mt-3"
            loading={paying}
            disabled={paying}
            onClick={() => void handlePay()}
          >
            {strings.orderDetail.payBalanceCta(formatPrice(payAmount))}
          </Button>
        )}

        {!bookingLocked && currentBooking && attached && (
          <button
            type="button"
            onClick={() => setSlotOpen(true)}
            className="mt-2 w-full py-1 text-center text-caption font-semibold text-navy-interactive underline"
          >
            {strings.orderDetail.changeSlot}
          </button>
        )}
      </div>
      )}

      {/* Address picker — Change opens this; rows attach on tap */}
      <BottomSheet
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        title={strings.orderDetail.addressPageTitle}
      >
        <div className="pb-2">
          {savedAddresses.map((addr) => {
            const selected = addr.id === attachedAddressId;
            const picking = pickingId === addr.id;
            // Outside the fence: shown but not pickable — the verdict is
            // visible up front instead of after a failed attach.
            const unserviceable = addr.serviceable === false;
            return (
              <button
                key={addr.id}
                type="button"
                disabled={pickingId !== null || unserviceable}
                aria-disabled={pickingId !== null || unserviceable}
                onClick={() => void handlePick(addr.id)}
                className={`mt-3 flex w-full items-start gap-3 rounded-card border-[1.5px] p-4 text-left transition ${
                  unserviceable
                    ? "cursor-not-allowed border-hairline bg-mist-navy/20 opacity-55"
                    : selected
                      ? "border-navy-interactive bg-mist-navy/50"
                      : "border-hairline bg-chalk-white active:bg-mist-navy/30"
                }`}
              >
                <span
                  aria-hidden
                  className={`mt-0.5 flex h-9 w-9 flex-none items-center justify-center rounded-pill ${
                    selected
                      ? "bg-navy-interactive text-chalk-white"
                      : "bg-warm-sand text-accent-text"
                  }`}
                >
                  {selected ? <Check size={16} /> : <MapPin size={16} />}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-body font-medium text-ink-navy">
                    {addr.address_line_1}
                  </p>
                  {addr.address_line_2 && (
                    <p className="text-caption text-muted">{addr.address_line_2}</p>
                  )}
                  <p className="mt-0.5 text-caption text-muted">
                    {[addr.city, addr.state, addr.pincode].filter(Boolean).join(", ")}
                  </p>
                  {unserviceable && (
                    <p className="mt-1 text-caption font-medium text-accent-text">
                      {strings.serviceability.notServiceableYet}
                    </p>
                  )}
                </div>
                {picking && (
                  <span className="flex-none text-caption text-muted">
                    {strings.orderDetail.selecting}
                  </span>
                )}
              </button>
            );
          })}

          {pickError && (
            <Banner variant="error" className="mt-3">
              <p className="text-caption">{pickError}</p>
            </Banner>
          )}

          {/* Add new address — opens the add sheet stacked above this one */}
          <button
            type="button"
            onClick={() => setAddOpen(true)}
            className="mt-3 flex w-full items-center gap-3 rounded-card border border-dashed border-hairline-strong bg-chalk-white/70 p-4 text-left transition-all ease-brand active:scale-[0.99] active:bg-mist-navy/40"
          >
            <span
              aria-hidden
              className="flex h-9 w-9 flex-none items-center justify-center rounded-pill bg-mist-navy text-ink-navy"
            >
              <Plus size={16} />
            </span>
            <p className="text-body font-medium text-navy-interactive">
              {strings.orderDetail.addNewAddress}
            </p>
          </button>
        </div>
      </BottomSheet>

      {/* Add address — the same shared form as the account page; saving
          returns to the picker, which now lists the new address */}
      <BottomSheet
        open={addOpen}
        onClose={() => setAddOpen(false)}
        title={strings.account.addAddressTitle}
      >
        <AddressForm
          active={addOpen}
          saveAddress={(fields, pin) =>
            addressesApi.createAddress({
              address_line_1: fields.address_line_1,
              address_line_2: fields.address_line_2 || null,
              city: fields.city,
              state: fields.state,
              pincode: fields.pincode,
              coordinates: pin,
            })
          }
          onSaved={(addr) => {
            if (addr) {
              setSavedAddresses((list) => [...list, addr]);
              setAddOpen(false);
            }
          }}
        />
      </BottomSheet>

      {/* Slot picker — Continue (or Change slot) opens this; Select books
          (or reschedules) the measurement visit, then the CTA becomes
          "Continue" once the refreshed detail lands */}
      <SlotSheet
        open={slotOpen}
        onClose={() => setSlotOpen(false)}
        orderId={id}
        currentBooking={currentBooking}
        onBooked={() => {
          setSlotOpen(false);
          void refreshDetail();
        }}
        onAlreadyBooked={() => {
          setSlotOpen(false);
          void refreshDetail();
        }}
      />

      {/* Pay-method choice — Pay opens this on a fresh unpaid order. Online
          (free) goes straight to the gateway; Cash on Delivery confirms the
          booking right away and adds the ₹50 advance fee, which is waived
          if the advance is paid before delivery. */}
      <BottomSheet
        open={payChoiceOpen}
        onClose={() => setPayChoiceOpen(false)}
        title={strings.payChoice.title}
      >
        <div className="pb-2">
          <button
            type="button"
            disabled={choosingCod}
            onClick={() => {
              setPayChoiceOpen(false);
              void handlePay();
            }}
            className="flex w-full items-center gap-3 rounded-card border-[1.5px] border-hairline bg-chalk-white p-4 text-left transition-all ease-brand active:scale-[0.99] active:bg-mist-navy/30 disabled:opacity-50"
          >
            <span
              aria-hidden
              className="flex h-9 w-9 flex-none items-center justify-center rounded-pill bg-warm-sand text-accent-text"
            >
              <ShieldCheck size={16} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-body font-medium text-ink-navy">
                {strings.payChoice.onlineLabel}
              </span>
              <span className="block text-caption text-muted">
                {strings.payChoice.onlineCaption}
              </span>
            </span>
            <span className="flex-none rounded-pill bg-success-bg px-2.5 py-1 text-caption font-semibold text-success-text">
              {strings.payChoice.onlineTag}
            </span>
          </button>

          <button
            type="button"
            disabled={choosingCod}
            onClick={() => setCodConfirmOpen(true)}
            className="mt-3 flex w-full items-center gap-3 rounded-card border-[1.5px] border-hairline bg-chalk-white p-4 text-left transition-all ease-brand active:scale-[0.99] active:bg-mist-navy/30 disabled:opacity-50"
          >
            <span
              aria-hidden
              className="flex h-9 w-9 flex-none items-center justify-center rounded-pill bg-warm-sand text-accent-text"
            >
              <HomeVisit size={16} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-body font-medium text-ink-navy">
                {strings.payChoice.codLabel}
              </span>
              <span className="block text-caption text-muted">
                {strings.payChoice.codCaption}
              </span>
            </span>
            <span className="flex-none rounded-pill bg-warm-sand/80 px-2.5 py-1 text-caption font-semibold text-accent-text">
              {strings.payChoice.codTag(formatPrice(COD_FEE_PREVIEW))}
            </span>
          </button>
        </div>
      </BottomSheet>

      {/* COD soft-confirm — stacks above the choice sheet. The case for
          paying online (fee waived, no dummy bookings, refundable) before
          the customer commits to Cash on Delivery. */}
      <BottomSheet
        open={codConfirmOpen}
        onClose={() => setCodConfirmOpen(false)}
        title={strings.payChoice.codSheetTitle}
      >
        <div className="pb-2">
          <div className="mt-2 flex items-start gap-3">
            <span
              aria-hidden
              className="mt-0.5 flex h-9 w-9 flex-none items-center justify-center rounded-pill bg-warm-sand text-accent-text"
            >
              <Sparkles size={16} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-body font-medium text-ink-navy">
                {strings.payChoice.codSheetSaveTitle(formatPrice(COD_FEE_PREVIEW))}
              </p>
              <p className="text-caption text-muted">
                {strings.payChoice.codSheetSaveBody}
              </p>
            </div>
          </div>

          <div className="mt-3 flex items-start gap-3">
            <span
              aria-hidden
              className="mt-0.5 flex h-9 w-9 flex-none items-center justify-center rounded-pill bg-warm-sand text-accent-text"
            >
              <Calendar size={16} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-body font-medium text-ink-navy">
                {strings.payChoice.codSheetHonestTitle}
              </p>
              <p className="text-caption text-muted">
                {strings.payChoice.codSheetHonestBody}
              </p>
            </div>
          </div>

          <div className="mt-3 flex items-start gap-3">
            <span
              aria-hidden
              className="mt-0.5 flex h-9 w-9 flex-none items-center justify-center rounded-pill bg-warm-sand text-accent-text"
            >
              <ShieldCheck size={16} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-body font-medium text-ink-navy">
                {strings.payChoice.codSheetRefundTitle}
              </p>
              <p className="text-caption text-muted">
                {strings.payChoice.codSheetRefundBody}
              </p>
            </div>
          </div>

          {/* COD never forfeits the saving — paying online later still
              waives the fee until delivery. Styled as a quiet tip card,
              not another point row. */}
          <div className="mt-3 flex items-start gap-2.5 rounded-card bg-warm-sand/70 p-3">
            <span aria-hidden className="text-[18px] leading-none">
              🙂
            </span>
            <p className="min-w-0 flex-1 text-caption font-medium text-ink/85">
              {strings.payChoice.codSheetAnytimeTitle(formatPrice(COD_FEE_PREVIEW))}
            </p>
          </div>

          {choiceError && (
            <Banner variant="error" className="mt-3">
              <p className="text-caption">{choiceError}</p>
            </Banner>
          )}

          <Button
            fullWidth
            className="mt-4"
            disabled={choosingCod}
            onClick={() => {
              setCodConfirmOpen(false);
              setPayChoiceOpen(false);
              void handlePay();
            }}
          >
            {strings.payChoice.codSheetOnlineCta}{" "}
            {/* Same save slot as the COD-confirmed advance CTA — navy pill
                reads on the tape fill too. The sheet always previews the
                default fee (no COD row exists yet at this point). */}
            <span className="ml-1 inline-block rounded-pill bg-ink-navy px-2 py-px text-[10px] font-semibold uppercase tracking-wider text-chalk-white">
              {strings.orderDetail.saveTag(formatPrice(COD_FEE_PREVIEW))}
            </span>
          </Button>
          <Button
            variant="secondary"
            fullWidth
            className="mt-2"
            loading={choosingCod}
            disabled={choosingCod}
            onClick={() => void handleChooseCod()}
          >
            {strings.payChoice.codSheetConfirmCta(
              formatPrice(payAmount + COD_FEE_PREVIEW),
            )}
          </Button>
        </div>
      </BottomSheet>

      {/* Garment note editor — add or edit the customer's note for the
          style captain. Saving clears whitespace-only input server-side. */}
      <BottomSheet
        open={noteEditingId !== null}
        onClose={() => setNoteEditingId(null)}
        title={strings.orderDetail.noteSheetTitle}
        footer={
          <Button
            fullWidth
            loading={noteSaving}
            disabled={noteSaving}
            onClick={() => void handleSaveNote()}
          >
            {strings.orderDetail.noteSave}
          </Button>
        }
      >
        <div className="pb-2">
          <textarea
            value={noteDraft}
            onChange={(e) => setNoteDraft(e.target.value)}
            rows={5}
            maxLength={2000}
            placeholder={strings.orderDetail.notePlaceholder}
            autoFocus
            className="w-full resize-none rounded-card border border-hairline-strong bg-chalk-white px-3 py-2.5 text-body text-ink-navy placeholder:text-muted focus:border-navy-interactive focus:outline-none"
          />
          <p className="mt-1.5 text-right text-caption text-muted">
            {noteDraft.length}/2000
          </p>
          {noteError && (
            <Banner variant="error" className="mt-2">
              <p className="text-caption">{noteError}</p>
            </Banner>
          )}
        </div>
      </BottomSheet>
    </ScreenShell>
  );
}
