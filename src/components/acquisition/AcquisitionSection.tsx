"use client";

/**
 * AcquisitionSection — reusable collapsible block of the 5 acquisition
 * (UTM-style) fields, each a free-text input with suggestion Chip buttons.
 *
 * Controlled component: parent owns the `value` (AcquisitionState) and
 * `onChange`. Used by the order wizard, the standalone New User form.
 * (Detail/edit pages use EditableText per-field instead.)
 *
 * Chip behaviour: tapping a chip sets its field to that value (replace);
 * tapping the active chip again clears it. Fields stay freely editable.
 *
 * Uses the native <details>/<summary> pattern already established in
 * validation-rules/page.tsx — no JS state needed for open/close.
 */

import { Chip } from "@/components/ui/Chip";
import {
  ACQUISITION_FIELDS,
  type AcquisitionState,
} from "@/lib/acquisition";

interface AcquisitionSectionProps {
  value: AcquisitionState;
  onChange: (next: AcquisitionState) => void;
  /** Render as an always-open block (no <details> wrapper) when false. */
  collapsible?: boolean;
  /** Optional heading override. */
  summaryLabel?: string;
  /** Hint text shown under the summary when collapsed-open. */
  hint?: string;
}

export function AcquisitionSection({
  value,
  onChange,
  collapsible = true,
  summaryLabel = "Acquisition source",
  hint = "Optional — how this customer/order was acquired.",
}: AcquisitionSectionProps) {
  const setField = (key: keyof AcquisitionState, v: string) =>
    onChange({ ...value, [key]: v });

  const Fields = (
    <div className="space-y-3">
      {hint && <div className="text-[11px] text-muted">{hint}</div>}
      {ACQUISITION_FIELDS.map((f) => (
        <div key={f.key}>
          <label className="mb-1 block text-xs font-medium text-muted">
            {f.label}
          </label>
          <input
            type="text"
            value={value[f.key]}
            onChange={(e) => setField(f.key, e.target.value)}
            placeholder={f.options[0] ? `e.g. ${f.options[0]}` : ""}
            className="w-full rounded-lg border border-hairline-strong bg-chalk-white px-3 py-2 text-sm focus:border-ink-navy focus:outline-none"
          />
          {f.options.length > 0 && (
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {f.options.map((opt) => {
                const active = value[f.key] === opt;
                return (
                  <Chip
                    key={opt}
                    selected={active}
                    ariaLabel={`${f.label}: ${opt}`}
                    onClick={() => setField(f.key, active ? "" : opt)}
                    className="min-h-[28px] px-2.5 py-1 text-[11px]"
                  >
                    {opt}
                  </Chip>
                );
              })}
            </div>
          )}
        </div>
      ))}
    </div>
  );

  if (!collapsible) {
    return <div className="rounded-lg border border-hairline bg-chalk-white p-3">{Fields}</div>;
  }

  return (
    <details className="group rounded-lg border border-hairline bg-chalk-white p-3">
      <summary className="cursor-pointer text-xs font-medium text-muted hover:text-ink-navy">
        <span className="inline-block transition-transform duration-150 group-open:rotate-90">▸</span>{" "}
        {summaryLabel} <span className="text-[10px] font-normal">(optional)</span>
      </summary>
      <div className="mt-3">{Fields}</div>
    </details>
  );
}
