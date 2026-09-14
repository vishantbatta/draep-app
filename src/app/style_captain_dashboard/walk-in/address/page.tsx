"use client";

/**
 * /style_captain_dashboard/walk-in/address — pick/type the delivery address.
 *
 * Two modes:
 *  - PRE-ORDER (no ?order=): the choice is stored in the draft store and
 *    rides the first-garment order creation. Purely local — no server write.
 *  - EDIT (?order=<id>, the go-back-and-edit path once the order exists):
 *    Continue PUTs the saved id / new fields onto the order, then returns to
 *    the garments screen.
 */

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import {
  AddressPicker,
  EMPTY_NEW_ADDRESS,
} from "@/components/shared/AddressPicker";
import { ArrowLeft } from "@/components/ui/icons";
import { Button } from "@/components/ui/Button";
import { useWalkInDraft } from "@/lib/walkin-draft-store";
import { scWalkInUpdateAddress } from "@/lib/style-captain-api";

const bannerCls =
  "rounded-card border border-error-border bg-error-bg px-4 py-3 text-caption text-error-text";

function AddressScreen() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const draft = useWalkInDraft();
  const orderId = searchParams.get("order");

  const [selectedAddressId, setSelectedAddressId] = useState("");
  const [showNewForm, setShowNewForm] = useState(false);
  const [newAddress, setNewAddress] = useState(EMPTY_NEW_ADDRESS);
  const [pinCoords, setPinCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // PRE-ORDER with no draft (direct load / refresh) → front door.
  useEffect(() => {
    if (!orderId && !draft.userId) {
      router.replace("/style_captain_dashboard/walk-in");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderId, draft.userId]);

  function buildNewAddressPayload() {
    return {
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
  }

  async function handleContinue() {
    const usingNewForm =
      draft.isNewUser || showNewForm || draft.savedAddresses.length === 0;

    let choice: { addressId: string } | { newAddress: ReturnType<typeof buildNewAddressPayload> };
    if (usingNewForm) {
      const a = newAddress;
      if (!a.address_line_1.trim() || !a.city.trim() || !a.state.trim() || !/^\d{6}$/.test(a.pincode)) {
        setError("Fill the required address fields (line 1, city, state, 6-digit pincode).");
        return;
      }
      choice = { newAddress: buildNewAddressPayload() };
    } else {
      if (!selectedAddressId) {
        setError("Pick a saved address or add a new one.");
        return;
      }
      choice = { addressId: selectedAddressId };
    }

    if (orderId) {
      // EDIT mode — the order exists; update it and go back to the flow.
      setSaving(true);
      setError(null);
      try {
        await scWalkInUpdateAddress(
          orderId,
          "addressId" in choice
            ? { address_id: choice.addressId }
            : { new_address: choice.newAddress },
        );
        router.push(
          `/style_captain_dashboard/walk-in/garments?order=${encodeURIComponent(orderId)}`,
        );
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not update the address");
      } finally {
        setSaving(false);
      }
      return;
    }

    draft.setAddressChoice(choice);
    router.push("/style_captain_dashboard/walk-in/garments");
  }

  return (
    <div className="mx-auto min-h-screen max-w-lg px-4 pb-28 pt-6">
      <div className="mb-6 flex items-center gap-3">
        <button
          onClick={() => router.back()}
          aria-label="Go back"
          className="rounded-full border border-hairline-strong bg-chalk-white p-2 text-ink transition hover:bg-mist-navy/20"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <div>
          <div className="text-eyebrow text-accent-text">Walk-in</div>
          <h1 className="font-heading text-head-3 text-ink">Delivery address</h1>
        </div>
      </div>

      {error && <div className={`mb-4 ${bannerCls}`}>{error}</div>}

      <div className="space-y-4">
        <AddressPicker
          customerName={draft.customerName}
          hasExistingCustomer={!draft.isNewUser}
          addresses={draft.savedAddresses}
          selectedId={selectedAddressId}
          onSelect={setSelectedAddressId}
          showNewForm={showNewForm}
          onShowNewFormChange={setShowNewForm}
          newAddress={newAddress}
          onNewAddressChange={setNewAddress}
          pinCoords={pinCoords}
          onPinCoordsChange={setPinCoords}
        />
        <Button fullWidth loading={saving} onClick={() => void handleContinue()}>
          Continue
        </Button>
      </div>
    </div>
  );
}

export default function WalkInAddressPage() {
  return (
    <Suspense
      fallback={
        <div className="mx-auto max-w-lg px-4 py-10 text-center text-caption text-muted">
          Loading…
        </div>
      }
    >
      <AddressScreen />
    </Suspense>
  );
}
