"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  createUserLoginLink,
  fetchTableRows,
  updateTableRow,
  createTableRow,
  deleteTableRow,
  formatOrderSlot,
  type UserRow,
  type AddressRow,
  type OrderRow,
  type MeasurementJobRow,
} from "@/lib/admin-api";
import { ACQUISITION_FIELDS } from "@/lib/acquisition";
import { Chip } from "@/components/ui/Chip";

// ─── Constants ────────────────────────────────────────────────────────────────

const ROLES = ["customer", "admin", "style_captain", "tailor"] as const;
const GENDERS = ["male", "female", "other"] as const;

const ROLE_STYLE: Record<string, string> = {
  admin: "bg-purple-100 text-purple-800",
  style_captain: "bg-blue-100 text-blue-800",
  tailor: "bg-amber-100 text-amber-800",
  customer: "bg-gray-100 text-gray-600",
};

const JOB_STATUS_STYLE: Record<string, string> = {
  scheduled: "bg-blue-100 text-blue-800",
  in_progress: "bg-indigo-100 text-indigo-800",
  completed: "bg-green-100 text-green-800",
  cancelled: "bg-red-100 text-red-700",
};

const FULFILLMENT_STYLE: Record<string, string> = {
  draft: "bg-gray-100 text-gray-600",
  pending: "bg-amber-100 text-amber-800",
  scheduled: "bg-blue-100 text-blue-800",
  in_progress: "bg-indigo-100 text-indigo-800",
  completed: "bg-green-100 text-green-800",
  cancelled: "bg-red-100 text-red-700",
};

function Badge({
  value,
  map,
}: {
  value: string | null;
  map: Record<string, string>;
}) {
  if (!value) return <span className="text-muted">—</span>;
  const cls = map[value] ?? "bg-gray-100 text-gray-600";
  return (
    <span className={`inline-block rounded-pill px-2 py-0.5 text-[11px] font-medium capitalize ${cls}`}>
      {value.replace(/_/g, " ")}
    </span>
  );
}

function formatDate(v: string | null | undefined): string {
  if (!v) return "—";
  const d = new Date(v);
  if (isNaN(d.getTime())) return v;
  return d.toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function truncateId(id: string): string {
  return id.slice(0, 8);
}

async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Non-secure context or permission denied — execCommand fallback.
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    try {
      return document.execCommand("copy");
    } finally {
      document.body.removeChild(ta);
    }
  }
}

// ─── Editable text field (auto-saves on blur) ────────────────────────────────

