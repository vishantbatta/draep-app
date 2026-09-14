/**
 * Body-scroll lock — ONE counted lock shared by every overlay (sheets,
 * lightboxes). A naive per-component save/restore leaks: two overlays
 * interleaving (or unmounting out of order) can restore "hidden" forever —
 * the "can't scroll the page anymore" bug. Rules here:
 *
 *  - lockBodyScroll() returns its own release fn (double-release safe).
 *  - Only the LAST release restores the original value.
 *  - A pre-existing inline "hidden" (stale/foreign leak) is never treated
 *    as the value worth restoring.
 *  - healBodyScroll() clears a leaked lock (no locks held) — the app calls
 *    it on every route change, so even an unknown leaker self-heals on
 *    navigation.
 */

let locks = 0;
let prev = "";

export function lockBodyScroll(): () => void {
  if (locks === 0) {
    const cur = document.body.style.overflow;
    prev = cur === "hidden" ? "" : cur;
  }
  locks += 1;
  document.body.style.overflow = "hidden";
  let released = false;
  return () => {
    if (released) return;
    released = true;
    locks = Math.max(0, locks - 1);
    if (locks === 0 && document.body.style.overflow === "hidden") {
      document.body.style.overflow = prev;
    }
  };
}

export function hasBodyScrollLocks(): boolean {
  return locks > 0;
}

/** Clear a leaked lock — no-op while a legitimate lock is held. */
export function healBodyScroll(): void {
  if (locks === 0 && document.body.style.overflow === "hidden") {
    document.body.style.overflow = "";
  }
}
