"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  createTableRow,
  deleteUser,
  fetchTableRows,
  type UserRow,
} from "@/lib/admin-api";
import { AcquisitionSection } from "@/components/acquisition/AcquisitionSection";
import {
  acquisitionPayload,
  emptyAcquisition,
  type AcquisitionState,
} from "@/lib/acquisition";

// ─── Constants ────────────────────────────────────────────────────────────────

const ROLES = ["customer", "admin", "style_captain", "tailor"] as const;
const GENDERS = ["male", "female", "other"] as const;

const ROLE_STYLE: Record<string, string> = {
  admin: "bg-purple-100 text-purple-800",
  style_captain: "bg-blue-100 text-blue-800",
  tailor: "bg-amber-100 text-amber-800",
  customer: "bg-gray-100 text-gray-600",
};

function RoleBadge({ value }: { value: string | null }) {
  if (!value) return <span className="text-muted">—</span>;
  const cls = ROLE_STYLE[value] ?? "bg-gray-100 text-gray-600";
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
  return d.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function truncateId(id: string): string {
  return id.slice(0, 8);
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function UsersListPage() {
  const router = useRouter();

  const [users, setUsers] = useState<UserRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [perPage] = useState(20);
  const [filterRole, setFilterRole] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");

  // ── Multi-select + bulk actions ─────────────────────────────────────────
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);

  // ── Create user form state ──────────────────────────────────────────────
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createFormError, setCreateFormError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  // Form fields (all available configs)
  const [fName, setFName] = useState("");
  const [fPhone, setFPhone] = useState("");
  const [fEmail, setFEmail] = useState("");
  const [fRole, setFRole] = useState<string>("customer");
  const [fGender, setFGender] = useState<string>("");
  const [fCountryCode, setFCountryCode] = useState("+91");
  const [fTimezone, setFTimezone] = useState("Asia/Kolkata");
  const [fPassword, setFPassword] = useState("");

  // Acquisition (first-touch for this new user)
  const [acquisition, setAcquisition] = useState<AcquisitionState>(emptyAcquisition());

  // Auto-dismiss flash after 4s
  useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => setFlash(null), 4000);
    return () => clearTimeout(t);
  }, [flash]);

  function resetCreateForm() {
    setFName("");
    setFPhone("");
    setFEmail("");
    setFRole("customer");
    setFGender("");
    setFCountryCode("+91");
    setFTimezone("Asia/Kolkata");
    setFPassword("");
    setAcquisition(emptyAcquisition());
    setCreateFormError(null);
  }

  async function handleCreateUser() {
    setCreating(true);
    setCreateFormError(null);
    try {
      const data: Record<string, unknown> = { role: fRole };
      if (fName.trim()) data.name = fName.trim();
      if (fPhone.trim()) data.phone = fPhone.trim();
      if (fEmail.trim()) data.email = fEmail.trim();
      if (fGender) data.gender = fGender;
      if (fCountryCode.trim()) data.country_code = fCountryCode.trim();
      if (fTimezone.trim()) data.timezone = fTimezone.trim();
      if (fPassword.trim()) data.password = fPassword.trim();
      Object.assign(data, acquisitionPayload(acquisition));

      const created = await createTableRow<UserRow>("users", data);
      setShowCreateForm(false);
      resetCreateForm();
      setFlash(`User created (${created.id.slice(0, 8)}) — redirecting…`);
      router.push(`/admin/users/${created.id}`);
    } catch (e) {
      setCreateFormError(
        e instanceof Error ? e.message : "Failed to create user",
      );
    } finally {
      setCreating(false);
    }
  }

  // ── Emit sidebar items ────────────────────────────────────────────────────
  useEffect(() => {
    window.dispatchEvent(
      new CustomEvent("admin-sidebar-update", {
        detail: {
          items: [
            {
              label: "All Users",
              active: true,
              onClick: () => router.push("/admin/users"),
            },
            {
              label: "Style Captains",
              active: false,
              onClick: () => router.push("/admin/users/style-captains"),
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

  // ── Debounced search term ─────────────────────────────────────────────────
  useEffect(() => {
    const t = setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(1);
    }, 350);
    return () => clearTimeout(t);
  }, [searchInput]);

  // ── Fetch users ───────────────────────────────────────────────────────────
  const loadUsers = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const filters: Record<string, string> = {};
      if (filterRole !== "all") filters.role = filterRole;
      if (search) filters.name = search;

      const { rows, total: t } = await fetchTableRows<UserRow>("users", {
        page,
        perPage,
        sortColumn: "created_at",
        sortDirection: "desc",
        filters: Object.keys(filters).length > 0 ? filters : undefined,
      });
      setUsers(rows);
      setTotal(t);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load users");
    } finally {
      setLoading(false);
    }
  }, [page, perPage, filterRole, search]);

  useEffect(() => {
    loadUsers();
  }, [loadUsers]);

  const totalPages = Math.max(1, Math.ceil(total / perPage));

  // ── Clear selection whenever the view changes ─────────────────────────────
  useEffect(() => {
    setSelected(new Set());
  }, [page, filterRole, search]);

  // ── Selection handlers ────────────────────────────────────────────────────
  const toggleUser = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const currentPageIds = users.map((u) => u.id);
  const allOnPageSelected =
    currentPageIds.length > 0 && currentPageIds.every((id) => selected.has(id));

  const toggleSelectAll = useCallback(() => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (currentPageIds.every((id) => next.has(id))) {
        currentPageIds.forEach((id) => next.delete(id));
      } else {
        currentPageIds.forEach((id) => next.add(id));
      }
      return next;
    });
  }, [currentPageIds]);

  const clearSelection = useCallback(() => setSelected(new Set()), []);

  // ── Bulk delete handler ───────────────────────────────────────────────────
  const handleBulkDelete = useCallback(async () => {
    const count = selected.size;
    if (count === 0) return;
    if (!window.confirm(`Delete ${count} user(s)? This cannot be undone.`)) return;

    setBulkBusy(true);
    const ids = Array.from(selected);
    const results = await Promise.allSettled(
      ids.map((id) => deleteUser(id)),
    );
    const fulfilled = results.filter((r) => r.status === "fulfilled").length;
    const failed = results.length - fulfilled;
    setBulkBusy(false);

    setFlash(
      failed === 0
        ? `Deleted ${fulfilled} user${fulfilled !== 1 ? "s" : ""}.`
        : `Deleted ${fulfilled}, ${failed} failed.`,
    );
    clearSelection();
    loadUsers();
  }, [selected, clearSelection, loadUsers]);

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-6 md:px-8 md:py-8">
      {/* Header */}
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-heading text-2xl font-bold text-ink-navy md:text-3xl">
            Users
          </h1>
          <p className="mt-1 text-sm text-muted">
            {total} user{total !== 1 ? "s" : ""} • click a row to view detail
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              setShowCreateForm((v) => !v);
              if (!showCreateForm) {
                setCreateFormError(null);
                setFlash(null);
              }
            }}
            className="rounded-lg bg-ink-navy px-4 py-2 text-xs font-semibold text-chalk-white transition hover:bg-tape disabled:opacity-40"
          >
            {showCreateForm ? "✕ Cancel" : "+ New User"}
          </button>
          <button
            onClick={() => loadUsers()}
            className="rounded-lg border border-hairline-strong px-4 py-2 text-xs font-medium text-ink transition hover:bg-mist-navy/30"
          >
            ↻ Refresh
          </button>
        </div>
      </div>

      {/* Flash message */}
      {flash && (
        <div className="mb-4 rounded-lg border border-green-200 bg-green-50 px-4 py-2.5 text-sm text-green-800">
          {flash}
        </div>
      )}

      {/* Create user form */}
      {showCreateForm && (
        <div className="mb-6 rounded-xl border border-hairline bg-chalk-white p-5">
          <h2 className="mb-4 text-sm font-bold text-ink-navy">Create new user</h2>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {/* Name */}
            <div>
              <label className="mb-1 block text-xs font-medium text-muted">
                Name
              </label>
              <input
                type="text"
                value={fName}
                onChange={(e) => setFName(e.target.value)}
                placeholder="Full name"
                className="w-full rounded-lg border border-hairline-strong bg-chalk-white px-3 py-2 text-sm focus:border-ink-navy focus:outline-none"
              />
            </div>

            {/* Phone */}
            <div>
              <label className="mb-1 block text-xs font-medium text-muted">
                Phone <span className="text-red-500">*</span>
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={fCountryCode}
                  onChange={(e) => setFCountryCode(e.target.value)}
                  placeholder="+91"
                  className="w-20 rounded-lg border border-hairline-strong bg-chalk-white px-3 py-2 text-sm focus:border-ink-navy focus:outline-none"
                />
                <input
                  type="tel"
                  value={fPhone}
                  onChange={(e) => setFPhone(e.target.value)}
                  placeholder="9876543210"
                  className="flex-1 rounded-lg border border-hairline-strong bg-chalk-white px-3 py-2 text-sm focus:border-ink-navy focus:outline-none"
                />
              </div>
            </div>

            {/* Email */}
            <div>
              <label className="mb-1 block text-xs font-medium text-muted">
                Email
              </label>
              <input
                type="email"
                value={fEmail}
                onChange={(e) => setFEmail(e.target.value)}
                placeholder="user@example.com"
                className="w-full rounded-lg border border-hairline-strong bg-chalk-white px-3 py-2 text-sm focus:border-ink-navy focus:outline-none"
              />
            </div>

            {/* Role */}
            <div>
              <label className="mb-1 block text-xs font-medium text-muted">
                Role
              </label>
              <select
                value={fRole}
                onChange={(e) => setFRole(e.target.value)}
                className="w-full rounded-lg border border-hairline-strong bg-chalk-white px-3 py-2 text-sm focus:border-ink-navy focus:outline-none"
              >
                {ROLES.map((r) => (
                  <option key={r} value={r}>
                    {r.replace(/_/g, " ")}
                  </option>
                ))}
              </select>
            </div>

            {/* Gender */}
            <div>
              <label className="mb-1 block text-xs font-medium text-muted">
                Gender
              </label>
              <select
                value={fGender}
                onChange={(e) => setFGender(e.target.value)}
                className="w-full rounded-lg border border-hairline-strong bg-chalk-white px-3 py-2 text-sm focus:border-ink-navy focus:outline-none"
              >
                <option value="">—</option>
                {GENDERS.map((g) => (
                  <option key={g} value={g}>
                    {g}
                  </option>
                ))}
              </select>
            </div>

            {/* Timezone */}
            <div>
              <label className="mb-1 block text-xs font-medium text-muted">
                Timezone
              </label>
              <input
                type="text"
                value={fTimezone}
                onChange={(e) => setFTimezone(e.target.value)}
                placeholder="Asia/Kolkata"
                className="w-full rounded-lg border border-hairline-strong bg-chalk-white px-3 py-2 text-sm focus:border-ink-navy focus:outline-none"
              />
            </div>

            {/* Password (staff only) */}
            {(fRole === "admin" || fRole === "style_captain" || fRole === "tailor") && (
              <div className="md:col-span-2">
                <label className="mb-1 block text-xs font-medium text-muted">
                  Password (required for staff: admin, style captain, tailor)
                </label>
                <input
                  type="password"
                  value={fPassword}
                  onChange={(e) => setFPassword(e.target.value)}
                  placeholder="Staff login password"
                  className="w-full rounded-lg border border-hairline-strong bg-chalk-white px-3 py-2 text-sm focus:border-ink-navy focus:outline-none"
                />
              </div>
            )}
          </div>

          {/* Acquisition source (first-touch) */}
          <div className="mt-4">
            <AcquisitionSection
              value={acquisition}
              onChange={setAcquisition}
              summaryLabel="Acquisition source"
              hint="Optional — how this customer was acquired. Recorded as their original first-touch source."
            />
          </div>

          {/* Error */}
          {createFormError && (
            <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-700">
              {createFormError}
            </div>
          )}

          {/* Actions */}
          <div className="mt-4 flex items-center gap-3">
            <button
              onClick={handleCreateUser}
              disabled={creating || !fPhone.trim()}
              className="rounded-lg bg-ink-navy px-5 py-2 text-xs font-semibold text-chalk-white transition hover:bg-tape disabled:opacity-40"
            >
              {creating ? "Creating…" : "Create user"}
            </button>
            <button
              onClick={() => {
                setShowCreateForm(false);
                resetCreateForm();
              }}
              className="rounded-lg border border-hairline-strong px-4 py-2 text-xs font-medium text-ink transition hover:bg-mist-navy/30"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        {/* Search */}
        <div className="flex items-center gap-1.5">
          <input
            type="text"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search by name…"
            className="w-56 rounded-lg border border-hairline-strong bg-chalk-white px-3 py-1.5 text-xs text-ink placeholder:text-muted focus:border-ink-navy focus:outline-none"
          />
        </div>

        {/* Role filter */}
        <div className="flex items-center gap-1.5">
          <span className="text-xs font-medium text-muted">Role:</span>
          <select
            value={filterRole}
            onChange={(e) => {
              setPage(1);
              setFilterRole(e.target.value);
            }}
            className="rounded-lg border border-hairline-strong bg-chalk-white px-2 py-1 text-xs text-ink focus:border-ink-navy focus:outline-none"
          >
            <option value="all">All</option>
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {r.replace(/_/g, " ")}
              </option>
            ))}
          </select>
        </div>

        {(filterRole !== "all" || search) && (
          <button
            onClick={() => {
              setFilterRole("all");
              setSearchInput("");
              setSearch("");
              setPage(1);
            }}
            className="text-xs font-medium text-ink-navy underline hover:text-tape"
          >
            Clear filters
          </button>
        )}
      </div>

      {/* Bulk action bar */}
      {selected.size > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-ink-navy/30 bg-mist-navy/40 px-4 py-2.5">
          <span className="text-xs font-semibold text-ink-navy">
            {selected.size} selected
          </span>

          <button
            onClick={handleBulkDelete}
            disabled={bulkBusy}
            className="rounded-lg border border-red-300 bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-700 transition hover:bg-red-100 disabled:opacity-40"
          >
            {bulkBusy ? "Deleting…" : "Delete"}
          </button>

          <button
            onClick={clearSelection}
            disabled={bulkBusy}
            className="text-xs font-medium text-muted underline hover:text-ink-navy disabled:opacity-40"
          >
            Clear
          </button>
        </div>
      )}

      {/* Loading / Error */}
      {loading && (
        <div className="py-12 text-center text-muted">Loading users…</div>
      )}
      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          Error: {error}
        </div>
      )}

      {/* Table */}
      {!loading && !error && (
        <>
          {users.length === 0 ? (
            <div className="py-16 text-center">
              <div className="text-sm text-muted">No users found.</div>
            </div>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-hairline bg-chalk-white">
              <table className="w-full min-w-[700px] text-left text-sm">
                <thead>
                  <tr className="border-b border-hairline bg-mist-navy/40 text-xs uppercase tracking-wide text-muted">
                    <th className="w-10 px-4 py-3">
                      <input
                        type="checkbox"
                        checked={allOnPageSelected}
                        onChange={toggleSelectAll}
                        aria-label="Select all on page"
                        className="h-4 w-4 cursor-pointer rounded border-hairline-strong accent-ink-navy"
                      />
                    </th>
                    <th className="px-4 py-3 font-medium">Name</th>
                    <th className="px-4 py-3 font-medium">Phone</th>
                    <th className="px-4 py-3 font-medium">Email</th>
                    <th className="px-4 py-3 font-medium">Role</th>
                    <th className="px-4 py-3 font-medium">Gender</th>
                    <th className="px-4 py-3 font-medium">Joined</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((user) => (
                    <tr
                      key={user.id}
                      onClick={() => router.push(`/admin/users/${user.id}`)}
                      className={`cursor-pointer border-b border-hairline transition hover:bg-mist-navy/30 last:border-0 ${selected.has(user.id) ? "bg-mist-navy/40" : ""}`}
                    >
                      <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={selected.has(user.id)}
                          onChange={() => toggleUser(user.id)}
                          aria-label={`Select user ${user.name ?? user.id.slice(0, 8)}`}
                          className="h-4 w-4 cursor-pointer rounded border-hairline-strong accent-ink-navy"
                        />
                      </td>
                      <td className="px-4 py-3">
                        <div className="text-[13px] font-medium text-ink-navy">
                          {user.name ?? "Unnamed"}
                        </div>
                        <div className="text-[11px] text-muted">
                          id: {truncateId(user.id)}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-[13px] text-ink">
                        {user.phone ?? "—"}
                      </td>
                      <td className="px-4 py-3 text-[13px] text-ink">
                        {user.email ?? "—"}
                      </td>
                      <td className="px-4 py-3">
                        <RoleBadge value={user.role} />
                      </td>
                      <td className="px-4 py-3 text-[13px] capitalize text-ink">
                        {user.gender ?? "—"}
                      </td>
                      <td className="px-4 py-3 text-[12px] text-muted">
                        {formatDate(user.created_at)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="mt-5 flex items-center justify-between">
              <span className="text-xs text-muted">
                Page {page} of {totalPages}
              </span>
              <div className="flex gap-2">
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page === 1}
                  className="rounded-lg border border-hairline-strong px-3 py-1.5 text-xs font-medium text-ink transition enabled:hover:bg-mist-navy disabled:opacity-40"
                >
                  ← Prev
                </button>
                <button
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page === totalPages}
                  className="rounded-lg border border-hairline-strong px-3 py-1.5 text-xs font-medium text-ink transition enabled:hover:bg-mist-navy disabled:opacity-40"
                >
                  Next →
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
