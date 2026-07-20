"use client";

/**
 * Contact details — spec §6.10.
 *
 * Phone first, then name + address, then map pin.
 * RHF + Zod validation. Out-of-area blocks progression.
 * CTA `Continue to payment` enabled only when all validations pass — the one
 * exception to the always-enabled rule.
 */

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";

import { ScreenShell } from "@/components/layout/ScreenShell";
import { TapeProgress } from "@/components/layout/TapeProgress";
import { Button } from "@/components/ui/Button";
import { Banner } from "@/components/ui/Banner";
import { MapPinPicker } from "@/components/contact/MapPinPicker";
import { useBookingStore } from "@/lib/booking-store";
import { strings } from "@/lib/strings";
import { track } from "@/lib/analytics";
import { checkServiceArea } from "@/lib/service-area";
import { BANGALORE_PINCODE_PREFIXES } from "@/lib/service-area";

const schema = z.object({
  phone: z.string().regex(/^[6-9]\d{9}$/, strings.contact.validation.phone),
  name: z.string().min(2, strings.contact.validation.name).max(60),
  address1: z.string().min(4, strings.contact.validation.address1),
  address2: z.string().optional(),
  pincode: z.string().regex(/^\d{6}$/, strings.contact.validation.pincode),
});

type FormValues = z.infer<typeof schema>;

export default function ContactPage() {
  const router = useRouter();
  const draft = useBookingStore((s) => s.draft);
  const hydrated = useBookingStore((s) => s.hydrated);
  const setContact = useBookingStore((s) => s.setContact);
  const [pin, setPin] = useState<{ lat: number; lng: number } | null>(null);
  const [pinTouched, setPinTouched] = useState(false);

  const existingContact = draft?.contact;

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      phone: existingContact?.phone ?? "",
      name: existingContact?.name ?? "",
      address1: existingContact?.address1 ?? "",
      address2: existingContact?.address2 ?? "",
      pincode: existingContact?.pincode ?? "",
    },
  });

  // Sync existing pin
  useEffect(() => {
    if (existingContact?.lat && existingContact?.lng) {
      setPin({ lat: existingContact.lat, lng: existingContact.lng });
    }
  }, [existingContact?.lat, existingContact?.lng]);

  const area = useMemo(() => {
    if (!pin) return null;
    return checkServiceArea(pin.lat, pin.lng);
  }, [pin]);

  // Heuristic pincode pre-check: outside Bangalore prefix → out of area.
  const pincodeValue = form.watch("pincode");
  const pincodeInBangalore = BANGALORE_PINCODE_PREFIXES.some((p) =>
    pincodeValue?.startsWith(p),
  );

  const outOfArea = (area && !area.serviceable) || (pincodeValue?.length === 6 && !pincodeInBangalore);

  const onSubmit = (values: FormValues) => {
    if (outOfArea) {
      track({ event: "serviceability_failed", areaResult: area?.areaName ?? "pincode" });
      return;
    }
    if (!pin) {
      setPinTouched(true);
      return;
    }
    setContact({
      ...values,
      lat: pin.lat,
      lng: pin.lng,
    });
    track({ event: "contact_submitted" });
    router.push("/pay");
  };

  if (!hydrated || !draft) {
    return (
      <div className="column flex min-h-dvh items-center justify-center">
        <div aria-hidden className="h-1 w-24 overflow-hidden rounded-pill bg-tape-silver">
          <div className="h-full w-1/2 animate-pulse bg-draep-orange" />
        </div>
      </div>
    );
  }

  return (
    <>
      <TapeProgress currentRoute="/review" />
      <ScreenShell className="pt-4">
        <p className="eyebrow">Visit details</p>
        <h1 className="font-heading text-h1 text-ink-navy">
          {strings.contact.title}
        </h1>

        <form onSubmit={form.handleSubmit(onSubmit)} className="mt-5 space-y-5">
          {/* Phone */}
          <Field
            label={strings.contact.phoneLabel}
            error={form.formState.errors.phone?.message}
          >
            <div className="flex items-stretch gap-2">
              <span
                data-mono
                className="inline-flex min-w-[58px] items-center justify-center rounded-card border border-hairline-strong bg-mist-navy px-3 font-mono text-body text-ink-navy"
              >
                +91
              </span>
              <input
                type="tel"
                inputMode="numeric"
                autoComplete="tel-national"
                className={inputClass(Boolean(form.formState.errors.phone))}
                {...form.register("phone")}
              />
            </div>
          </Field>

          {/* Name */}
          <Field
            label={strings.contact.nameLabel}
            error={form.formState.errors.name?.message}
          >
            <input
              type="text"
              autoComplete="name"
              maxLength={60}
              className={inputClass(Boolean(form.formState.errors.name))}
              {...form.register("name")}
            />
          </Field>

          {/* Address */}
          <Field
            label={strings.contact.address1Label}
            error={form.formState.errors.address1?.message}
          >
            <input
              type="text"
              autoComplete="address-line1"
              className={inputClass(Boolean(form.formState.errors.address1))}
              {...form.register("address1")}
            />
          </Field>
          <Field label={strings.contact.address2Label}>
            <input
              type="text"
              autoComplete="address-line2"
              className={inputClass(false)}
              {...form.register("address2")}
            />
          </Field>
          <Field
            label={strings.contact.pincodeLabel}
            error={form.formState.errors.pincode?.message}
          >
            <input
              type="text"
              inputMode="numeric"
              autoComplete="postal-code"
              maxLength={6}
              data-mono
              className={inputClass(Boolean(form.formState.errors.pincode)) + " font-mono"}
              {...form.register("pincode")}
            />
          </Field>

          {/* Map pin */}
          <Field label={strings.contact.mapLabel}>
            <MapPinPicker
              lat={pin?.lat ?? existingContact?.lat}
              lng={pin?.lng ?? existingContact?.lng}
              onPinChange={(lat, lng) => {
                setPin({ lat, lng });
                setPinTouched(true);
              }}
            />
            {pinTouched && !pin && (
              <p className="mt-1 text-caption text-error-text">{strings.contact.validation.pin}</p>
            )}
          </Field>

          {outOfArea && (
            <Banner variant="error" title={strings.contact.outOfAreaTitle}>
              <p>{strings.contact.outOfAreaBody}</p>
            </Banner>
          )}

          <Button type="submit" fullWidth disabled={Boolean(outOfArea)}>
            {strings.contact.continue}
          </Button>
        </form>
      </ScreenShell>
    </>
  );
}

function inputClass(hasError: boolean): string {
  // Brand Book §8 — 1px hairline border, ink body text, orange focus ring
  // (the orange ring is applied globally on input:focus in globals.css).
  return [
    "w-full rounded-card border px-3 py-2.5 min-h-[44px] text-body bg-chalk-white",
    "focus-visible:outline-none",
    hasError
      ? "border-error bg-error-bg"
      : "border-hairline-strong",
  ].join(" ");
}

function Field({
  label,
  error,
  children,
}: {
  label: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-caption text-muted">{label}</span>
      {children}
      {error && <p className="mt-1 text-caption text-error-text">{error}</p>}
    </label>
  );
}
