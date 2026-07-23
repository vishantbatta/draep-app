"use client";

/**
 * Contact details — spec §6.10 + API integration.
 *
 * Flow:
 *   1. User fills name, address, pincode, map pin
 *   2. Service area checked via GET /service-area/check (server-side polygon)
 *   3. On submit:
 *      a. If not authenticated (anonymous session) → redirect to /otp?phone=XX
 *      b. If authenticated → PUT /orders/{orderId}/contact (saves to backend)
 *   4. On success → navigate to /pay
 */

import { useEffect, useState, useCallback, useRef } from "react";
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
import { useAuthStore } from "@/lib/auth-store";
import { strings } from "@/lib/strings";
import { track } from "@/lib/analytics";
import { serviceAreaApi } from "@/lib/api";
import { BANGALORE_PINCODE_PREFIXES } from "@/lib/service-area";
import type { ServiceAreaCheckOut } from "@/types/api";

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
  const sessionType = useAuthStore((s) => s.sessionType);
  const user = useAuthStore((s) => s.user);

  const [pin, setPin] = useState<{ lat: number; lng: number } | null>(null);
  const [pinTouched, setPinTouched] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [serverAreaCheck, setServerAreaCheck] = useState<ServiceAreaCheckOut | null>(null);
  const [areaChecking, setAreaChecking] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const existingContact = draft?.contact;

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      phone: existingContact?.phone ?? user?.phone ?? "",
      name: existingContact?.name ?? user?.name ?? "",
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

  // Debounced server-side service area check
  const checkArea = useCallback((lat: number, lng: number) => {
    setAreaChecking(true);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      try {
        const result = await serviceAreaApi.checkServiceability(lat, lng);
        setServerAreaCheck(result);
      } catch {
        setServerAreaCheck(null);
      } finally {
        setAreaChecking(false);
      }
    }, 500);
  }, []);

  const handlePinChange = (lat: number, lng: number) => {
    setPin({ lat, lng });
    setPinTouched(true);
    checkArea(lat, lng);
  };

  const pincodeValue = form.watch("pincode");
  const pincodeInBangalore = BANGALORE_PINCODE_PREFIXES.some((p) =>
    pincodeValue?.startsWith(p),
  );

  const outOfArea =
    (serverAreaCheck && !serverAreaCheck.serviceable) ||
    (pincodeValue?.length === 6 && !pincodeInBangalore);

  const onSubmit = async (values: FormValues) => {
    setSubmitError(null);

    if (outOfArea) {
      track({ event: "serviceability_failed", areaResult: serverAreaCheck?.reason ?? "pincode" });
      return;
    }
    if (!pin) {
      setPinTouched(true);
      return;
    }

    // Save to local store optimistically
    setContact({
      ...values,
      lat: pin.lat,
      lng: pin.lng,
    });

    // Check if user is authenticated (OTP-verified)
    if (sessionType !== "user") {
      track({ event: "contact_submitted" });
      router.push(`/otp?phone=${encodeURIComponent(values.phone)}`);
      return;
    }

    // User is authenticated → save contact to backend
    if (!draft?.orderId) {
      setSubmitError("Your session isn't ready yet. Please try again.");
      return;
    }

    setSubmitting(true);
    try {
      await serviceAreaApi.updateOrderContact(draft.orderId, {
        name: values.name,
        address_line_1: values.address1,
        address_line_2: values.address2,
        city: "Bengaluru",
        state: "Karnataka",
        pincode: values.pincode,
        lat: pin.lat,
        lng: pin.lng,
      });
      track({ event: "contact_submitted" });
      router.push("/pay");
    } catch (err) {
      setSubmitError(
        err instanceof Error ? err.message : "Failed to save your details. Try again.",
      );
    } finally {
      setSubmitting(false);
    }
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

        {sessionType !== "user" && (
          <div className="mt-3">
            <Banner variant="info" title="Verify your number">
              <p>You&apos;ll receive an OTP to confirm your booking.</p>
            </Banner>
          </div>
        )}

        {submitError && (
          <div className="mt-3">
            <Banner variant="error" title="Couldn't save">
              <p>{submitError}</p>
            </Banner>
          </div>
        )}

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
              onPinChange={handlePinChange}
            />
            {pinTouched && !pin && (
              <p className="mt-1 text-caption text-error-text">{strings.contact.validation.pin}</p>
            )}
            {areaChecking && (
              <p className="mt-1 text-caption text-muted">Checking service area…</p>
            )}
          </Field>

          {outOfArea && (
            <Banner variant="error" title={strings.contact.outOfAreaTitle}>
              <p>{strings.contact.outOfAreaBody}</p>
            </Banner>
          )}

          <Button
            type="submit"
            fullWidth
            disabled={Boolean(outOfArea) || submitting || areaChecking}
            loading={submitting}
          >
            {sessionType === "user"
              ? strings.contact.continue
              : "Verify & continue"}
          </Button>
        </form>
      </ScreenShell>
    </>
  );
}

function inputClass(hasError: boolean): string {
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
