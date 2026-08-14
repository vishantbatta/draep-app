"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  createShortLink,
  deleteShortLink,
  listShortLinks,
  updateShortLink,
  type ShortLink,
} from "@/lib/admin-api";
import { shortLinkQrPng } from "@/lib/qr-code";
import { Modal } from "../../catalogue/_shared/catalogue-helpers";

// ─── Sub-tabs for Configure (shared) ───────────────────────────────────────────

const ACTION_TABS = [
  { key: "slot-scheduling", label: "Slot Scheduling", href: "/admin/actions/slot-scheduling" },
  { key: "urls", label: "URLs", href: "/admin/actions/urls" },
  { key: "measurements", label: "Measurements", href: "/admin/measurements" },
  { key: "validation-rules", label: "Validation Rules", href: "/admin/catalogue/validation-rules" },
] as const;

type ActionTabKey = (typeof ACTION_TABS)[number]["key"];

export default function UrlsActionPage() {
  return (
    <Suspense fallback={null}>
      <UrlsActionPageInner />
    </Suspense>
  );
}

// ─── Helpers ────────────────────────────────────────────────────────────────

const RANDOM_ALPHABET = "23456789abcdefghjkmnpqrstuvwxyz";

/** Mirrors the backend slugifier: lowercase, non-alphanumerics → '-'. */
function sanitizeSlug(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function randomSuffix(len = 5): string {
  const chars = new Array(len);
  for (let i = 0; i < len; i += 1) {
    chars[i] = RANDOM_ALPHABET[Math.floor(Math.random() * RANDOM_ALPHABET.length)];
  }
  return chars.join("");
}

type LinkStatus = "active" | "off" | "expired" | "exhausted";

function linkStatus(l: ShortLink, now: number): LinkStatus {
  if (l.is_active === false) return "off";
  if (l.expires_at && new Date(l.expires_at).getTime() <= now) return "expired";
  if (l.click_limit != null && (l.click_count ?? 0) >= l.click_limit) return "exhausted";
  return "active";
}

const STATUS_STYLES: Record<LinkStatus, string> = {
  active: "bg-accent-text/10 text-accent-text",
  off: "bg-muted/15 text-muted",
  expired: "bg-error-bg text-error-text",
  exhausted: "bg-error-bg text-error-text",
};

const STATUS_LABELS: Record<LinkStatus, string> = {
  active: "Active",
  off: "Turned off",
  expired: "Expired",
  exhausted: "Limit reached",
};

/** datetime-local value (browser-local) ↔ ISO string for the wire. */
function isoToLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function formatWhen(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString();
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

// ─── WhatsApp CTA builder ───────────────────────────────────────────────────

// Public booking line + greeting, mirroring the landing page's WA deep link.
const WA_DEFAULT_PHONE = "918147497006";
const WA_DEFAULT_MESSAGE =
  "Hi Draep! 👋 I'd like to book a free at-home visit for blouse stitching. Please help me get started.";

function buildWaUrl(phone: string, message: string): string {
  const digits = phone.replace(/\D/g, "");
  const text = message.trim();
  return `https://wa.me/${digits}${text ? `?text=${encodeURIComponent(text)}` : ""}`;
}

/** Recover phone/message from an existing wa.me destination so it can be tweaked. */
function parseWaDestination(dest: string): { phone: string; message: string } | null {
  const m = dest.match(/^https:\/\/wa\.me\/(\d{10,15})(?:\?text=([^#]*))?$/);
  if (!m) return null;
  return { phone: m[1], message: m[2] ? decodeURIComponent(m[2].replace(/\+/g, " ")) : "" };
}

// WhatsApp glyph (24×24 filled path — same as the landing page).
function WhatsAppGlyph({ className = "" }: { className?: string }) {
  return (
    <svg
      className={`h-3.5 w-3.5 shrink-0 ${className}`}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M17.5 14.4c-.3-.15-1.77-.87-2.04-.97-.27-.1-.47-.15-.67.15-.2.3-.77.97-.94 1.17-.17.2-.35.22-.65.07-.3-.15-1.26-.46-2.4-1.48-.89-.79-1.49-1.77-1.66-2.07-.17-.3-.02-.46.13-.61.13-.13.3-.35.45-.52.15-.17.2-.3.3-.5.1-.2.05-.37-.02-.52-.08-.15-.67-1.62-.92-2.22-.24-.58-.49-.5-.67-.51h-.57c-.2 0-.52.07-.8.37-.27.3-1.04 1.02-1.04 2.49 0 1.47 1.07 2.89 1.22 3.09.15.2 2.1 3.2 5.08 4.49.71.31 1.26.49 1.69.62.71.23 1.36.2 1.87.12.57-.09 1.77-.72 2.02-1.42.25-.7.25-1.3.17-1.42-.07-.13-.27-.2-.57-.35zM12 2C6.48 2 2 6.48 2 12c0 1.85.5 3.58 1.38 5.06L2 22l5.06-1.33A9.94 9.94 0 0 0 12 22c5.52 0 10-4.48 10-10S17.52 2 12 2z" />
    </svg>
  );
}

// ─── Form state ─────────────────────────────────────────────────────────────

interface FormDraft {
  name: string;
  slug: string;
  destination: string;
  label: string;
  isActive: boolean;
  expiresAt: string; // datetime-local string, "" = no expiry
  clickLimit: string; // "" = unlimited
}

const EMPTY_DRAFT: FormDraft = {
  name: "",
  slug: "",
  destination: "",
  label: "",
  isActive: true,
  expiresAt: "",
  clickLimit: "",
};

function draftFromLink(l: ShortLink): FormDraft {
  return {
    name: "",
    slug: l.slug ?? "",
    destination: l.destination ?? "",
    label: l.label ?? "",
    isActive: l.is_active !== false,
    expiresAt: isoToLocalInput(l.expires_at),
    clickLimit: l.click_limit != null ? String(l.click_limit) : "",
  };
}

// ─── Page ───────────────────────────────────────────────────────────────────

function UrlsActionPageInner() {
  const router = useRouter();
  const [activeActionTab] = useState<ActionTabKey>("urls");

  const [links, setLinks] = useState<ShortLink[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());

  // Inline create/edit form (same pattern as the garments page).
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<FormDraft>(EMPTY_DRAFT);
  const [slugTouched, setSlugTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const [copiedSlug, setCopiedSlug] = useState<string | null>(null);
  const [qrBusySlug, setQrBusySlug] = useState<string | null>(null);
  const [qrDone, setQrDone] = useState<{
    slug: string;
    action: "copy" | "download";
    msg: string;
  } | null>(null);

  // WhatsApp CTA builder modal.
  const [waOpen, setWaOpen] = useState(false);
  const [waPhone, setWaPhone] = useState(WA_DEFAULT_PHONE);
  const [waMessage, setWaMessage] = useState(WA_DEFAULT_MESSAGE);

  // ─── Push action sub-tabs to sidebar ─────────────────────────────────────
  useEffect(() => {
    window.dispatchEvent(
      new CustomEvent("admin-sidebar-update", {
        detail: {
          items: ACTION_TABS.map((t) => ({
            label: t.label,
            active: activeActionTab === t.key,
            onClick: () => router.push(t.href),
          })),
        },
      }),
    );
  }, [activeActionTab, router]);

  const load = () => {
    setLoading(true);
    setError(null);
    listShortLinks()
      .then((res) => {
        setLinks(res.links);
        setLoading(false);
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : "Failed to load short links");
        setLoading(false);
      });
  };

  useEffect(load, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Keep expiry/status badges honest while the page sits open.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);

  // Close the WhatsApp builder on Escape.
  useEffect(() => {
    if (!waOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setWaOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [waOpen]);

  function patch<K extends keyof FormDraft>(key: K, value: FormDraft[K]) {
    setDraft((d) => ({ ...d, [key]: value }));
    setSavedAt(null);
  }

  function openCreate() {
    setEditingId(null);
    setDraft({ ...EMPTY_DRAFT, slug: "" });
    setSlugTouched(false);
    setShowForm(true);
    setError(null);
  }

  function openEdit(l: ShortLink) {
    setEditingId(l.id);
    setDraft(draftFromLink(l));
    setSlugTouched(true); // editing an existing slug: never auto-overwrite
    setShowForm(true);
    setError(null);
  }

  // Notion-style suggestion: typing a Name fills Slug until Slug is hand-edited.
  function handleNameChange(value: string) {
    setDraft((d) => {
      const next = { ...d, name: value };
      if (!slugTouched) next.slug = `${sanitizeSlug(value)}-${randomSuffix()}`.replace(/^-+/, "");
      return next;
    });
  }

  function openWaBuilder() {
    // Editing an existing wa.me destination? Seed the builder with its values.
    const parsed = parseWaDestination(draft.destination.trim());
    if (parsed) {
      setWaPhone(parsed.phone);
      setWaMessage(parsed.message);
    }
    setWaOpen(true);
  }

  function applyWaDestination() {
    const url = buildWaUrl(waPhone, waMessage);
    setDraft((d) => {
      const next = { ...d, destination: url };
      // Fresh create with nothing typed yet: suggest the obvious name/slug.
      if (!editingId && d.name.trim() === "" && !slugTouched) {
        next.name = "WhatsApp";
        next.slug = `whatsapp-${randomSuffix()}`;
      }
      return next;
    });
    setSavedAt(null);
    setWaOpen(false);
  }

  async function handleCopy(slug: string) {
    const url = `${window.location.origin}/link/${slug}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopiedSlug(slug);
      setTimeout(() => setCopiedSlug(null), 1500);
    } catch {
      setError(`Copy failed — URL is ${url}`);
    }
  }

  // House-styled QR (diamonds, gradient eyes, Draep logo) as a PNG —
  // copy to clipboard when supported, else fall back to a download.
  async function handleQr(slug: string, action: "copy" | "download") {
    if (qrBusySlug) return;
    setQrBusySlug(slug);
    setError(null);
    const finish = (msg: string) => {
      setQrDone({ slug, action, msg });
      setTimeout(
        () => setQrDone((d) => (d && d.slug === slug ? null : d)),
        2000,
      );
    };
    try {
      const blob = await shortLinkQrPng(`${window.location.origin}/link/${slug}`);
      if (action === "download") {
        downloadBlob(blob, `draep-qr-${slug || "link"}.png`);
        finish("Downloaded ✓");
      } else {
        try {
          await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
          finish("Copied ✓");
        } catch {
          downloadBlob(blob, `draep-qr-${slug || "link"}.png`);
          finish("Saved ✓");
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to generate QR");
    } finally {
      setQrBusySlug(null);
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (saving) return;
    setSaving(true);
    setError(null);

    const expiresIso = draft.expiresAt ? new Date(draft.expiresAt).toISOString() : null;
    const clickLimit =
      draft.clickLimit.trim() === "" ? null : Math.max(0, parseInt(draft.clickLimit, 10) || 0);

    const done = () => {
      setSaving(false);
      setShowForm(false);
      setSavedAt(Date.now());
      load();
    };
    const fail = (err: unknown) => {
      setError(err instanceof Error ? err.message : "Failed to save link");
      setSaving(false);
    };

    if (editingId) {
      // Explicit keys (even nulls) so optional fields can be cleared.
      updateShortLink(editingId, {
        destination: draft.destination.trim(),
        slug: draft.slug.trim(),
        label: draft.label.trim() || null,
        is_active: draft.isActive,
        expires_at: expiresIso,
        click_limit: clickLimit,
      })
        .then(done)
        .catch(fail);
    } else {
      createShortLink({
        name: draft.name.trim() || undefined,
        slug: draft.slug.trim() || undefined,
        destination: draft.destination.trim(),
        label: draft.label.trim() || undefined,
        is_active: draft.isActive,
        expires_at: expiresIso,
        click_limit: clickLimit,
      })
        .then(done)
        .catch(fail);
    }
  }

  function handleDelete(l: ShortLink) {
    if (!window.confirm(`Delete draep.com/link/${l.slug}? This cannot be undone.`)) return;
    deleteShortLink(l.id)
      .then(() => {
        setSavedAt(Date.now());
        load();
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to delete link"));
  }

  const inputCls =
    "w-full rounded-pill border border-hairline-strong bg-chalk-white px-3 py-2 text-data text-ink outline-none focus:border-accent-text";

  const sortedLinks = useMemo(() => links, [links]);

  const waUrl = buildWaUrl(waPhone, waMessage);
  const waPhoneDigits = waPhone.replace(/\D/g, "");
  const waPhoneValid = waPhoneDigits.length >= 10 && waPhoneDigits.length <= 15;

  return (
    <div className="px-4 py-4 md:px-6 md:py-6">
      <div className="mb-4 flex items-center justify-between gap-2">
        <div>
          <h1 className="font-heading text-h3 font-semibold text-ink-navy md:text-h2">URLs</h1>
          <p className="mt-0.5 text-[12px] text-muted">
            Short links — draep.com/link/&lt;slug&gt; redirects to any destination.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {savedAt && !error && (
            <span className="rounded-pill bg-accent-text/10 px-3 py-1 text-caption font-medium text-accent-text">
              Saved
            </span>
          )}
          <button
            type="button"
            onClick={openCreate}
            className="tap rounded-pill bg-ink-navy px-5 py-2.5 text-caption font-medium text-chalk-white transition hover:bg-ink-navy/90"
          >
            + New Link
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-4 rounded-card border border-error-border bg-error-bg px-4 py-3 text-caption text-error-text">
          {error}
        </div>
      )}

      {/* ─── Inline create / edit form ─────────────────────────────────────── */}
      {showForm && (
        <form
          onSubmit={handleSubmit}
          className="mb-6 max-w-2xl rounded-card border border-hairline bg-chalk-white p-4 shadow-card md:p-6"
        >
          <h2 className="mb-4 font-heading text-h4 font-semibold text-ink-navy">
            {editingId ? "Edit link" : "New link"}
          </h2>

          {!editingId && (
            <div className="mb-4">
              <label className="mb-1.5 block font-mono text-eyebrow text-ink-navy">Name</label>
              <input
                type="text"
                value={draft.name}
                onChange={(e) => handleNameChange(e.target.value)}
                placeholder="e.g. WhatsApp"
                className={inputCls}
              />
              <p className="mt-1 text-[11px] text-muted">
                Feeds the suggested slug — edit the slug below for full control.
              </p>
            </div>
          )}

          <div className="mb-4">
            <label className="mb-1.5 block font-mono text-eyebrow text-ink-navy">Slug</label>
            <div className="flex items-center gap-2">
              <span className="shrink-0 font-mono text-data text-muted">/link/</span>
              <input
                type="text"
                value={draft.slug}
                onChange={(e) => {
                  setSlugTouched(true);
                  patch("slug", e.target.value);
                }}
                placeholder="whatsapp-x7kp9"
                className={inputCls}
              />
            </div>
            {draft.slug.trim() !== "" && (
              <p className="mt-1 break-all text-[11px] text-muted">
                Full URL:{" "}
                <span className="font-mono text-ink">
                  {typeof window !== "undefined" ? window.location.origin : ""}/link/
                  {draft.slug.trim()}
                </span>
              </p>
            )}
          </div>

          <div className="mb-4">
            <div className="mb-1.5 flex items-center justify-between gap-2">
              <label className="font-mono text-eyebrow text-ink-navy">Destination</label>
              <button
                type="button"
                onClick={openWaBuilder}
                className="tap flex items-center gap-1.5 rounded-pill border border-hairline-strong bg-chalk-white px-3 py-1 text-[11px] font-medium text-ink-navy transition hover:bg-mist-navy"
              >
                <WhatsAppGlyph className="text-[#25D366]" />
                WhatsApp
              </button>
            </div>
            <input
              type="text"
              value={draft.destination}
              onChange={(e) => patch("destination", e.target.value)}
              placeholder="https://… or /booking"
              className={inputCls}
              required
            />
            <p className="mt-1 text-[11px] text-muted">
              Any external http(s) URL, an internal path starting with &quot;/&quot;, or build a
              WhatsApp CTA with the button above.
            </p>
          </div>

          <div className="mb-4">
            <label className="mb-1.5 block font-mono text-eyebrow text-ink-navy">
              Label / notes <span className="text-muted">(optional)</span>
            </label>
            <input
              type="text"
              value={draft.label}
              onChange={(e) => patch("label", e.target.value)}
              placeholder="e.g. Instagram bio — Aug campaign"
              className={inputCls}
            />
          </div>

          <div className="mb-6 grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <label className="mb-1.5 block font-mono text-eyebrow text-ink-navy">
                Expires <span className="text-muted">(optional)</span>
              </label>
              <input
                type="datetime-local"
                value={draft.expiresAt}
                onChange={(e) => patch("expiresAt", e.target.value)}
                className={inputCls}
              />
              <p className="mt-1 text-[11px] text-muted">
                Link stops working after this time (your local timezone).
              </p>
            </div>
            <div>
              <label className="mb-1.5 block font-mono text-eyebrow text-ink-navy">
                Click limit <span className="text-muted">(optional)</span>
              </label>
              <input
                type="number"
                min={0}
                value={draft.clickLimit}
                onChange={(e) => patch("clickLimit", e.target.value)}
                placeholder="Unlimited"
                className={inputCls}
              />
              <p className="mt-1 text-[11px] text-muted">
                Link deactivates itself after this many clicks.
              </p>
            </div>
          </div>

          <div className="mb-6">
            <label className="mb-1.5 block font-mono text-eyebrow text-ink-navy">Status</label>
            <div className="flex gap-2">
              {[true, false].map((v) => (
                <button
                  key={String(v)}
                  type="button"
                  onClick={() => patch("isActive", v)}
                  className={`tap rounded-pill border px-4 py-2 text-caption font-medium transition ${
                    draft.isActive === v
                      ? "border-ink-navy bg-ink-navy text-chalk-white"
                      : "border-hairline-strong bg-chalk-white text-ink-navy hover:bg-mist-navy"
                  }`}
                >
                  {v ? "Active" : "Turned off"}
                </button>
              ))}
            </div>
            <p className="mt-1 text-[11px] text-muted">
              Turned-off links show visitors a &quot;link unavailable&quot; page instead of
              redirecting.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <button
              type="submit"
              disabled={saving || draft.destination.trim() === ""}
              className="tap rounded-pill bg-ink-navy px-6 py-2.5 text-caption font-medium text-chalk-white transition hover:bg-ink-navy/90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {saving ? "Saving…" : editingId ? "Save Changes" : "Create Link"}
            </button>
            <button
              type="button"
              onClick={() => setShowForm(false)}
              className="tap rounded-pill border border-hairline-strong bg-chalk-white px-5 py-2.5 text-caption font-medium text-ink-navy transition hover:bg-mist-navy"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {/* ─── Links table ───────────────────────────────────────────────────── */}
      {loading ? (
        <div className="flex h-48 items-center justify-center rounded-card border border-hairline bg-chalk-white">
          <span className="text-caption text-muted">Loading…</span>
        </div>
      ) : sortedLinks.length === 0 ? (
        <div className="flex h-48 flex-col items-center justify-center gap-2 rounded-card border border-hairline bg-chalk-white">
          <span className="text-caption text-muted">No short links yet.</span>
          <span className="text-[12px] text-muted">
            Create one to share draep.com/link/&lt;slug&gt; anywhere.
          </span>
        </div>
      ) : (
        <>
          {/* Desktop table */}
          <div className="hidden overflow-x-auto rounded-card border border-hairline bg-chalk-white shadow-card md:block">
            <table className="w-full text-left text-data">
              <thead>
                <tr className="border-b border-hairline bg-mist-navy/50">
                  <th className="px-4 py-3 font-mono text-eyebrow text-ink-navy">Short URL</th>
                  <th className="px-4 py-3 font-mono text-eyebrow text-ink-navy">Destination</th>
                  <th className="px-4 py-3 font-mono text-eyebrow text-ink-navy">Label</th>
                  <th className="px-4 py-3 font-mono text-eyebrow text-ink-navy">Clicks</th>
                  <th className="px-4 py-3 font-mono text-eyebrow text-ink-navy">Status</th>
                  <th className="px-4 py-3 font-mono text-eyebrow text-ink-navy">Last clicked</th>
                </tr>
              </thead>
              <tbody>
                {sortedLinks.map((l) => {
                  const status = linkStatus(l, now);
                  const qrBusy = qrBusySlug === l.slug;
                  // Keep the hover toolbar pinned while any per-row feedback is showing.
                  const toolbarShown =
                    qrBusy || qrDone?.slug === l.slug || copiedSlug === l.slug;
                  return (
                    <tr
                      key={l.id}
                      className="group border-b border-hairline last:border-b-0 hover:bg-mist-navy/30"
                    >
                      <td className="whitespace-nowrap px-4 py-3 font-mono text-ink">
                        /link/{l.slug}
                      </td>
                      <td className="max-w-[220px] truncate px-4 py-3 text-muted" title={l.destination ?? ""}>
                        {l.destination}
                      </td>
                      <td className="max-w-[160px] truncate px-4 py-3 text-muted" title={l.label ?? ""}>
                        {l.label || "—"}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3">
                        {l.click_count ?? 0}
                        {l.click_limit != null && (
                          <span className="text-muted"> / {l.click_limit}</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`rounded-pill px-2.5 py-1 text-[11px] font-medium ${STATUS_STYLES[status]}`}>
                          {STATUS_LABELS[status]}
                        </span>
                      </td>
                      <td className="relative whitespace-nowrap px-4 py-3 text-muted">
                        {formatWhen(l.last_clicked_at)}
                        {/* Floating row actions — hidden until the row is hovered
                            (or focused / showing feedback). */}
                        <div
                          className={`absolute right-3 top-1/2 z-10 flex -translate-y-1/2 items-center gap-0.5 rounded-pill border border-hairline bg-chalk-white px-1.5 py-1 shadow-card transition-opacity duration-150 ${
                            toolbarShown
                              ? "pointer-events-auto opacity-100"
                              : "pointer-events-none opacity-0 group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100"
                          }`}
                        >
                          <button
                            type="button"
                            onClick={() => handleCopy(l.slug ?? "")}
                            className="tap rounded-pill px-2.5 py-1 text-[11px] font-medium text-ink-navy transition hover:bg-mist-navy"
                          >
                            {copiedSlug === l.slug ? "Copied ✓" : "Copy URL"}
                          </button>
                          <button
                            type="button"
                            disabled={qrBusy}
                            onClick={() => handleQr(l.slug ?? "", "copy")}
                            className="tap rounded-pill px-2.5 py-1 text-[11px] font-medium text-ink-navy transition hover:bg-mist-navy disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            {qrDone?.slug === l.slug && qrDone.action === "copy"
                              ? qrDone.msg
                              : qrBusy
                                ? "QR…"
                                : "Copy QR"}
                          </button>
                          <button
                            type="button"
                            disabled={qrBusy}
                            onClick={() => handleQr(l.slug ?? "", "download")}
                            className="tap rounded-pill px-2.5 py-1 text-[11px] font-medium text-ink-navy transition hover:bg-mist-navy disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            {qrDone?.slug === l.slug && qrDone.action === "download"
                              ? qrDone.msg
                              : qrBusy
                                ? "QR…"
                                : "Download QR"}
                          </button>
                          <button
                            type="button"
                            onClick={() => openEdit(l)}
                            className="tap rounded-pill px-2.5 py-1 text-[11px] font-medium text-ink-navy transition hover:bg-mist-navy"
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDelete(l)}
                            className="tap rounded-pill px-2.5 py-1 text-[11px] font-medium text-error-text transition hover:bg-error-bg"
                          >
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Mobile cards */}
          <div className="space-y-3 md:hidden">
            {sortedLinks.map((l) => {
              const status = linkStatus(l, now);
              const qrBusy = qrBusySlug === l.slug;
              return (
                <div
                  key={l.id}
                  className="rounded-card border border-hairline bg-chalk-white p-4 shadow-card"
                >
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <span className="break-all font-mono text-data text-ink">/link/{l.slug}</span>
                    <span className={`shrink-0 rounded-pill px-2.5 py-1 text-[11px] font-medium ${STATUS_STYLES[status]}`}>
                      {STATUS_LABELS[status]}
                    </span>
                  </div>
                  <p className="mb-1 break-all text-caption text-muted">→ {l.destination}</p>
                  {l.label && <p className="mb-1 text-caption text-muted">{l.label}</p>}
                  <p className="mb-3 text-[11px] text-muted">
                    {(l.click_count ?? 0)}
                    {l.click_limit != null ? ` / ${l.click_limit}` : ""} clicks · last{" "}
                    {formatWhen(l.last_clicked_at)}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => handleCopy(l.slug ?? "")}
                      className="tap rounded-pill border border-hairline-strong bg-chalk-white px-3 py-1.5 text-[11px] font-medium text-ink-navy transition hover:bg-mist-navy"
                    >
                      {copiedSlug === l.slug ? "Copied ✓" : "Copy URL"}
                    </button>
                    <button
                      type="button"
                      disabled={qrBusy}
                      onClick={() => handleQr(l.slug ?? "", "copy")}
                      className="tap rounded-pill border border-hairline-strong bg-chalk-white px-3 py-1.5 text-[11px] font-medium text-ink-navy transition hover:bg-mist-navy disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {qrDone?.slug === l.slug && qrDone.action === "copy"
                        ? qrDone.msg
                        : qrBusy
                          ? "QR…"
                          : "Copy QR"}
                    </button>
                    <button
                      type="button"
                      disabled={qrBusy}
                      onClick={() => handleQr(l.slug ?? "", "download")}
                      className="tap rounded-pill border border-hairline-strong bg-chalk-white px-3 py-1.5 text-[11px] font-medium text-ink-navy transition hover:bg-mist-navy disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {qrDone?.slug === l.slug && qrDone.action === "download"
                        ? qrDone.msg
                        : qrBusy
                          ? "QR…"
                          : "Download QR"}
                    </button>
                    <button
                      type="button"
                      onClick={() => openEdit(l)}
                      className="tap rounded-pill border border-hairline-strong bg-chalk-white px-3 py-1.5 text-[11px] font-medium text-ink-navy transition hover:bg-mist-navy"
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDelete(l)}
                      className="tap rounded-pill border border-error-border bg-chalk-white px-3 py-1.5 text-[11px] font-medium text-error-text transition hover:bg-error-bg"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      {/* ─── WhatsApp CTA builder ─────────────────────────────────────────── */}
      <Modal
        open={waOpen}
        onClose={() => setWaOpen(false)}
        title="WhatsApp link"
        maxWidth="max-w-md"
      >
        <p className="mb-4 text-caption text-muted">
          Builds a wa.me destination — opens a WhatsApp chat with the number below and pre-fills
          the message.
        </p>

        <label className="mb-1.5 block font-mono text-eyebrow text-ink-navy">Phone number</label>
        <div className="flex items-center gap-2">
          <span className="shrink-0 font-mono text-data text-muted">+</span>
          <input
            type="tel"
            inputMode="numeric"
            value={waPhone}
            onChange={(e) => setWaPhone(e.target.value)}
            placeholder="918147497006"
            className={inputCls}
            autoFocus
          />
        </div>
        <p
          className={`mb-4 mt-1 text-[11px] ${waPhoneValid ? "text-muted" : "text-error-text"}`}
        >
          {waPhoneValid
            ? "Country code + number, digits only."
            : "Enter 10–15 digits, including the country code."}
        </p>

        <label className="mb-1.5 block font-mono text-eyebrow text-ink-navy">
          Pre-filled message
        </label>
        <textarea
          value={waMessage}
          onChange={(e) => setWaMessage(e.target.value)}
          rows={3}
          placeholder="Hi Draep!…"
          className="w-full resize-none rounded-card border border-hairline-strong bg-chalk-white px-3 py-2 text-data text-ink outline-none focus:border-accent-text"
        />

        <div className="mb-5 mt-4 rounded-card border border-hairline bg-mist-navy/40 p-3">
          <p className="mb-1 font-mono text-eyebrow text-ink-navy">Destination</p>
          <p className="break-all font-mono text-[11px] leading-relaxed text-ink">{waUrl}</p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            disabled={!waPhoneValid}
            onClick={applyWaDestination}
            className="tap rounded-pill bg-ink-navy px-5 py-2.5 text-caption font-medium text-chalk-white transition hover:bg-ink-navy/90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Use this destination
          </button>
          <a
            href={waUrl}
            target="_blank"
            rel="noreferrer"
            className="tap rounded-pill border border-hairline-strong bg-chalk-white px-5 py-2.5 text-caption font-medium text-ink-navy transition hover:bg-mist-navy"
          >
            Test chat ↗
          </a>
          <button
            type="button"
            onClick={() => setWaOpen(false)}
            className="tap rounded-pill px-3 py-2.5 text-caption font-medium text-muted transition hover:text-ink-navy"
          >
            Cancel
          </button>
        </div>
      </Modal>
    </div>
  );
}
