"use client";

/**
 * /app/orders/{id}/address — full-page delivery address for a draft order.
 *
 * The same form as the account page's add-address sheet (shared AddressForm
 * — search, map pin, geolocation prefill, editable fields). Saving PUTs the
 * order's contact: the endpoint checks serviceability, saves the address to
 * the customer's saved addresses, and attaches it to the order (address_id)
 * — the same save + attach the admin dashboard performs. On success we land
 * back on the order, where the address bar now shows the deliver-to card
 * and Continue moves on to slot selection.
 */

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";

import { AddressForm } from "@/components/contact/AddressForm";
import { ScreenShell } from "@/components/layout/ScreenShell";
import { ArrowLeft } from "@/components/ui/icons";
import { serviceAreaApi } from "@/lib/api";
import { strings } from "@/lib/strings";

export default function OrderAddressPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();

  return (
    <ScreenShell className="px-4 pt-6">
      <header className="flex items-center gap-3">
        <Link
          href={`/app/orders/${id}`}
          aria-label={strings.orderDetail.backToOrder}
          className="flex h-11 w-11 flex-none items-center justify-center rounded-pill text-ink-navy transition hover:bg-mist-navy"
        >
          <ArrowLeft size={18} />
        </Link>
        <div className="min-w-0">
          <p className="eyebrow">{strings.orderDetail.title}</p>
          <h1 className="mt-1 truncate font-heading text-h2 text-ink-navy">
            {strings.orderDetail.addressPageTitle}
          </h1>
        </div>
      </header>
      <p className="mt-2 text-caption text-muted">
        {strings.orderDetail.addressPageHint}
      </p>

      <div className="mt-4">
        <AddressForm
          active
          saveAddress={async (fields, pin) => {
            if (!pin) throw new Error(strings.orderDetail.pinNeeded);
            await serviceAreaApi.updateOrderContact(id, {
              address_line_1: fields.address_line_1,
              address_line_2: fields.address_line_2 || undefined,
              city: fields.city,
              state: fields.state,
              pincode: fields.pincode,
              lat: pin.lat,
              lng: pin.lng,
            });
            return null;
          }}
          onSaved={() => router.replace(`/app/orders/${id}`)}
        />
      </div>
    </ScreenShell>
  );
}
