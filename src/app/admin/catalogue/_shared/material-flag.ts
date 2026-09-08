// is_material_needed is tri-state on the server (true / false / null) but
// binary in the admin UI: null ("never set") and false both render as an
// unchecked box, and every save writes an explicit boolean so a toggle-off
// can never be mistaken for "never set" by the partial-update backend.

export type BadgeVariant = "default" | "positive" | "negative" | "accent";

/** Checkbox state from the raw API value — only strictly-true is checked. */
export function toMaterialChecked(raw: unknown): boolean {
  return raw === true;
}

/** Card pill for options where the customer must bring their own material. */
export function materialBadge(
  raw: unknown,
): { label: string; variant: BadgeVariant } | null {
  return raw === true ? { label: "Material", variant: "accent" } : null;
}
