"use client";

/**
 * Configure → Serviceability Areas (master fence management).
 *
 * Manage the `service_areas` master list — the shapes that form the
 * company-level serviceability fence checked when a customer saves an
 * address (core/service_area.py: every active row's polygon is a served
 * region; if NO active polygon exists the built-in env fallback kicks in).
 *
 * Add (draw + name) / edit shape / rename / toggle active / remove.
 * Writes go through the generic admin table API — no dedicated endpoints.
 */

import { Suspense, useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  createTableRow,
  deleteTableRow,
  fetchTableRows,
  updateTableRow,
} from "@/lib/admin-api";
import { CoverageMapEditorModal as CoverageMapEditor } from "@/components/admin/CoverageMapEditorModal";
import type { Ring } from "@/components/admin/CoverageMapEditor";

// ─── Sub-tabs for Configure (shared) ───────────────────────────────────────────

const ACTION_TABS = [
  { key: "slot-scheduling", label: "Slot Scheduling", href: "/admin/actions/slot-scheduling" },
  { key: "serviceability", label: "Serviceability Areas", href: "/admin/actions/serviceability" },
  { key: "urls", label: "URLs", href: "/admin/actions/urls" },
  { key: "measurements", label: "Measurements", href: "/admin/measurements" },
  { key: "validation-rules", label: "Validation Rules", href: "/admin/catalogue/validation-rules" },
  { key: "sop-video", label: "SOP Video Generator", href: "/admin/actions/sop-video" },
] as const;

type ActionTabKey = (typeof ACTION_TABS)[number]["key"];

interface AreaRow {
  id: string;
  slug: string | null;
  labels: { en?: string } | null;
  city: string | null;
  polygon: Ring[] | Ring | null;
  is_active: boolean | null;
}

const areaName = (a: AreaRow) => a.labels?.en?.trim() || a.slug || a.id.slice(0, 8);
const ringCount = (p: AreaRow["polygon"]) =>
  Array.isArray(p) ? (Array.isArray(p[0]) ? p.length : 1) : 0;

const RANDOM_ALPHABET = "23456789abcdefghjkmnpqrstuvwxyz";
function randomSuffix(len = 5): string {
  return Array.from({ length: len }, () =>
    RANDOM_ALPHABET[Math.floor(Math.random() * RANDOM_ALPHABET.length)],
  ).join("");
}

export default function ServiceabilityActionPage() {
  return (
    <Suspense fallback={null}>
      <ServiceabilityActionPageInner />
    </Suspense>
  );
}

