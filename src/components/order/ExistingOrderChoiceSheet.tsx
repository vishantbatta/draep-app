"use client";

/**
 * ExistingOrderChoiceSheet — shown on order confirm when the customer has
 * open orders (pending / awaiting_visit). Pick one to append the new garment
 * to (it joins that order's visit), or create a separate order as before.
 */

import { useState } from "react";

import { BottomSheet } from "@/components/ui/BottomSheet";
import { formatPrice } from "@/lib/pricing";
import { strings } from "@/lib/strings";
import type { OpenOrder } from "@/types/api";

interface Props {
  open: boolean;
  onClose: () => void;
  orders: OpenOrder[];
  /** True while the append request is in flight — pins the CTAs. */
  busy: boolean;
  onAdd: (orderId: string) => void;
  onCreateNew: () => void;
}

export function ExistingOrderChoiceSheet({
  open,
  onClose,
  orders,
  busy,
  onAdd,
  onCreateNew,
}: Props) {
  const [selected, setSelected] = useState<string | null>(null);
  // Orders can change between opens (a fetch lands after close) — a stale
  // selection must never enable the Add CTA.
  const effective = orders.some((o) => o.id === selected) ? selected : null;

  return (
    <BottomSheet
      open={open}
      onClose={busy ? () => {} : onClose}
      title={strings.existingOrders.sheetTitle}
      footer={
        <div className="flex flex-col gap-2">
          <button
            type="button"
            disabled={!effective || busy}
            onClick={() => effective && onAdd(effective)}
            className="rounded-pill bg-ink-navy px-5 py-3 text-body font-semibold text-chalk-white transition-all ease-brand disabled:opacity-40 active:scale-[0.98]"
          >
            {strings.existingOrders.addCta}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={onCreateNew}
            className="rounded-pill border border-hairline-strong bg-chalk-white px-5 py-3 text-body font-semibold text-ink-navy transition-all ease-brand disabled:opacity-40 active:scale-[0.98]"
          >
            {strings.existingOrders.createNewCta}
          </button>
        </div>
      }
    >
      <p className="mb-3 text-caption text-muted">
        {strings.existingOrders.sheetCaption}
      </p>
      <ul className="flex flex-col gap-2">
        {orders.map((order) => {
          const price =
            order.total_price != null
              ? formatPrice(order.total_price)
              : null;
          return (
            <li key={order.id}>
              <button
                type="button"
                aria-pressed={effective === order.id}
                onClick={() => setSelected(order.id)}
                className={`w-full rounded-2xl border px-4 py-3 text-left transition-all ease-brand active:scale-[0.99] ${
                  effective === order.id
                    ? "border-ink-navy bg-ink-navy/5"
                    : "border-hairline bg-chalk-white"
                }`}
              >
                <span className="flex items-center justify-between gap-2">
                  <span className="text-body font-semibold text-ink">
                    {order.order_number ?? "Order"}
                  </span>
                  <span className="flex-none text-caption text-muted">
                    {[
                      order.fulfillment_status === "awaiting_visit"
                        ? strings.existingOrders.visitBooked
                        : null,
                      price,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </span>
                <span className="mt-1 block truncate text-caption text-muted">
                  {order.garments.join(" · ") || "—"}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </BottomSheet>
  );
}