function EditableText({
  label,
  value,
  onSave,
  type = "text",
  placeholder,
  chips,
}: {
  label: string;
  value: string | null;
  onSave: (v: string | null) => Promise<void>;
  type?: "text" | "email" | "tel";
  placeholder?: string;
  /** Optional suggestion chips. Tap sets+saves; tap active clears. */
  chips?: readonly string[];
}) {
  const [draft, setDraft] = useState(value ?? "");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setDraft(value ?? "");
  }, [value]);

  async function commit(next: string) {
    const v = next.trim() === "" ? null : next.trim();
    if (v === value) return;
    setSaving(true);
    try {
      await onSave(v);
    } catch (e) {
      alert(e instanceof Error ? e.message : "Update failed");
      setDraft(value ?? "");
    } finally {
      setSaving(false);
    }
  }

  async function handleBlur() {
    if (draft === (value ?? "")) return;
    await commit(draft);
  }

  function tapChip(opt: string) {
    const next = draft === opt ? "" : opt;
    setDraft(next);
    void commit(next);
  }

  return (
    <div>
      <label className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-muted">
        {label}
      </label>
      <input
        type={type}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={handleBlur}
        placeholder={placeholder ?? `Enter ${label.toLowerCase()}…`}
        disabled={saving}
        className="w-full rounded-lg border border-hairline-strong bg-chalk-white px-3 py-1.5 text-[13px] text-ink focus:border-ink-navy focus:outline-none disabled:opacity-50"
      />
      {saving && <span className="text-[10px] text-muted">Saving…</span>}
      {chips && chips.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {chips.map((opt) => (
            <Chip
              key={opt}
              selected={draft === opt}
              ariaLabel={`${label}: ${opt}`}
              onClick={() => tapChip(opt)}
              className="min-h-[26px] px-2 py-0.5 text-[10px]"
            >
              {opt}
            </Chip>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function UserDetailPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const userId = params.id;

  const [user, setUser] = useState<UserRow | null>(null);
  const [addresses, setAddresses] = useState<AddressRow[]>([]);
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [jobs, setJobs] = useState<MeasurementJobRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [savingField, setSavingField] = useState<string | null>(null);
  const [loginLinkBusy, setLoginLinkBusy] = useState(false);

  // Address creation
  const [showAddrForm, setShowAddrForm] = useState(false);
  const [addrDraft, setAddrDraft] = useState<Partial<AddressRow>>({});

  // ── Emit sidebar items ────────────────────────────────────────────────────
  useEffect(() => {
    window.dispatchEvent(
      new CustomEvent("admin-sidebar-update", {
        detail: {
          items: [
            {
              label: "← Back to Users",
              active: true,
              onClick: () => router.push("/admin/users"),
            },
          ],
        },
      }),
    );
    return () => {
      window.dispatchEvent(
        new CustomEvent("admin-sidebar-update", { detail: null }),
      );
    };
  }, [router]);

  // ── Flash auto-dismiss ────────────────────────────────────────────────────
  useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => setFlash(null), 3000);
    return () => clearTimeout(t);
  }, [flash]);

  // ── Load everything ───────────────────────────────────────────────────────
  const loadAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { rows: userRows } = await fetchTableRows<UserRow>("users", {
        filters: { id: userId },
        perPage: 1,
      });
      if (userRows.length === 0) {
        setError("User not found");
        return;
      }
      setUser(userRows[0]);

      const [addrRes, orderRes, jobRes] = await Promise.all([
        fetchTableRows<AddressRow>("addresses", {
          filters: { user_id: userId },
          perPage: 50,
          sortColumn: "created_at",
          sortDirection: "desc",
        }).catch(() => ({ rows: [] as AddressRow[], total: 0, columns: [] })),
        fetchTableRows<OrderRow>("orders", {
          filters: { user_id: userId },
          perPage: 50,
          sortColumn: "created_at",
          sortDirection: "desc",
        }).catch(() => ({ rows: [] as OrderRow[], total: 0, columns: [] })),
        fetchTableRows<MeasurementJobRow>("measurement_jobs", {
          filters: { user_id: userId },
          perPage: 50,
          sortColumn: "created_at",
          sortDirection: "desc",
        }).catch(() => ({ rows: [] as MeasurementJobRow[], total: 0, columns: [] })),
      ]);

      setAddresses(addrRes.rows);
      setOrders(orderRes.rows);
      setJobs(jobRes.rows);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load user");
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  // ── Update user field ─────────────────────────────────────────────────────
  async function handleUpdateField(
    field: string,
    value: string | string[] | null,
  ) {
    if (!user) return;
    setSavingField(field);
    try {
      await updateTableRow("users", user.id, { [field]: value });
      setUser({ ...user, [field]: value });
      setFlash("User updated");
    } catch (e) {
      alert(e instanceof Error ? e.message : "Update failed");
    } finally {
      setSavingField(null);
    }
  }

  // Toggle one role in the user's roles array (PUTs the full new array).
  function handleToggleRole(role: string) {
    if (!user) return;
    const current = user.roles ?? [];
    const next = current.includes(role)
      ? current.filter((r) => r !== role)
      : [...current, role];
    handleUpdateField("roles", next);
  }

  // ── Copy login link (open the user's logged-in dashboard) ─────────────────
  async function handleCopyLoginLink() {
    if (!user || loginLinkBusy) return;
    setLoginLinkBusy(true);
    try {
      const out = await createUserLoginLink(user.id);
      const url = `${window.location.origin}/app/orders/?token=${encodeURIComponent(out.token)}`;
      const copied = await copyToClipboard(url);
      if (copied) {
        setFlash("Login link copied — valid for 15 minutes");
      } else {
        // Last resort: let the admin copy manually.
        window.prompt("Copy this login link (valid 15 minutes):", url);
      }
    } catch (e) {
      alert(e instanceof Error ? e.message : "Could not create login link");
    } finally {
      setLoginLinkBusy(false);
    }
  }

  // ── Address CRUD ──────────────────────────────────────────────────────────
  async function handleCreateAddress() {
    if (!user) return;
    try {
      await createTableRow<AddressRow>("addresses", {
        user_id: user.id,
        address_line_1: addrDraft.address_line_1 ?? null,
        address_line_2: addrDraft.address_line_2 ?? null,
        city: addrDraft.city ?? null,
        state: addrDraft.state ?? null,
        pincode: addrDraft.pincode ?? null,
      });
      setFlash("Address added");
      setShowAddrForm(false);
      setAddrDraft({});
      await loadAll();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed to add address");
    }
  }

  async function handleUpdateAddress(
    addrId: string,
    field: string,
    value: string | null,
  ) {
    try {
      await updateTableRow("addresses", addrId, { [field]: value });
      setAddresses((prev) =>
        prev.map((a) => (a.id === addrId ? { ...a, [field]: value } : a)),
      );
      setFlash("Address updated");
    } catch (e) {
      alert(e instanceof Error ? e.message : "Update failed");
    }
  }

  async function handleDeleteAddress(addrId: string) {
    if (!confirm("Delete this address?")) return;
    try {
      await deleteTableRow("addresses", addrId);
      setAddresses((prev) => prev.filter((a) => a.id !== addrId));
      setFlash("Address deleted");
    } catch (e) {
      alert(e instanceof Error ? e.message : "Delete failed");
    }
  }

  // ── Loading / Error states ────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="mx-auto w-full max-w-5xl px-4 py-12 md:px-8">
        <div className="py-12 text-center text-muted">Loading user…</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="mx-auto w-full max-w-5xl px-4 py-12 md:px-8">
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          Error: {error}
        </div>
        <button
          onClick={() => router.push("/admin/users")}
          className="mt-4 rounded-lg border border-hairline-strong px-4 py-2 text-xs font-medium text-ink hover:bg-mist-navy/30"
        >
          ← Back to Users
        </button>
      </div>
    );
  }

  if (!user) return null;

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6 md:px-8 md:py-8">
      {/* Breadcrumb */}
      <div className="mb-4 flex items-center gap-2 text-xs text-muted">
        <button
          onClick={() => router.push("/admin/users")}
          className="hover:text-ink-navy hover:underline"
        >
          Users
        </button>
        <span>/</span>
        <span className="text-ink">User {truncateId(user.id)}</span>
      </div>

      {/* Flash */}
      {flash && (
        <div className="mb-4 rounded-lg border border-green-200 bg-green-50 px-4 py-2.5 text-sm text-green-800">
          {flash}
        </div>
      )}

      {/* Header card */}
      <div className="mb-6 rounded-xl border border-hairline bg-chalk-white p-5">
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="font-heading text-2xl font-bold text-ink-navy">
              {user.name ?? "Unnamed user"}
            </h1>
            <div className="mt-1 text-xs text-muted">
              Joined {formatDate(user.created_at)} • id: {truncateId(user.id)}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleCopyLoginLink}
              disabled={loginLinkBusy}
              title="Copy a link that opens this user's logged-in dashboard (valid 15 minutes)"
              className="rounded-lg bg-ink-navy px-3 py-1.5 text-xs font-semibold text-chalk-white hover:bg-tape disabled:opacity-50"
            >
              {loginLinkBusy ? "Generating…" : "🔗 Copy Login Link"}
            </button>
            <span className="flex items-center gap-1">
              {(user.roles ?? []).length === 0 ? (
                <span className="text-muted">—</span>
              ) : (
                (user.roles ?? []).map((r) => (
                  <Badge key={r} value={r} map={ROLE_STYLE} />
                ))
              )}
            </span>
          </div>
        </div>

        {/* Editable fields */}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <EditableText
            label="Name"
            value={user.name}
            onSave={(v) => handleUpdateField("name", v)}
            placeholder="Enter name…"
          />
          <EditableText
            label="Phone"
            type="tel"
            value={user.phone}
            onSave={(v) => handleUpdateField("phone", v)}
            placeholder="Enter phone…"
          />
          <EditableText
            label="Email"
            type="email"
            value={user.email}
            onSave={(v) => handleUpdateField("email", v)}
            placeholder="Enter email…"
          />
          <EditableText
            label="Country Code"
            value={user.country_code}
            onSave={(v) => handleUpdateField("country_code", v)}
            placeholder="+91"
          />

          {/* Roles (multi-toggle — e.g. one person can be captain AND tailor) */}
          <div>
            <label className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-muted">
              Roles {savingField === "roles" && "(saving…)"}
            </label>
            <div className="flex flex-wrap gap-2">
              {ROLES.map((r) => {
                const active = (user.roles ?? []).includes(r);
                return (
                  <label
                    key={r}
                    className={`flex cursor-pointer items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[12px] transition ${
                      active
                        ? "border-ink-navy bg-mist-navy/50 font-medium text-ink-navy"
                        : "border-hairline-strong bg-chalk-white text-muted hover:bg-mist-navy/30"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={active}
                      onChange={() => handleToggleRole(r)}
                      className="h-3.5 w-3.5 cursor-pointer rounded border-hairline-strong accent-ink-navy"
                    />
                    {r.replace(/_/g, " ")}
                  </label>
                );
              })}
            </div>
          </div>

          {/* Gender select */}
          <div>
            <label className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-muted">
              Gender {savingField === "gender" && "(saving…)"}
            </label>
            <select
              value={user.gender ?? ""}
              onChange={(e) => handleUpdateField("gender", e.target.value || null)}
              className="w-full rounded-lg border border-hairline-strong bg-chalk-white px-3 py-1.5 text-[13px] text-ink focus:border-ink-navy focus:outline-none"
            >
              <option value="">—</option>
              {GENDERS.map((g) => (
                <option key={g} value={g}>
                  {g}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Acquisition (first-touch) — editable, auto-saves on blur */}
        <details className="group mt-4 rounded-lg border border-hairline bg-chalk-white p-3">
          <summary className="cursor-pointer text-xs font-medium text-muted hover:text-ink-navy">
            <span className="inline-block transition-transform duration-150 group-open:rotate-90">▸</span>{" "}
            Acquisition source <span className="text-[10px] font-normal">(first-touch, auto-saves)</span>
          </summary>
          <div className="mt-3 grid grid-cols-1 gap-4 md:grid-cols-2">
            {ACQUISITION_FIELDS.map((f) => (
              <EditableText
                key={f.key}
                label={f.label}
                value={user[f.dbKey] ?? null}
                onSave={(v) => handleUpdateField(f.dbKey, v)}
                chips={f.options}
                placeholder={f.options[0] ? `e.g. ${f.options[0]}` : `Enter ${f.label.toLowerCase()}…`}
              />
            ))}
          </div>
        </details>
      </div>

      {/* ─── Addresses ──────────────────────────────────────────────────────── */}
      <section className="mb-6">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-heading text-lg font-semibold text-ink-navy">
            Addresses ({addresses.length})
          </h2>
          <button
            onClick={() => setShowAddrForm((v) => !v)}
            className="rounded-lg bg-ink-navy px-3 py-1.5 text-xs font-semibold text-chalk-white hover:bg-tape"
          >
            {showAddrForm ? "✕ Cancel" : "+ Add Address"}
          </button>
        </div>

        {/* New address form */}
        {showAddrForm && (
          <div className="mb-3 rounded-xl border border-hairline bg-chalk-white p-4">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <input
                type="text"
                placeholder="Address Line 1"
                value={addrDraft.address_line_1 ?? ""}
                onChange={(e) =>
                  setAddrDraft({ ...addrDraft, address_line_1: e.target.value })
                }
                className="rounded-lg border border-hairline-strong bg-chalk-white px-3 py-1.5 text-[13px] focus:border-ink-navy focus:outline-none"
              />
              <input
                type="text"
                placeholder="Address Line 2"
                value={addrDraft.address_line_2 ?? ""}
                onChange={(e) =>
                  setAddrDraft({ ...addrDraft, address_line_2: e.target.value })
                }
                className="rounded-lg border border-hairline-strong bg-chalk-white px-3 py-1.5 text-[13px] focus:border-ink-navy focus:outline-none"
              />
              <input
                type="text"
                placeholder="City"
                value={addrDraft.city ?? ""}
                onChange={(e) =>
                  setAddrDraft({ ...addrDraft, city: e.target.value })
                }
                className="rounded-lg border border-hairline-strong bg-chalk-white px-3 py-1.5 text-[13px] focus:border-ink-navy focus:outline-none"
              />
              <input
                type="text"
                placeholder="State"
                value={addrDraft.state ?? ""}
                onChange={(e) =>
                  setAddrDraft({ ...addrDraft, state: e.target.value })
                }
                className="rounded-lg border border-hairline-strong bg-chalk-white px-3 py-1.5 text-[13px] focus:border-ink-navy focus:outline-none"
              />
              <input
                type="text"
                placeholder="Pincode"
                value={addrDraft.pincode ?? ""}
                onChange={(e) =>
                  setAddrDraft({ ...addrDraft, pincode: e.target.value })
                }
                className="rounded-lg border border-hairline-strong bg-chalk-white px-3 py-1.5 text-[13px] focus:border-ink-navy focus:outline-none"
              />
            </div>
            <div className="mt-3">
              <button
                onClick={handleCreateAddress}
                className="rounded-lg bg-ink-navy px-4 py-1.5 text-xs font-semibold text-chalk-white hover:bg-tape"
              >
                Save Address
              </button>
            </div>
          </div>
        )}

        {/* Address list */}
        {addresses.length === 0 ? (
          <div className="rounded-xl border border-hairline bg-chalk-white p-6 text-center text-sm text-muted">
            No addresses yet.
          </div>
        ) : (
          <div className="space-y-3">
            {addresses.map((addr) => (
              <div
                key={addr.id}
                className="rounded-xl border border-hairline bg-chalk-white p-4"
              >
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  <EditableAddressField
                    label="Line 1"
                    value={addr.address_line_1}
                    onSave={(v) =>
                      handleUpdateAddress(addr.id, "address_line_1", v)
                    }
                  />
                  <EditableAddressField
                    label="Line 2"
                    value={addr.address_line_2}
                    onSave={(v) =>
                      handleUpdateAddress(addr.id, "address_line_2", v)
                    }
                  />
                  <EditableAddressField
                    label="City"
                    value={addr.city}
                    onSave={(v) => handleUpdateAddress(addr.id, "city", v)}
                  />
                  <EditableAddressField
                    label="State"
                    value={addr.state}
                    onSave={(v) => handleUpdateAddress(addr.id, "state", v)}
                  />
                  <EditableAddressField
                    label="Pincode"
                    value={addr.pincode}
                    onSave={(v) => handleUpdateAddress(addr.id, "pincode", v)}
                  />
                </div>
                <div className="mt-3 flex items-center justify-between">
                  <span className="text-[10px] text-muted">
                    id: {truncateId(addr.id)} • auto-saves on blur
                  </span>
                  <button
                    onClick={() => handleDeleteAddress(addr.id)}
                    className="text-xs font-medium text-red-600 hover:underline"
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ─── Orders ─────────────────────────────────────────────────────────── */}
      <section className="mb-6">
        <h2 className="mb-3 font-heading text-lg font-semibold text-ink-navy">
          Orders ({orders.length})
        </h2>
        {orders.length === 0 ? (
          <div className="rounded-xl border border-hairline bg-chalk-white p-6 text-center text-sm text-muted">
            No orders yet.
          </div>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-hairline bg-chalk-white">
            <table className="w-full min-w-[600px] text-left text-sm">
              <thead>
                <tr className="border-b border-hairline bg-mist-navy/40 text-xs uppercase tracking-wide text-muted">
                  <th className="px-4 py-3 font-medium">Order #</th>
                  <th className="px-4 py-3 font-medium">Fulfillment</th>
                  <th className="px-4 py-3 font-medium">Slot</th>
                  <th className="px-4 py-3 font-medium">Created</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((order) => (
                  <tr
                    key={order.id}
                    onClick={() => router.push(`/admin/orders/${order.id}`)}
                    className="cursor-pointer border-b border-hairline transition hover:bg-mist-navy/30 last:border-0"
                  >
                    <td className="px-4 py-3 font-mono text-[13px] font-medium text-ink-navy">
                      {order.order_number ?? `#${truncateId(order.id)}`}
                    </td>
                    <td className="px-4 py-3">
                      <Badge value={order.fulfillment_status} map={FULFILLMENT_STYLE} />
                    </td>
                    <td className="px-4 py-3 text-[12px] text-muted">
                      {formatOrderSlot(order.slot) ?? "—"}
                    </td>
                    <td className="px-4 py-3 text-[12px] text-muted">
                      {formatDate(order.created_at)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ─── Measurement Jobs ───────────────────────────────────────────────── */}
      <section className="mb-6">
        <h2 className="mb-3 font-heading text-lg font-semibold text-ink-navy">
          Measurement Jobs ({jobs.length})
        </h2>
        {jobs.length === 0 ? (
          <div className="rounded-xl border border-hairline bg-chalk-white p-6 text-center text-sm text-muted">
            No measurement jobs yet.
          </div>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-hairline bg-chalk-white">
            <table className="w-full min-w-[700px] text-left text-sm">
              <thead>
                <tr className="border-b border-hairline bg-mist-navy/40 text-xs uppercase tracking-wide text-muted">
                  <th className="px-4 py-3 font-medium">Job</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Scheduled</th>
                  <th className="px-4 py-3 font-medium">Started</th>
                  <th className="px-4 py-3 font-medium">Completed</th>
                </tr>
              </thead>
              <tbody>
                {jobs.map((job) => (
                  <tr
                    key={job.id}
                    onClick={() =>
                      router.push(`/admin/orders/measurement-jobs/${job.id}`)
                    }
                    className="cursor-pointer border-b border-hairline transition hover:bg-mist-navy/30 last:border-0"
                  >
                    <td className="px-4 py-3 font-mono text-[13px] font-medium text-ink-navy">
                      #{truncateId(job.id)}
                    </td>
                    <td className="px-4 py-3">
                      <Badge value={job.status} map={JOB_STATUS_STYLE} />
                    </td>
                    <td className="px-4 py-3 text-[12px] text-muted">
                      {formatDate(job.scheduled_at)}
                    </td>
                    <td className="px-4 py-3 text-[12px] text-muted">
                      {formatDate(job.started_at)}
                    </td>
                    <td className="px-4 py-3 text-[12px] text-muted">
                      {formatDate(job.completed_at)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

// ─── Editable address field ──────────────────────────────────────────────────

function EditableAddressField({
  label,
  value,
  onSave,
}: {
  label: string;
  value: string | null;
  onSave: (v: string | null) => Promise<void>;
}) {
  const [draft, setDraft] = useState(value ?? "");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setDraft(value ?? "");
  }, [value]);

  async function handleBlur() {
    if (draft === (value ?? "")) return;
    setSaving(true);
    try {
      await onSave(draft.trim() === "" ? null : draft.trim());
    } catch (e) {
      alert(e instanceof Error ? e.message : "Update failed");
      setDraft(value ?? "");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <label className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-muted">
        {label}
      </label>
      <input
        type="text"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={handleBlur}
        disabled={saving}
        className="w-full rounded-lg border border-hairline-strong bg-chalk-white px-3 py-1.5 text-[13px] text-ink focus:border-ink-navy focus:outline-none disabled:opacity-50"
      />
    </div>
  );
}
