"use client";

/**
 * Style Captain detail — admin view.
 *
 * Sections:
 *   1. Editable profile (name, phone, email, country code)
 *   2. Assigned measurement jobs
 *   3. Schedule management (rules, exceptions, manual slots)
 *
 * Schedule management uses the generic admin table endpoints
 * (PUT/POST/DELETE /admin/tables/{table}) rather than the
 * /captain/schedule/* routes, which are scoped to the captain's own JWT.
 * The underlying tables are:
 *   - captain_schedule_rules
 *   - captain_schedule_exceptions
 *   - captain_manual_slots
 * All have a style_captain_id column we filter on.
 */

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  fetchTableRows,
  updateTableRow,
  createTableRow,
  deleteTableRow,
  patchCaptain,
  type UserRow,
  type MeasurementJobRow,
} from "@/lib/admin-api";
import { CaptainScheduleManager } from "@/components/admin/CaptainScheduleManager";

// ─── Constants ────────────────────────────────────────────────────────────────

const JOB_STATUS_STYLE: Record<string, string> = {
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

// ─── Profile field (controlled input, no auto-save) ──────────────────────────

function ProfileField({
  label,
  value,
  onChange,
  type = "text",
  placeholder,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: "text" | "email" | "tel";
  placeholder?: string;
  disabled?: boolean;
}) {
  return (
    <div>
      <label className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-muted">
        {label}
      </label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder ?? `Enter ${label.toLowerCase()}…`}
        disabled={disabled}
        className="w-full rounded-lg border border-hairline-strong bg-chalk-white px-3 py-1.5 text-[13px] text-ink focus:border-ink-navy focus:outline-none disabled:opacity-50"
      />
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function StyleCaptainDetailPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const captainId = params.id;

  const [captain, setCaptain] = useState<UserRow | null>(null);
  const [jobs, setJobs] = useState<MeasurementJobRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [savingProfile, setSavingProfile] = useState(false);

  // Local draft for profile fields — committed on Save click
  const [draftName, setDraftName] = useState("");
  const [draftPhone, setDraftPhone] = useState("");
  const [draftEmail, setDraftEmail] = useState("");
  const [draftCountryCode, setDraftCountryCode] = useState("");

  // ── Emit sidebar items ────────────────────────────────────────────────────
  useEffect(() => {
    window.dispatchEvent(
      new CustomEvent("admin-sidebar-update", {
        detail: {
          items: [
            {
              label: "← Back to Captains",
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

  // ── Flash auto-dismiss ────────────────────────────────────────────────────
  useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => setFlash(null), 3000);
    return () => clearTimeout(t);
  }, [flash]);

  // ── Load captain + jobs ────────────────────────────────────────────────────
  const loadAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { rows: capRows } = await fetchTableRows<UserRow>("users", {
        filters: { id: captainId },
        perPage: 1,
      });
      if (capRows.length === 0) {
        setError("Style captain not found");
        return;
      }
      setCaptain(capRows[0]);
      // Sync local drafts from server data
      setDraftName(capRows[0].name ?? "");
      setDraftPhone(capRows[0].phone ?? "");
      setDraftEmail(capRows[0].email ?? "");
      setDraftCountryCode(capRows[0].country_code ?? "");

      const { rows: jobRows } = await fetchTableRows<MeasurementJobRow>(
        "measurement_jobs",
        {
          filters: { style_captain_id: captainId },
          perPage: 100,
          sortColumn: "created_at",
          sortDirection: "desc",
        },
      ).catch(() => ({ rows: [] as MeasurementJobRow[], total: 0, columns: [] }));
      setJobs(jobRows);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load captain");
    } finally {
      setLoading(false);
    }
  }, [captainId]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  // ── Save all profile fields at once ──────────────────────────────────────
  async function handleSaveProfile() {
    if (!captain) return;
    setSavingProfile(true);
    try {
      const patch: Record<string, string | null> = {};
      if (draftName.trim() !== (captain.name ?? "")) patch.name = draftName.trim() === "" ? null : draftName.trim();
      if (draftPhone.trim() !== (captain.phone ?? "")) patch.phone = draftPhone.trim() === "" ? null : draftPhone.trim();
      if (draftEmail.trim() !== (captain.email ?? "")) patch.email = draftEmail.trim() === "" ? null : draftEmail.trim();
      if (draftCountryCode.trim() !== (captain.country_code ?? "")) patch.country_code = draftCountryCode.trim() === "" ? null : draftCountryCode.trim();

      if (Object.keys(patch).length === 0) {
        setFlash("No changes to save");
        return;
      }

      await updateTableRow("users", captain.id, patch);
      setCaptain({
        ...captain,
        ...patch,
      });
      setFlash("Captain details saved");
    } catch (e) {
      alert(e instanceof Error ? e.message : "Update failed");
    } finally {
      setSavingProfile(false);
    }
  }

  // ── Dirty check ──────────────────────────────────────────────────────────
  const isDirty =
    !!captain &&
    (draftName.trim() !== (captain.name ?? "") ||
      draftPhone.trim() !== (captain.phone ?? "") ||
      draftEmail.trim() !== (captain.email ?? "") ||
      draftCountryCode.trim() !== (captain.country_code ?? ""));

  // ── Loading / Error states ────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="mx-auto w-full max-w-5xl px-4 py-12 md:px-8">
        <div className="py-12 text-center text-muted">Loading captain…</div>
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
          onClick={() => router.push("/admin/users/style-captains")}
          className="mt-4 rounded-lg border border-hairline-strong px-4 py-2 text-xs font-medium text-ink hover:bg-mist-navy/30"
        >
          ← Back to Style Captains
        </button>
      </div>
    );
  }

  if (!captain) return null;

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6 md:px-8 md:py-8">
      {/* Breadcrumb */}
      <div className="mb-4 flex items-center gap-2 text-xs text-muted">
        <button
          onClick={() => router.push("/admin/users/style-captains")}
          className="hover:text-ink-navy hover:underline"
        >
          Style Captains
        </button>
        <span>/</span>
        <span className="text-ink">{captain.name ?? truncateId(captain.id)}</span>
      </div>

      {/* Flash */}
      {flash && (
        <div className="mb-4 rounded-lg border border-green-200 bg-green-50 px-4 py-2.5 text-sm text-green-800">
          {flash}
        </div>
      )}

      {/* Profile card */}
      <div className="mb-6 rounded-xl border border-hairline bg-chalk-white p-5">
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="font-heading text-2xl font-bold text-ink-navy">
              {captain.name ?? "Unnamed captain"}
            </h1>
            <div className="mt-1 text-xs text-muted">
              Joined {formatDate(captain.created_at)} • id: {truncateId(captain.id)}
            </div>
          </div>
          <span className="inline-block rounded-pill bg-blue-100 px-3 py-1 text-xs font-semibold text-blue-800">
            Style Captain
          </span>
        </div>

        {/* Editable fields */}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <ProfileField
            label="Name"
            value={draftName}
            onChange={setDraftName}
            placeholder="Enter name…"
            disabled={savingProfile}
          />
          <ProfileField
            label="Phone"
            type="tel"
            value={draftPhone}
            onChange={setDraftPhone}
            placeholder="Enter phone…"
            disabled={savingProfile}
          />
          <ProfileField
            label="Email"
            type="email"
            value={draftEmail}
            onChange={setDraftEmail}
            placeholder="Enter email…"
            disabled={savingProfile}
          />
          <ProfileField
            label="Country Code"
            value={draftCountryCode}
            onChange={setDraftCountryCode}
            placeholder="+91"
            disabled={savingProfile}
          />
        </div>

        {/* Save button */}
        <div className="mt-4 flex items-center gap-3 border-t border-hairline pt-4">
          <button
            onClick={handleSaveProfile}
            disabled={!isDirty || savingProfile}
            className="rounded-lg bg-ink-navy px-5 py-2 text-xs font-semibold text-chalk-white transition hover:bg-tape disabled:cursor-not-allowed disabled:opacity-40"
          >
            {savingProfile ? "Saving…" : "Save Changes"}
          </button>
          {isDirty && !savingProfile && (
            <span className="text-[11px] text-muted">Unsaved changes</span>
          )}
        </div>
      </div>

      {/* Set Password */}
      <SetPasswordSection captainId={captain.id} onSaved={setFlash} />

      {/* Assigned Jobs */}
      <section className="mb-6">
        <h2 className="mb-3 font-heading text-lg font-semibold text-ink-navy">
          Assigned Jobs ({jobs.length})
        </h2>
        {jobs.length === 0 ? (
          <div className="rounded-xl border border-hairline bg-chalk-white p-6 text-center text-sm text-muted">
            No measurement jobs assigned yet.
          </div>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-hairline bg-chalk-white">
            <table className="w-full min-w-[700px] text-left text-sm">
              <thead>
                <tr className="border-b border-hairline bg-mist-navy/40 text-xs uppercase tracking-wide text-muted">
                  <th className="px-4 py-3 font-medium">Job</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Scheduled</th>
                  <th className="px-4 py-3 font-medium">Customer</th>
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
                      {truncateId(job.user_id ?? "")}
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

      {/* Schedule management */}
      <CaptainScheduleManager captainId={captain.id} captainName={captain.name} />
    </div>
  );
}

// ─── Set Password Section ─────────────────────────────────────────────────────

function SetPasswordSection({
  captainId,
  onSaved,
}: {
  captainId: string;
  onSaved: (msg: string) => void;
}) {
  const [showForm, setShowForm] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setShowForm(false);
    setNewPassword("");
    setConfirmPassword("");
    setError(null);
  }

  async function handleSave() {
    if (!newPassword) {
      setError("Password cannot be empty");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("Passwords do not match");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await patchCaptain(captainId, { password: newPassword });
      onSaved("Password updated");
      reset();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to update password");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mb-6 rounded-xl border border-hairline bg-chalk-white p-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-heading text-lg font-semibold text-ink-navy">
            Login Password
          </h2>
          <p className="mt-0.5 text-xs text-muted">
            Used by the captain to sign in at the Style Captain dashboard.
          </p>
        </div>
        {!showForm && (
          <button
            onClick={() => setShowForm(true)}
            className="rounded-lg border border-hairline-strong px-4 py-2 text-xs font-medium text-ink hover:bg-mist-navy/30"
          >
            Change Password
          </button>
        )}
      </div>

      {showForm && (
        <div className="mt-4 border-t border-hairline pt-4">
          {error && (
            <div className="mb-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              {error}
            </div>
          )}
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div>
              <label className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-muted">
                New Password *
              </label>
              <input
                type="text"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="Enter new password…"
                disabled={saving}
                className="w-full rounded-lg border border-hairline-strong bg-chalk-white px-3 py-1.5 text-[13px] focus:border-ink-navy focus:outline-none disabled:opacity-50"
              />
            </div>
            <div>
              <label className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-muted">
                Confirm Password *
              </label>
              <input
                type="text"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Re-enter new password…"
                disabled={saving}
                className="w-full rounded-lg border border-hairline-strong bg-chalk-white px-3 py-1.5 text-[13px] focus:border-ink-navy focus:outline-none disabled:opacity-50"
              />
            </div>
          </div>
          <p className="mt-2 text-[10px] text-muted">
            Bcrypt-hashed server-side. The captain will need to log in again on
            all devices.
          </p>
          <div className="mt-3 flex gap-2">
            <button
              onClick={handleSave}
              disabled={saving || !newPassword || !confirmPassword}
              className="rounded-lg bg-ink-navy px-4 py-1.5 text-xs font-semibold text-chalk-white transition hover:bg-tape disabled:cursor-not-allowed disabled:opacity-40"
            >
              {saving ? "Saving…" : "Set New Password"}
            </button>
            <button
              onClick={reset}
              disabled={saving}
              className="rounded-lg border border-hairline-strong px-4 py-1.5 text-xs font-medium text-ink hover:bg-mist-navy/30 disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