function ServiceabilityActionPageInner() {
  const router = useRouter();
  const [activeActionTab] = useState<ActionTabKey>("serviceability");

  const [areas, setAreas] = useState<AreaRow[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // editor state: null = closed; id null = creating a new area
  const [editor, setEditor] = useState<{
    areaId: string | null;
    name: string;
    city: string;
    shapes: Ring[];
  } | null>(null);
  const [saving, setSaving] = useState(false);

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
    return () => {
      window.dispatchEvent(new CustomEvent("admin-sidebar-update", { detail: null }));
    };
  }, [activeActionTab, router]);

  useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => setFlash(null), 3000);
    return () => clearTimeout(t);
  }, [flash]);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const { rows } = await fetchTableRows<AreaRow>("service_areas", {
        perPage: 100,
        sortColumn: "created_at",
        sortDirection: "asc",
      });
      setAreas(rows);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Failed to load areas");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // ── actions ────────────────────────────────────────────────────────────────
  const openAdd = () =>
    setEditor({ areaId: null, name: "", city: "Bengaluru", shapes: [] });

  const openEdit = (a: AreaRow) => {
    const poly = a.polygon;
    const shapes: Ring[] = Array.isArray(poly)
      ? Array.isArray(poly[0])
        ? (poly as Ring[])
        : [poly as Ring]
      : [];
    setEditor({
      areaId: a.id,
      name: a.labels?.en ?? "",
      city: a.city ?? "",
      shapes,
    });
  };

  const saveEditor = async (shapes: Ring[]) => {
    if (!editor) return;
    const name = editor.name.trim();
    if (!name) {
      alert("Give the area a name first.");
      return;
    }
    setSaving(true);
    try {
      if (editor.areaId) {
        await updateTableRow("service_areas", editor.areaId, {
          labels: { en: name },
          city: editor.city.trim() || null,
          polygon: shapes,
        });
        setFlash(`Area "${name}" updated`);
      } else {
        const slug = `${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "area"}-${randomSuffix()}`;
        await createTableRow("service_areas", {
          id: slug,
          slug,
          labels: { en: name },
          city: editor.city.trim() || "Bengaluru",
          polygon: shapes,
          is_active: true,
        });
        setFlash(`Area "${name}" added`);
      }
      setEditor(null);
      await load();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed to save area");
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (a: AreaRow) => {
    setBusy(true);
    try {
      await updateTableRow("service_areas", a.id, { is_active: !(a.is_active ?? true) });
      await load();
      setFlash(`"${areaName(a)}" ${a.is_active === false ? "activated" : "paused"}`);
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed to update area");
    } finally {
      setBusy(false);
    }
  };

  const removeArea = async (a: AreaRow) => {
    if (!window.confirm(`Remove "${areaName(a)}"?`)) return;
    setBusy(true);
    try {
      await deleteTableRow("service_areas", a.id);
      await load();
      setFlash(`Area "${areaName(a)}" removed`);
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed to remove area");
    } finally {
      setBusy(false);
    }
  };

  const activeCount = (areas ?? []).filter((a) => a.is_active !== false).length;

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-5">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">
          Configure
        </p>
        <h1 className="font-heading text-2xl font-bold text-ink-navy">
          Serviceability Areas
        </h1>
        <p className="mt-1 text-sm text-muted">
          The master boundary checked when a customer saves an address. Draw one
          or more shapes — every active shape is a served region.
          {activeCount === 0
            ? " Nothing active right now: the built-in default boundary is in force."
            : ` ${activeCount} active.`}
        </p>
      </div>

      {flash && (
        <div className="mb-4 rounded-lg border border-green-200 bg-green-50 px-4 py-2 text-sm font-medium text-green-800">
          {flash}
        </div>
      )}
      {loadError && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
          {loadError}
        </div>
      )}

      <div className="rounded-xl border border-hairline bg-chalk-white">
        <div className="flex items-center justify-between border-b border-hairline px-5 py-3">
          <span className="text-sm font-semibold text-ink-navy">
            Master areas ({areas?.length ?? 0})
          </span>
          <button
            onClick={openAdd}
            className="rounded-lg bg-ink-navy px-4 py-2 text-xs font-semibold text-chalk-white transition hover:bg-tape"
          >
            + Add area
          </button>
        </div>

        {areas === null ? (
          <div className="p-6 text-sm text-muted">Loading…</div>
        ) : areas.length === 0 ? (
          <div className="p-6 text-center text-sm text-muted">
            No master areas yet. Add one to define where customers can save
            addresses — otherwise the built-in default applies.
          </div>
        ) : (
          <ul className="divide-y divide-hairline">
            {areas.map((a) => {
              const active = a.is_active !== false;
              return (
                <li key={a.id} className="flex items-center gap-3 px-5 py-3.5">
                  <span
                    aria-hidden
                    className={`inline-block h-2.5 w-2.5 flex-none rounded-pill ${active ? "bg-green-500" : "bg-gray-300"}`}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-ink-navy">
                      {areaName(a)}
                      {!active && (
                        <span className="ml-2 rounded-pill bg-amber-100 px-2 py-0.5 text-[10px] font-semibold uppercase text-amber-800">
                          paused
                        </span>
                      )}
                    </p>
                    <p className="truncate text-[11px] text-muted">
                      {a.city ?? "—"} · {ringCount(a.polygon)} shape
                      {ringCount(a.polygon) === 1 ? "" : "s"}
                    </p>
                  </div>
                  <button
                    onClick={() => void toggleActive(a)}
                    disabled={busy}
                    className="flex-none rounded-lg border border-hairline-strong px-3 py-1.5 text-[11px] font-semibold text-ink-navy transition hover:bg-mist-navy/40 disabled:opacity-50"
                  >
                    {active ? "Pause" : "Activate"}
                  </button>
                  <button
                    onClick={() => openEdit(a)}
                    disabled={busy}
                    className="flex-none rounded-lg border border-hairline-strong px-3 py-1.5 text-[11px] font-semibold text-ink-navy transition hover:bg-mist-navy/40 disabled:opacity-50"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => void removeArea(a)}
                    disabled={busy}
                    className="flex-none rounded-lg border border-red-200 px-3 py-1.5 text-[11px] font-semibold text-red-600 transition hover:bg-red-50 disabled:opacity-50"
                  >
                    Remove
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {editor && (
        <CoverageMapEditor
          coverage={editor.shapes}
          saving={saving}
          captainName="master areas"
          title={editor.areaId ? `Edit area — ${editor.name || "Master area"}` : "Add master serviceability area"}
          subtitle="Click the map to drop points; hover the first point and click it to close the shape."
          maxShapes={8}
          name={editor.name}
          onNameChange={(v) => setEditor({ ...editor, name: v })}
          onClose={() => setEditor(null)}
          onSave={saveEditor}
        />
      )}
    </div>
  );
}
