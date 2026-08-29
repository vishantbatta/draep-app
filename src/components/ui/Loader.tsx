/**
 * Loader — the app's standard inline loading indicator.
 *
 * A branded ring spinner (Draep orange accent) with an optional label.
 * Use wherever a wait needs to be visible but calm: card refreshes,
 * inline fetches, step transitions. For full-button waits prefer the
 * Button's own `loading` prop.
 */

export function Loader({
  label,
  className = "",
  size = "md",
}: {
  label?: string;
  className?: string;
  /** md = inline with text; lg = standalone in a card/sheet. */
  size?: "sm" | "md" | "lg";
}) {
  const ring = {
    sm: "h-4 w-4 border-2",
    md: "h-5 w-5 border-[2.5px]",
    lg: "h-8 w-8 border-4",
  }[size];
  return (
    <div
      role="status"
      aria-live="polite"
      className={`flex items-center gap-2.5 ${className}`}
    >
      <span
        aria-hidden
        className={`${ring} flex-none animate-spin rounded-full border-mist-navy border-t-draep-orange`}
      />
      {label && (
        <p className="text-caption font-medium text-ink-navy">{label}</p>
      )}
      <span className="sr-only">{label ?? "Loading"}</span>
    </div>
  );
}
