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
 * Draft orders are supported too: labels resolve live and the invoice action
 * becomes "Continue designing".
 */

import { useCallback, useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";

import { OrderStatusRows, StatusPill } from "@/components/order/OrderStatus";
import { ScreenShell } from "@/components/layout/ScreenShell";
import { Button } from "@/components/ui/Button";
import { MonoNumber } from "@/components/ui/MonoNumber";
import { ArrowLeft, Calendar, ChatBubble, MapPin, Thread } from "@/components/ui/icons";
import { ApiError, ordersApi } from "@/lib/api";
import {
  displayOrderNumber,
  formatDate,
  slotVisitLabel,
  visitDateTimeLabel,
} from "@/lib/order-display";
import { formatPrice } from "@/lib/pricing";
import { strings } from "@/lib/strings";
import { generateInvoicePdf, type InvoiceInput } from "@/lib/invoice-pdf";
import type {
  CustomerOrderDetail,
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

/* ============================================================ */

export default function OrderDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();

  const [detail, setDetail] = useState<CustomerOrderDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);

  const [invoiceBusy, setInvoiceBusy] = useState(false);
  const [invoiceError, setInvoiceError] = useState<string | null>(null);

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

  useEffect(() => {
    void load();
  }, [load]);

  /* ── Invoice download — same data + generator as the /invoice page ────── */
  async function handleDownloadInvoice() {
    setInvoiceBusy(true);
    setInvoiceError(null);
    try {
      const res = await fetch(`/api/v1/public/invoice/${id}`);
      if (!res.ok) throw new Error(strings.orderDetail.invoiceError);
      const input = (await res.json()) as InvoiceInput;
      await generateInvoicePdf(input);
    } catch {
      setInvoiceError(strings.orderDetail.invoiceError);
    } finally {
      setInvoiceBusy(false);
    }
  }

  /* ── Loading / error states ──────────────────────────────────────────── */
  if (loading) {
    return (
      <ScreenShell className="px-4 pt-6">
        <div className="space-y-3" aria-busy="true">
          <div className="h-8 w-40 animate-pulse rounded-pill bg-mist-navy/60" />
          <div className="h-24 animate-pulse rounded-card bg-mist-navy/60" />
          <div className="h-64 animate-pulse rounded-card bg-mist-navy/60" />
        </div>
      </ScreenShell>
    );
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

  return (
    <ScreenShell className="px-4 pt-6">
      {/* Back + support — WhatsApp chat with the team */}
      <div className="flex items-center justify-between gap-3">
        <Link
          href="/app"
          className="inline-flex min-h-[44px] items-center gap-1 text-caption font-semibold text-navy-interactive"
        >
          <ArrowLeft size={16} />
          {strings.orderDetail.back}
        </Link>
        <a
          href="https://wa.me/918147497006"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex min-h-[44px] items-center gap-1.5 rounded-pill border-[1.5px] border-ink-navy px-3 text-caption font-semibold text-ink-navy transition-all duration-200 ease-brand hover:bg-mist-navy"
        >
          <ChatBubble size={16} />
          {strings.orderDetail.support}
        </a>
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
              {g.status && <StatusPill status={g.status} kind="fulfillment" />}
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

            {g.user_note && (
              <div className="mt-4 flex items-start gap-2 rounded-card bg-warm-sand/70 p-3">
                <Thread size={16} className="mt-0.5 text-accent-text" />
                <p className="flex-1 text-body text-ink">
                  <span className="text-caption text-muted">
                    {strings.orderDetail.noteTitle} —{" "}
                  </span>
                  {g.user_note}
                </p>
              </div>
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

      {/* Order-level adjustments + payment summary */}
      <section className="mt-3 rounded-card border border-hairline bg-chalk-white p-4 shadow-card">
        <p className="eyebrow">{strings.orderDetail.summaryTitle}</p>
        <div className="mt-2">
          {orderAdjustments.map((a, idx) => (
            <SummaryRow
              key={idx}
              label={a.label ?? (a.type === "discount" ? "Discount" : "Adjustment")}
              value={`${a.amount < 0 ? "−" : "+"}${formatPrice(Math.abs(a.amount))}`}
            />
          ))}
          <SummaryRow
            label={strings.orderDetail.total}
            value={formatPrice(detail.total_price ?? 0)}
            strong
          />
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

      {/* Actions */}
      {isDraft ? (
        <Button fullWidth className="mt-5" onClick={() => router.push("/review")}>
          {strings.orderDetail.continueDraft}
        </Button>
      ) : (
        <div className="mt-5 space-y-2">
          <Button
            fullWidth
            loading={invoiceBusy}
            disabled={invoiceBusy}
            onClick={() => void handleDownloadInvoice()}
          >
            {invoiceBusy
              ? strings.orderDetail.invoiceBusy
              : strings.orderDetail.downloadInvoice}
          </Button>
          <Link
            href={`/invoice/${detail.id}`}
            className="block py-1 text-center text-caption font-semibold text-navy-interactive underline"
          >
            {strings.orderDetail.viewInvoice}
          </Link>
          {invoiceError && (
            <p className="text-center text-caption text-error-text" role="alert">
              {invoiceError}
            </p>
          )}
        </div>
      )}
    </ScreenShell>
  );
}
