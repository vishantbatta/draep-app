"use client";

/**
 * Style Captains list — admin sub-tab under Users.
 *
 * Lists all users with role = "style_captain". Clicking a row opens the
 * detail page at /admin/users/style-captains/[id] where the admin can
 * edit name/phone, view assigned jobs, and manage the captain's schedule.
 *
 * The "Add Style Captain" button creates a new user with role=style_captain
 * via the generic admin table endpoint.
 */

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  fetchTableRows,
  createCaptain,
  type UserRow,
  type MeasurementJobRow,
} from "@/lib/admin-api";

function truncateId(id: string): string {
  return id.slice(0, 8);
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

// ─── Component ────────────────────────────────────────────────────────────────

export default function StyleCaptainsListPage() {
  const router = useRouter();

  const [captains, setCaptains] = useState<UserRow[]>([]);
  const [jobCounts, setJobCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [showAddForm, setShowAddForm] = useState(false);

  // ── Emit sidebar items ────────────────────────────────────────────────────
  useEffect(() => {
    window.dispatchEvent(
      new CustomEvent("admin-sidebar-update", {
        detail: {
          items: [
            {
              label: "All Users",
              active: false,
              onClick: () => router.push("/admin/users"),
            },
            {
              label: "Style Captains",
              active: true,
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

  // ── Debounced search ──────────────────────────────────────────────────────
  useEffect(() => {
    const t = setTimeout(() => {
      setSearch(searchInput.trim());
    }, 350);
    return () => clearTimeout(t);
  }, [searchInput]);

  // ── Fetch captains ─────────────────────────────────────────────────────────
  const loadCaptains = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { rows } = await fetchTableRows<UserRow>("users", {
        // roles is a JSONB array — membership needs the json_contains op.
        filters: { roles: "style_captain" },
        filterOps: { roles: "json_contains" },
        perPage: 100,
        sortColumn: "created_at",
        sortDirection: "desc",
      });

      // Fetch job counts for each captain in parallel
      const countEntries = await Promise.all(
        rows.map(async (c) => {
          try {
            const { total } = await fetchTableRows<MeasurementJobRow>(
              "measurement_jobs",
              {
                filters: { style_captain_id: c.id },
                perPage: 1,
              },
            );
            return [c.id, total] as const;
          } catch {
            return [c.id, 0] as const;
          }
        }),
      );
      setJobCounts(Object.fromEntries(countEntries));
      setCaptains(rows);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load style captains");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadCaptains();
  }, [loadCaptains]);

  // ── Filter by search ──────────────────────────────────────────────────────
  const filtered = search
    ? captains.filter(
        (c) =>
          (c.name ?? "").toLowerCase().includes(search.toLowerCase()) ||
          (c.phone ?? "").includes(search),
      )
    : captains;

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-6 md:px-8 md:py-8">
      {/* Header */}
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-heading text-2xl font-bold text-ink-navy md:text-3xl">
            Style Captains
          </h1>
          <p className="mt-1 text-sm text-muted">
            {captains.length} captain{captains.length !== 1 ? "s" : ""} • click a row to manage
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => loadCaptains()}
            className="rounded-lg border border-hairline-strong px-4 py-2 text-xs font-medium text-ink transition hover:bg-mist-navy/30"
          >
            ↻ Refresh
          </button>
          <button
            onClick={() => setShowAddForm((v) => !v)}
            className="rounded-lg bg-ink-navy px-4 py-2 text-xs font-semibold text-chalk-white transition hover:bg-tape"
          >
            {showAddForm ? "✕ Cancel" : "+ Add Captain"}
          </button>
        </div>
      </div>

      {/* Add captain form */}
      {showAddForm && (
        <AddCaptainForm
          onCreated={(newId) => {
            setShowAddForm(false);
            router.push(`/admin/users/style-captains/${newId}`);
          }}
          onCancel={() => setShowAddForm(false)}
        />
      )}

      {/* Search */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <input
          type="text"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          placeholder="Search by name or phone…"
          className="w-64 rounded-lg border border-hairline-strong bg-chalk-white px-3 py-1.5 text-xs text-ink placeholder:text-muted focus:border-ink-navy focus:outline-none"
        />
      </div>

      {/* Loading / Error */}
      {loading && (
        <div className="py-12 text-center text-muted">Loading captains…</div>
      )}
      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          Error: {error}
        </div>
      )}

      {/* Table */}
      {!loading && !error && (
        <>
          {filtered.length === 0 ? (
            <div className="py-16 text-center">
              <div className="text-sm text-muted">No style captains found.</div>
            </div>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-hairline bg-chalk-white">
              <table className="w-full min-w-[700px] text-left text-sm">
                <thead>
                  <tr className="border-b border-hairline bg-mist-navy/40 text-xs uppercase tracking-wide text-muted">
                    <th className="px-4 py-3 font-medium">Name</th>
                    <th className="px-4 py-3 font-medium">Phone</th>
                    <th className="px-4 py-3 font-medium">Email</th>
                    <th className="px-4 py-3 font-medium">Jobs</th>
                    <th className="px-4 py-3 font-medium">Joined</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((c) => (
                    <tr
                      key={c.id}
                      onClick={() =>
                        router.push(`/admin/users/style-captains/${c.id}`)
                      }
                      className="cursor-pointer border-b border-hairline transition hover:bg-mist-navy/30 last:border-0"
                    >
                      <td className="px-4 py-3">
                        <div className="text-[13px] font-medium text-ink-navy">
                          {c.name ?? "Unnamed"}
                        </div>
                        <div className="text-[11px] text-muted">
                          id: {truncateId(c.id)}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-[13px] text-ink">
                        {c.phone ?? "—"}
                      </td>
                      <td className="px-4 py-3 text-[13px] text-ink">
                        {c.email ?? "—"}
                      </td>
                      <td className="px-4 py-3">
                        <span className="inline-block rounded-pill bg-blue-100 px-2 py-0.5 text-[11px] font-medium text-blue-800">
                          {jobCounts[c.id] ?? 0} jobs
                        </span>
                      </td>
                      <td className="px-4 py-3 text-[12px] text-muted">
                        {formatDate(c.created_at)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ─── Add Captain Form ─────────────────────────────────────────────────────────

function AddCaptainForm({
  onCreated,
  onCancel,
}: {
  onCreated: (id: string) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [countryCode, setCountryCode] = useState("+91");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit() {
    if (!name.trim()) {
      setError("Name is required");
      return;
    }
    if (!phone.trim()) {
      setError("Phone is required");
      return;
    }
    if (!password.trim()) {
      setError("Password is required");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const created = await createCaptain({
        name: name.trim(),
        phone: phone.trim(),
        country_code: countryCode.trim() || "+91",
        password: password.trim(),
      });
      onCreated(created.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create captain");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mb-4 rounded-xl border border-hairline bg-chalk-white p-5">
      <h2 className="mb-4 font-heading text-lg font-semibold text-ink-navy">
        New Style Captain
      </h2>
      {error && (
        <div className="mb-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      )}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <div>
          <label className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-muted">
            Name *
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Enter name…"
            className="w-full rounded-lg border border-hairline-strong bg-chalk-white px-3 py-1.5 text-[13px] focus:border-ink-navy focus:outline-none"
          />
        </div>
        <div>
          <label className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-muted">
            Phone *
          </label>
          <input
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="10-digit mobile"
            className="w-full rounded-lg border border-hairline-strong bg-chalk-white px-3 py-1.5 text-[13px] focus:border-ink-navy focus:outline-none"
          />
        </div>
        <div>
          <label className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-muted">
            Email
          </label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="optional"
            className="w-full rounded-lg border border-hairline-strong bg-chalk-white px-3 py-1.5 text-[13px] focus:border-ink-navy focus:outline-none"
          />
        </div>
        <div>
          <label className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-muted">
            Country Code
          </label>
          <input
            type="text"
            value={countryCode}
            onChange={(e) => setCountryCode(e.target.value)}
            placeholder="+91"
            className="w-full rounded-lg border border-hairline-strong bg-chalk-white px-3 py-1.5 text-[13px] focus:border-ink-navy focus:outline-none"
          />
        </div>
        <div className="md:col-span-2">
          <label className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-muted">
            Password *
          </label>
          <input
            type="text"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Initial login password"
            className="w-full rounded-lg border border-hairline-strong bg-chalk-white px-3 py-1.5 text-[13px] focus:border-ink-navy focus:outline-none"
          />
          <p className="mt-1 text-[10px] text-muted">
            Stored as a bcrypt hash — the captain can log in with this password
            immediately.
          </p>
        </div>
      </div>
      <div className="mt-4 flex gap-2">
        <button
          onClick={handleSubmit}
          disabled={loading}
          className="rounded-lg bg-ink-navy px-4 py-1.5 text-xs font-semibold text-chalk-white transition hover:bg-tape disabled:opacity-50"
        >
          {loading ? "Creating…" : "Create Captain"}
        </button>
        <button
          onClick={onCancel}
          className="rounded-lg border border-hairline-strong px-4 py-1.5 text-xs font-medium text-ink hover:bg-mist-navy/30"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
