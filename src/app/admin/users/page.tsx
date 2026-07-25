"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  fetchTableRows,
  type UserRow,
} from "@/lib/admin-api";

// ─── Constants ────────────────────────────────────────────────────────────────

const ROLES = ["customer", "admin", "style_captain", "tailor"] as const;

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
        <button
          onClick={() => loadUsers()}
          className="rounded-lg border border-hairline-strong px-4 py-2 text-xs font-medium text-ink transition hover:bg-mist-navy/30"
        >
          ↻ Refresh
        </button>
      </div>

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
                      className="cursor-pointer border-b border-hairline transition hover:bg-mist-navy/30 last:border-0"
                    >
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
