"use client";

/**
 * SlotPicker — 3-hour home-visit slot picker on /confirmed (spec §6.12).
 *
 * Date chips for the next 7 days. Slot chips for 3-hour windows.
 * Final windows from ops config — VISIT_SLOT_WINDOWS / VISIT_SLOT_DAYS_AHEAD.
 */

import { Chip } from "@/components/ui/Chip";
import { MonoNumber } from "@/components/ui/MonoNumber";
import { VISIT_SLOT_WINDOWS, VISIT_SLOT_DAYS_AHEAD } from "@/lib/pricing-config";

interface SlotPickerProps {
  selectedDate?: string;
  selectedWindow?: string;
  onSelectDate: (date: string) => void;
  onSelectWindow: (window: string) => void;
}

export function SlotPicker({
  selectedDate,
  selectedWindow,
  onSelectDate,
  onSelectWindow,
}: SlotPickerProps) {
  const dates = buildNextDays(VISIT_SLOT_DAYS_AHEAD);

  return (
    <div className="space-y-4">
      <div>
        <p className="mb-2 text-caption text-ink-navy/70">Date</p>
        <div className="flex flex-wrap gap-2">
          {dates.map((d) => (
            <Chip
              key={d.iso}
              selected={selectedDate === d.iso}
              onClick={() => onSelectDate(d.iso)}
            >
              <span className="flex flex-col items-center">
                <span className="text-caption">{d.weekday}</span>
                <MonoNumber className="text-data">{d.shortDate}</MonoNumber>
              </span>
            </Chip>
          ))}
        </div>
      </div>

      <div>
        <p className="mb-2 text-caption text-ink-navy/70">3-hour window</p>
        <div className="flex flex-wrap gap-2">
          {VISIT_SLOT_WINDOWS.map((w) => (
            <Chip
              key={w.id}
              selected={selectedWindow === w.id}
              onClick={() => onSelectWindow(w.id)}
            >
              {w.label}
            </Chip>
          ))}
        </div>
      </div>
    </div>
  );
}

function buildNextDays(count: number) {
  const out: { iso: string; weekday: string; shortDate: string }[] = [];
  const today = new Date();
  for (let i = 0; i < count; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() + i);
    out.push({
      iso: d.toISOString().slice(0, 10),
      weekday: d.toLocaleDateString("en-IN", { weekday: "short" }),
      shortDate: d.toLocaleDateString("en-IN", { day: "numeric", month: "short" }),
    });
  }
  return out;
}
