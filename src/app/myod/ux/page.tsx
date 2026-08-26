"use client";

/**
 * /myod/ux — matrix-picker playground (dummy page, not wired into the flow).
 *
 * Fourteen candidate UXs for add-ons whose variations span a matrix of axes
 * (Where × Style / Shape × Size — Panel, Ruffle, Key Hole), all rendered from
 * the REAL blouse catalog via the same addonToStepComponent decomposition the
 * extras picker uses:
 *   A  Placement tabs + per-spot photo cards (+ tray, "same for all places")
 *   B  Live configurator — current chip flow + live combo photo + status
 *   C  Flat gallery + filters + multi-select cards
 *   D  Garment map — tap the blouse silhouette to pick the region
 *   E–N  Research round — guided wizard, smart-default presets, shoppable
 *        hotspots, whole-matrix grid, per-place rails, master–detail with
 *        availability-aware chips, swipe deck, sentence builder, summary-first
 *        expander, one-for-all + per-place overrides.
 *
 * Variation photos for these add-ons haven't been generated yet, so cells
 * without an asset render a semantic glyph (shape / size / style) instead of
 * the monogram fallback — enough to evaluate each flow.
 */

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { getGarmentTree, listGarments } from "@/lib/api/catalog";
import { addonToStepComponent } from "@/lib/myod-steps";
import type { StepComponent, StepOption } from "@/lib/myod-steps";
import { ArrowLeft } from "@/components/ui/icons";

// ─── small helpers ───────────────────────────────────────────────────────

const tc = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** "Left Sleeve · Round · Small" → "Round · Small" (pretty-cased). */
function tailOf(opt: StepOption): string {
  const tail = opt.label.split("·").slice(1).join("·").trim();
  return tail
    .split("·")
    .map((s) => tc(s.trim()))
    .join(" · ");
}

const whereOf = (o: StepOption) => o.axisValues?.where;

function placeShort(p: string): string {
  const l = p.toLowerCase();
  if (l.includes("sleeve")) {
    if (l.includes("left")) return "L.Sleeve";
    if (l.includes("right")) return "R.Sleeve";
    return "Sleeves";
  }
  return p;
}

/** Which part of the garment map a spot belongs to. */
function zoneOf(p: string): string {
  const l = p.toLowerCase();
  if (l.includes("sleeve")) {
    if (l.includes("left")) return "left-sleeve";
    if (l.includes("right")) return "right-sleeve";
    return "sleeve";
  }
  return l.includes("front") ? "front" : "back";
}

// ─── semantic glyph (stands in for not-yet-generated variation photos) ───

function Glyph({ opt }: { opt: StepOption }) {
  const v = opt.axisValues ?? {};
  const scale = v.size === "small" ? 0.62 : v.size === "medium" ? 0.8 : 1;
  const wrap = (children: React.ReactNode) => (
    <g
      transform={`translate(${24 * (1 - scale)} ${26 * (1 - scale)}) scale(${scale})`}
    >
      {children}
    </g>
  );
  let body: React.ReactNode = null;
  if (v.shape === "round") {
    body = wrap(<circle cx={24} cy={26} r={11} />);
  } else if (v.shape === "drop") {
    body = wrap(<path d="M24 13 C33 21 34 32 24 37 C14 32 15 21 24 13 Z" />);
  } else if (v.shape === "triangle") {
    body = wrap(<path d="M24 14 L35 37 L13 37 Z" />);
  } else if (v.shape === "bow") {
    body = wrap(
      <>
        <path d="M24 26 L36 15 L36 37 Z" />
        <path d="M24 26 L12 15 L12 37 Z" />
        <circle cx={24} cy={26} r={3} />
      </>,
    );
  } else if (v.style) {
    // Panel: torso outline + fold density
    const lines =
      v.style.toLowerCase() === "easy"
        ? 1
        : v.style.toLowerCase() === "medium"
          ? 3
          : 5;
    body = (
      <>
        <path d="M18 10 H30 L34 14 V40 H14 V14 Z" />
        {Array.from({ length: lines }, (_, i) => {
          const y = 22 + i * (14 / Math.max(lines - 1, 1));
          return <path key={i} d={`M16 ${y} H32`} />;
        })}
      </>
    );
  } else if (v.size) {
    // Ruffle: waves whose amplitude encodes the size
    const a = v.size === "small" ? 2.5 : v.size === "medium" ? 4.5 : 6.5;
    const wave = (y: number) => `M10 ${y} q4 ${-a} 8 0 t 8 0 t 8 0 t 8 0`;
    body = (
      <>
        <path d={wave(21)} />
        <path d={wave(31)} />
      </>
    );
  } else {
    body = (
      <text
        x={24}
        y={31}
        textAnchor="middle"
        fontSize={17}
        fontFamily="var(--font-heading, serif)"
        fill="currentColor"
        stroke="none"
      >
        {opt.label.charAt(0).toUpperCase()}
      </text>
    );
  }
  return (
    <svg
      viewBox="0 0 48 48"
      className="h-full w-full text-navy-interactive/60"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
    >
      {body}
    </svg>
  );
}

function Thumb({ opt, contain }: { opt: StepOption; contain?: boolean }) {
  if (opt.assetUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={opt.assetUrl}
        alt=""
        className={
          contain
            ? "max-h-full w-auto max-w-full object-contain"
            : "h-full w-full object-cover"
        }
      />
    );
  }
  return (
    <div
      className={
        contain
          ? "flex h-full items-center justify-center"
          : "flex h-full w-full items-center justify-center"
      }
    >
      <div className={contain ? "h-32 w-32" : "h-[78%] w-[78%]"}>
        <Glyph opt={opt} />
      </div>
    </div>
  );
}

// ─── shared bits ─────────────────────────────────────────────────────────

type Sel = Record<string, string>; // spot → option id

function selEntries(component: StepComponent, sel: Sel) {
  return Object.entries(sel)
    .map(([spot, id]) => {
      const o = component.options.find((x) => x.id === id);
      return o ? { spot, opt: o, key: `${spot}:${id}` } : null;
    })
    .filter((x): x is { spot: string; opt: StepOption; key: string } => !!x);
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="font-mono text-eyebrow font-medium uppercase tracking-[0.18em] text-accent-text">
      {children}
    </span>
  );
}

function Tray({
  entries,
  onRemove,
}: {
  entries: { spot: string; opt: StepOption; key: string }[];
  onRemove: (spot: string) => void;
}) {
  if (entries.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {entries.map(({ spot, opt, key }) => (
        <span
          key={key}
          className="flex items-center gap-1.5 rounded-full border border-hairline bg-mist-navy/60 px-2.5 py-1 text-[13px] font-medium text-ink-navy"
        >
          {placeShort(spot)} · {tailOf(opt)}
          <button
            type="button"
            aria-label={`Remove ${spot}`}
            onClick={() => onRemove(spot)}
            className="text-ink-navy/50 transition-opacity ease-brand active:opacity-60"
          >
            ✕
          </button>
        </span>
      ))}
    </div>
  );
}

function DoneBar({ count, onDone }: { count: number; onDone: () => void }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-[13px] text-ink-navy/60">
        {count === 0
          ? "Nothing selected yet"
          : `${count} place${count > 1 ? "s" : ""} configured`}
      </span>
      <button
        type="button"
        disabled={count === 0}
        onClick={onDone}
        className="rounded-full bg-tape px-6 py-2.5 text-body font-semibold text-chalk-white shadow-card transition-all ease-brand active:scale-[0.98] disabled:opacity-40"
      >
        Done
      </button>
    </div>
  );
}

function Result({ committed }: { committed: string[] | null }) {
  if (!committed) return null;
  return (
    <p className="rounded-card border border-hairline bg-warm-sand px-3 py-2 text-[13px] text-ink-navy">
      <span className="font-mono uppercase tracking-[0.14em] text-accent-text">
        Confirmed:
      </span>{" "}
      {committed.length ? committed.join("   ·   ") : "(nothing)"}
    </p>
  );
}

function SampleFrame({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-4 rounded-card border border-hairline bg-chalk-white p-4 shadow-card">
      <div className="flex items-center justify-between">
        <span className="font-heading text-h4 font-semibold text-ink-navy">
          {title}
        </span>
        <span className="rounded-full border border-hairline px-2 py-0.5 font-mono text-eyebrow uppercase tracking-[0.14em] text-ink-navy/50">
          Sample
        </span>
      </div>
      {children}
    </section>
  );
}

// ─── A · placement tabs + per-spot photo cards ───────────────────────────

function TabsCardsSample({ component }: { component: StepComponent }) {
  const spots = (component.axes ?? [])[0]?.values ?? [];
  const [tab, setTab] = useState(spots[0] ?? "");
  const [sel, setSel] = useState<Sel>({});
  const [committed, setCommitted] = useState<string[] | null>(null);

  const atTab = useMemo(
    () => component.options.filter((o) => whereOf(o) === tab),
    [component, tab],
  );
  const chosen = atTab.find((o) => o.id === sel[tab]);
  const entries = selEntries(component, sel);

  // Mirror the active tab's pick onto every spot that has the same combo.
  const sameEverywhere = () => {
    if (!chosen?.axisValues) return;
    const want = { ...chosen.axisValues };
    delete want.where;
    setSel((prev) => {
      const next = { ...prev };
      for (const s of spots) {
        const m = component.options.find(
          (o) =>
            whereOf(o) === s &&
            Object.entries(want).every(([k, val]) => o.axisValues?.[k] === val),
        );
        if (m) next[s] = m.id;
      }
      return next;
    });
  };

  return (
    <SampleFrame title={`${component.label} — tabs + cards`}>
      {/* live preview of the tab's current pick */}
      <div className="flex h-44 items-center justify-center rounded-card bg-mist-navy px-3">
        {chosen ? (
          <Thumb opt={chosen} contain />
        ) : (
          <span className="text-[13px] text-ink-navy/50">
            Pick a card below…
          </span>
        )}
      </div>

      {/* placement tabs */}
      <div className="flex flex-wrap gap-1.5">
        {spots.map((s) => {
          const opt = component.options.find((o) => o.id === sel[s]);
          const isTab = s === tab;
          return (
            <button
              key={s}
              type="button"
              onClick={() => setTab(s)}
              className={
                "flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[13px] font-medium transition-all ease-brand active:scale-[0.97] " +
                (isTab
                  ? "bg-tape text-chalk-white"
                  : opt
                    ? "border border-accent-text/50 bg-chalk-white text-ink-navy"
                    : "border border-hairline bg-chalk-white text-ink-navy/70")
              }
            >
              {placeShort(s)}
              {opt && (
                <span className={isTab ? "opacity-80" : "text-accent-text"}>
                  ✓ {tailOf(opt)}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* the tab's real variations as cards — every card exists in the catalog */}
      <div className="grid grid-cols-3 gap-2">
        {atTab.map((o) => {
          const isSel = sel[tab] === o.id;
          return (
            <button
              key={o.id}
              type="button"
              onClick={() => setSel((p) => ({ ...p, [tab]: o.id }))}
              className={
                "flex flex-col gap-1.5 rounded-card border p-2 transition-all ease-brand active:scale-[0.98] " +
                (isSel
                  ? "border-accent-text/70 bg-mist-navy/50 shadow-card"
                  : "border-hairline bg-chalk-white")
              }
            >
              <div className="aspect-square overflow-hidden rounded-card bg-mist-navy">
                <Thumb opt={o} />
              </div>
              <span className="text-center text-[12px] font-semibold leading-tight text-ink-navy">
                {tailOf(o)}
              </span>
            </button>
          );
        })}
      </div>

      {entries.length > 1 && (
        <button
          type="button"
          onClick={sameEverywhere}
          className="self-start rounded-full border border-hairline px-3.5 py-1.5 text-[13px] font-medium text-ink-navy transition-all ease-brand active:scale-[0.97]"
        >
          Apply {placeShort(tab)}&rsquo;s pick to all places
        </button>
      )}

      <Tray
        entries={entries}
        onRemove={(spot) =>
          setSel((p) => {
            const n = { ...p };
            delete n[spot];
            return n;
          })
        }
      />
      <DoneBar
        count={entries.length}
        onDone={() =>
          setCommitted(
            entries.map(
              ({ spot, opt }) => `${placeShort(spot)} · ${tailOf(opt)}`,
            ),
          )
        }
      />
      <Result committed={committed} />
    </SampleFrame>
  );
}

// ─── B · live configurator (current flow, upgraded) ──────────────────────

function ConfiguratorSample({ component }: { component: StepComponent }) {
  const axes = component.axes ?? [];
  const spots = axes[0]?.values ?? [];
  const fieldAxes = axes.filter((a) => a.key !== "where");
  const [active, setActive] = useState(spots[0] ?? "");
  // spot → axis → chosen raw value; a spot is "configured" once it has a draft
  const [draft, setDraft] = useState<Record<string, Record<string, string>>>(
    {},
  );
  const [committed, setCommitted] = useState<string[] | null>(null);

  const firstAt = (spot: string) =>
    component.options.find((o) => whereOf(o) === spot);

  // Resolve a spot's chip combo to a real variation — null = dead end (this
  // is the sparse-matrix pain point this variant keeps).
  const resolve = (spot: string): StepOption | undefined => {
    const d = draft[spot];
    if (!d) return undefined;
    return component.options.find(
      (o) =>
        whereOf(o) === spot &&
        fieldAxes.every((a) => o.axisValues?.[a.key] === d[a.key]),
    );
  };

  const ensureDraft = (spot: string) => {
    if (draft[spot]) return;
    const seed = firstAt(spot);
    if (!seed?.axisValues) return;
    const d: Record<string, string> = {};
    for (const a of fieldAxes) d[a.key] = seed.axisValues[a.key]!;
    setDraft((p) => ({ ...p, [spot]: d }));
  };

  const entries = Object.keys(draft)
    .map((spot) => {
      const opt = resolve(spot);
      return opt ? { spot, opt, key: `${spot}:${opt.id}` } : null;
    })
    .filter((x): x is { spot: string; opt: StepOption; key: string } => !!x);

  const activeOpt = resolve(active);
  const applyAll = () => {
    const d = draft[active];
    if (!d) return;
    setDraft((p) => {
      const next = { ...p };
      for (const s of spots) next[s] = { ...d };
      return next;
    });
  };

  return (
    <SampleFrame title={`${component.label} — live configurator`}>
      {/* big live preview of the combo being assembled */}
      <div className="flex h-44 items-center justify-center rounded-card bg-mist-navy px-3">
        {activeOpt ? (
          <Thumb opt={activeOpt} contain />
        ) : (
          <span className="text-[13px] text-ink-navy/50">
            {draft[active]
              ? "✕ That combination doesn&rsquo;t exist"
              : "Tap a place to start"}
          </span>
        )}
      </div>

      {/* where chips with status */}
      <div className="flex flex-wrap gap-1.5">
        {spots.map((s) => {
          const opt = resolve(s);
          const isActive = s === active;
          const has = !!draft[s];
          return (
            <button
              key={s}
              type="button"
              onClick={() => {
                setActive(s);
                ensureDraft(s);
              }}
              className={
                "flex flex-col items-start rounded-card border px-3 py-1.5 text-left transition-all ease-brand active:scale-[0.97] " +
                (isActive
                  ? "border-accent-text/70 bg-mist-navy/50"
                  : has
                    ? "border-accent-text/40 bg-chalk-white"
                    : "border-hairline bg-chalk-white")
              }
            >
              <span className="text-[13px] font-semibold text-ink-navy">
                {placeShort(s)}{" "}
                {opt && <span className="text-accent-text">✓</span>}
              </span>
              <span className="text-[11px] text-ink-navy/60">
                {opt ? tailOf(opt) : has ? "unavailable combo" : "not set"}
              </span>
            </button>
          );
        })}
      </div>

      {/* per-spot axis chips */}
      {Object.keys(draft).map((spot) => (
        <div
          key={spot}
          className="flex flex-col gap-2 rounded-card border border-hairline p-3"
        >
          <div className="flex items-center justify-between">
            <SectionLabel>{placeShort(spot)}</SectionLabel>
            <button
              type="button"
              onClick={() =>
                setDraft((p) => {
                  const n = { ...p };
                  delete n[spot];
                  return n;
                })
              }
              className="text-[12px] text-ink-navy/50 transition-opacity ease-brand active:opacity-60"
            >
              remove
            </button>
          </div>
          {fieldAxes.map((a) => (
            <div key={a.key} className="flex flex-wrap items-center gap-1.5">
              <span className="w-12 font-mono text-eyebrow uppercase tracking-[0.12em] text-ink-navy/50">
                {a.label}
              </span>
              {a.values.map((val) => {
                const isOn = draft[spot]?.[a.key] === val;
                return (
                  <button
                    key={val}
                    type="button"
                    onClick={() =>
                      setDraft((p) => ({
                        ...p,
                        [spot]: { ...p[spot], [a.key]: val },
                      }))
                    }
                    className={
                      "rounded-full px-2.5 py-1 text-[12px] font-medium transition-all ease-brand active:scale-[0.96] " +
                      (isOn
                        ? "bg-tape text-chalk-white"
                        : "border border-hairline bg-chalk-white text-ink-navy")
                    }
                  >
                    {tc(val)}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      ))}

      {draft[active] && Object.keys(draft).length > 1 && (
        <button
          type="button"
          onClick={applyAll}
          className="self-start rounded-full border border-hairline px-3.5 py-1.5 text-[13px] font-medium text-ink-navy transition-all ease-brand active:scale-[0.97]"
        >
          Apply {placeShort(active)}&rsquo;s setup to all places
        </button>
      )}

      <DoneBar
        count={entries.length}
        onDone={() =>
          setCommitted(
            entries.map(
              ({ spot, opt }) => `${placeShort(spot)} · ${tailOf(opt)}`,
            ),
          )
        }
      />
      <Result committed={committed} />
    </SampleFrame>
  );
}

// ─── C · flat gallery + filters ──────────────────────────────────────────

function GallerySample({ component }: { component: StepComponent }) {
  const axes = component.axes ?? [];
  const spots = axes[0]?.values ?? [];
  const fieldAxes = axes.filter((a) => a.key !== "where");
  const [placeOn, setPlaceOn] = useState<string[]>([]); // empty = all
  const [axisFilter, setAxisFilter] = useState<Record<string, string>>({});
  const [sel, setSel] = useState<Sel>({});
  const [committed, setCommitted] = useState<string[] | null>(null);

  const filtered = useMemo(
    () =>
      component.options.filter(
        (o) =>
          (placeOn.length === 0 || placeOn.includes(whereOf(o) ?? "")) &&
          fieldAxes.every(
            (a) =>
              !axisFilter[a.key] || o.axisValues?.[a.key] === axisFilter[a.key],
          ),
      ),
    [component, placeOn, axisFilter, fieldAxes],
  );

  const entries = selEntries(component, sel);

  return (
    <SampleFrame title={`${component.label} — gallery + filters`}>
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="w-12 font-mono text-eyebrow uppercase tracking-[0.12em] text-ink-navy/50">
            Place
          </span>
          {spots.map((s) => {
            const isOn = placeOn.includes(s);
            return (
              <button
                key={s}
                type="button"
                onClick={() =>
                  setPlaceOn((p) =>
                    p.includes(s) ? p.filter((x) => x !== s) : [...p, s],
                  )
                }
                className={
                  "rounded-full px-2.5 py-1 text-[12px] font-medium transition-all ease-brand active:scale-[0.96] " +
                  (isOn
                    ? "bg-tape text-chalk-white"
                    : "border border-hairline bg-chalk-white text-ink-navy")
                }
              >
                {placeShort(s)}
              </button>
            );
          })}
        </div>
        {fieldAxes.map((a) => (
          <div key={a.key} className="flex flex-wrap items-center gap-1.5">
            <span className="w-12 font-mono text-eyebrow uppercase tracking-[0.12em] text-ink-navy/50">
              {a.label}
            </span>
            <button
              type="button"
              onClick={() => setAxisFilter((p) => ({ ...p, [a.key]: "" }))}
              className={
                "rounded-full px-2.5 py-1 text-[12px] font-medium transition-all ease-brand active:scale-[0.96] " +
                (!axisFilter[a.key]
                  ? "bg-tape text-chalk-white"
                  : "border border-hairline bg-chalk-white text-ink-navy")
              }
            >
              Any
            </button>
            {a.values.map((val) => {
              const isOn = axisFilter[a.key] === val;
              return (
                <button
                  key={val}
                  type="button"
                  onClick={() => setAxisFilter((p) => ({ ...p, [a.key]: val }))}
                  className={
                    "rounded-full px-2.5 py-1 text-[12px] font-medium transition-all ease-brand active:scale-[0.96] " +
                    (isOn
                      ? "bg-tape text-chalk-white"
                      : "border border-hairline bg-chalk-white text-ink-navy")
                  }
                >
                  {tc(val)}
                </button>
              );
            })}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-3 gap-2">
        {filtered.map((o) => {
          const spot = whereOf(o) ?? "";
          const isSel = sel[spot] === o.id;
          return (
            <button
              key={o.id}
              type="button"
              onClick={() =>
                setSel((p) => {
                  const n = { ...p };
                  if (n[spot] === o.id) delete n[spot];
                  else n[spot] = o.id;
                  return n;
                })
              }
              className={
                "relative flex flex-col gap-1.5 rounded-card border p-2 transition-all ease-brand active:scale-[0.98] " +
                (isSel
                  ? "border-accent-text/70 bg-mist-navy/50 shadow-card"
                  : "border-hairline bg-chalk-white")
              }
            >
              <div className="aspect-square overflow-hidden rounded-card bg-mist-navy">
                <Thumb opt={o} />
              </div>
              <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-ink-navy/50">
                {placeShort(spot)}
              </span>
              <span className="text-center text-[12px] font-semibold leading-tight text-ink-navy">
                {tailOf(o)}
              </span>
              {isSel && (
                <span className="absolute right-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-tape text-[11px] text-chalk-white">
                  ✓
                </span>
              )}
            </button>
          );
        })}
      </div>
      <p className="text-[12px] text-ink-navy/50">
        {filtered.length} of {component.options.length} variations shown — the
        scroll is the point.
      </p>

      <Tray
        entries={entries}
        onRemove={(spot) =>
          setSel((p) => {
            const n = { ...p };
            delete n[spot];
            return n;
          })
        }
      />
      <DoneBar
        count={entries.length}
        onDone={() =>
          setCommitted(
            entries.map(
              ({ spot, opt }) => `${placeShort(spot)} · ${tailOf(opt)}`,
            ),
          )
        }
      />
      <Result committed={committed} />
    </SampleFrame>
  );
}

// ─── D · garment map ─────────────────────────────────────────────────────

function MapSample({ component }: { component: StepComponent }) {
  const spots = useMemo(
    () => component.axes?.[0]?.values ?? [],
    [component.axes],
  );
  const zones = useMemo(() => Array.from(new Set(spots.map(zoneOf))), [spots]);
  const [view, setView] = useState<"front" | "back">("front");
  const [activeZone, setActiveZone] = useState<string | null>(zones[0] ?? null);
  const [sel, setSel] = useState<Sel>({});
  const [committed, setCommitted] = useState<string[] | null>(null);

  const zoneSpots = (z: string) => spots.filter((s) => zoneOf(s) === z);
  const zoneHas = (z: string) => zoneSpots(z).some((s) => sel[s]);
  const zoneShort = (z: string) =>
    z === "front"
      ? "Front"
      : z === "back"
        ? "Back"
        : z === "left-sleeve"
          ? "Left sleeve"
          : z === "right-sleeve"
            ? "Right sleeve"
            : "Sleeves";

  const activeSpots = activeZone ? zoneSpots(activeZone) : [];
  const activeOptions = component.options.filter((o) =>
    activeSpots.includes(whereOf(o) ?? ""),
  );
  const entries = selEntries(component, sel);

  return (
    <SampleFrame title={`${component.label} — garment map`}>
      {/* front/back flip */}
      <div className="flex justify-center gap-1.5">
        {(["front", "back"] as const).map((v) => (
          <button
            key={v}
            type="button"
            onClick={() => {
              setView(v);
              if (zones.includes(v)) setActiveZone(v);
            }}
            className={
              "rounded-full px-4 py-1 text-[12px] font-semibold uppercase tracking-[0.12em] transition-all ease-brand " +
              (view === v
                ? "bg-ink-navy text-chalk-white"
                : "border border-hairline bg-chalk-white text-ink-navy")
            }
          >
            {v}
          </button>
        ))}
      </div>

      {/* the blouse itself */}
      <div className="relative mx-auto h-60 w-52">
        <svg
          viewBox="0 0 96 112"
          className="absolute inset-0 h-full w-full text-navy-interactive/30"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.4}
        >
          <path d="M34 8 C38 4 58 4 62 8 L78 14 L92 34 L80 44 L71 34 L71 100 Q48 107 25 100 L25 34 L16 44 L4 34 L18 14 Z" />
        </svg>
        {/* torso zone (front or back depending on view) */}
        <button
          type="button"
          onClick={() => {
            if (zones.includes(view)) setActiveZone(view);
          }}
          className={
            "absolute left-[27%] right-[27%] top-[16%] bottom-[8%] flex flex-col items-center justify-center gap-1 rounded-card border-2 border-dashed text-[12px] font-semibold uppercase tracking-[0.12em] transition-all ease-brand " +
            (activeZone === view
              ? "border-accent-text bg-mist-navy/60 text-ink-navy"
              : zoneHas(view)
                ? "border-accent-text/60 text-ink-navy"
                : "border-ink-navy/25 text-ink-navy/40")
          }
        >
          {view}
          {zoneHas(view) && <span className="text-accent-text">✓</span>}
        </button>
        {/* sleeve zones */}
        {(["left-sleeve", "right-sleeve"] as const).map((z) =>
          zones.includes(z) ? (
            <button
              key={z}
              type="button"
              onClick={() => setActiveZone(z)}
              className={
                (z === "left-sleeve" ? "left-[2%] " : "right-[2%] ") +
                "absolute top-[12%] h-[32%] w-[22%] flex flex-col items-center justify-center gap-1 rounded-card border-2 border-dashed text-[10px] font-semibold uppercase tracking-[0.1em] transition-all ease-brand " +
                (activeZone === z
                  ? "border-accent-text bg-mist-navy/60 text-ink-navy"
                  : zoneHas(z)
                    ? "border-accent-text/60 text-ink-navy"
                    : "border-ink-navy/25 text-ink-navy/40")
              }
            >
              {z === "left-sleeve" ? "L" : "R"}
              {zoneHas(z) && <span className="text-accent-text">✓</span>}
            </button>
          ) : null,
        )}
      </div>
      <p className="text-center text-[12px] text-ink-navy/50">
        {activeZone
          ? `Pick the ${zoneShort(activeZone).toLowerCase()} options ↓`
          : "Tap a region"}
      </p>

      {/* active region's variations */}
      {activeZone && (
        <div className="grid grid-cols-3 gap-2">
          {activeOptions.map((o) => {
            const spot = whereOf(o) ?? "";
            const isSel = sel[spot] === o.id;
            return (
              <button
                key={o.id}
                type="button"
                onClick={() => setSel((p) => ({ ...p, [spot]: o.id }))}
                className={
                  "flex flex-col gap-1.5 rounded-card border p-2 transition-all ease-brand active:scale-[0.98] " +
                  (isSel
                    ? "border-accent-text/70 bg-mist-navy/50 shadow-card"
                    : "border-hairline bg-chalk-white")
                }
              >
                <div className="aspect-square overflow-hidden rounded-card bg-mist-navy">
                  <Thumb opt={o} />
                </div>
                <span className="text-center text-[12px] font-semibold leading-tight text-ink-navy">
                  {tailOf(o)}
                </span>
              </button>
            );
          })}
        </div>
      )}

      <Tray
        entries={entries}
        onRemove={(spot) =>
          setSel((p) => {
            const n = { ...p };
            delete n[spot];
            return n;
          })
        }
      />
      <DoneBar
        count={entries.length}
        onDone={() =>
          setCommitted(
            entries.map(
              ({ spot, opt }) => `${placeShort(spot)} · ${tailOf(opt)}`,
            ),
          )
        }
      />
      <Result committed={committed} />
    </SampleFrame>
  );
}

// ─── helpers shared by the research round (E–N) ──────────────────────────

type SetSel = React.Dispatch<React.SetStateAction<Sel>>;

function dropSpot(setSel: SetSel, spot: string) {
  setSel((p) => {
    const n = { ...p };
    delete n[spot];
    return n;
  });
}

const commitLines = (entries: { spot: string; opt: StepOption }[]) =>
  entries.map(({ spot, opt }) => `${placeShort(spot)} · ${tailOf(opt)}`);

/** Spots + non-placement axes of a matrix add-on. */
function matrixOf(component: StepComponent) {
  const axes = component.axes ?? [];
  const spots = axes[0]?.values ?? [];
  const fieldAxes = axes.filter((a) => a.key !== "where");
  return { spots, fieldAxes };
}

const pillCls = (on: boolean) =>
  "rounded-full px-2.5 py-1 text-[12px] font-medium transition-all ease-brand active:scale-[0.96] " +
  (on
    ? "bg-tape text-chalk-white"
    : "border border-hairline bg-chalk-white text-ink-navy");

const tileCls = (on: boolean) =>
  "flex flex-col gap-1.5 rounded-card border p-2 transition-all ease-brand active:scale-[0.98] " +
  (on
    ? "border-accent-text/70 bg-mist-navy/50 shadow-card"
    : "border-hairline bg-chalk-white");

// ─── E · guided wizard (progressive disclosure / guided selling) ──────────

function WizardSample({ component }: { component: StepComponent }) {
  const { spots } = matrixOf(component);
  const [places, setPlaces] = useState<string[]>([]);
  const [step, setStep] = useState(0); // 0 = where, 1..n = each place, then review
  const [sel, setSel] = useState<Sel>({});
  const [committed, setCommitted] = useState<string[] | null>(null);

  const current = step === 0 ? null : (places[step - 1] ?? null);
  const isReview = step > places.length;
  const entries = selEntries(component, sel);

  const togglePlace = (s: string) =>
    setPlaces((p) => (p.includes(s) ? p.filter((x) => x !== s) : [...p, s]));

  return (
    <SampleFrame title={`${component.label} — guided wizard`}>
      {/* progress: one segment per question + review */}
      <div className="flex items-center gap-1.5">
        {["where", ...places].map((s, i) => (
          <span
            key={s}
            className={
              "h-1.5 flex-1 rounded-full transition-colors ease-brand " +
              (i < step ? "bg-tape" : "bg-mist-navy")
            }
          />
        ))}
        <span
          className={
            "h-1.5 w-6 rounded-full transition-colors ease-brand " +
            (isReview ? "bg-tape" : "bg-mist-navy")
          }
        />
      </div>

      {step === 0 && (
        <div className="flex flex-col gap-3">
          <p className="text-body font-semibold text-ink-navy">
            Where should the {component.label.toLowerCase()} go?
          </p>
          <div className="flex flex-wrap gap-1.5">
            {spots.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => togglePlace(s)}
                className={pillCls(places.includes(s))}
              >
                {placeShort(s)}
              </button>
            ))}
          </div>
          <button
            type="button"
            disabled={places.length === 0}
            onClick={() => setStep(1)}
            className="self-start rounded-full bg-tape px-6 py-2.5 text-body font-semibold text-chalk-white shadow-card transition-all ease-brand active:scale-[0.98] disabled:opacity-40"
          >
            Next
          </button>
        </div>
      )}

      {current && (
        <div className="flex flex-col gap-3">
          <div className="flex items-baseline justify-between">
            <p className="text-body font-semibold text-ink-navy">
              Pick the {placeShort(current)} look
            </p>
            <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-ink-navy/50">
              {step} / {places.length}
            </span>
          </div>
          <div className="grid grid-cols-3 gap-2">
            {component.options
              .filter((o) => whereOf(o) === current)
              .map((o) => (
                <button
                  key={o.id}
                  type="button"
                  onClick={() => {
                    setSel((p) => ({ ...p, [current]: o.id }));
                    setStep((s) => s + 1);
                  }}
                  className={tileCls(sel[current] === o.id)}
                >
                  <div className="aspect-square overflow-hidden rounded-card bg-mist-navy">
                    <Thumb opt={o} />
                  </div>
                  <span className="text-center text-[12px] font-semibold leading-tight text-ink-navy">
                    {tailOf(o)}
                  </span>
                </button>
              ))}
          </div>
          <button
            type="button"
            onClick={() => setStep((s) => Math.max(0, s - 1))}
            className="self-start text-[13px] font-medium text-ink-navy/60 transition-opacity ease-brand active:opacity-60"
          >
            ← Back
          </button>
        </div>
      )}

      {isReview && (
        <div className="flex flex-col gap-3">
          <p className="text-body font-semibold text-ink-navy">Review</p>
          <Tray entries={entries} onRemove={(s) => dropSpot(setSel, s)} />
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setStep(places.length)}
              className="rounded-full border border-hairline px-3.5 py-1.5 text-[13px] font-medium text-ink-navy transition-all ease-brand active:scale-[0.97]"
            >
              ← Back
            </button>
            <button
              type="button"
              onClick={() => {
                setStep(0);
                setPlaces([]);
                setSel({});
              }}
              className="rounded-full border border-hairline px-3.5 py-1.5 text-[13px] font-medium text-ink-navy transition-all ease-brand active:scale-[0.97]"
            >
              Start over
            </button>
          </div>
          <DoneBar
            count={entries.length}
            onDone={() => setCommitted(commitLines(entries))}
          />
        </div>
      )}
      <Result committed={committed} />
    </SampleFrame>
  );
}

// ─── F · curated presets (smart defaults) ────────────────────────────────

type Preset = {
  id: string;
  name: string;
  blurb: string;
  rep?: StepOption;
  sel: Sel;
};

function PresetsSample({ component }: { component: StepComponent }) {
  const [sel, setSel] = useState<Sel>({});
  const [presetId, setPresetId] = useState<string | null>(null);
  const [committed, setCommitted] = useState<string[] | null>(null);

  const { spots } = matrixOf(component);

  // "Everywhere · <look>" for each value of the first field axis, plus a
  // single-statement-spot recipe — all snapped to real catalog combos.
  const presets = useMemo<Preset[]>(() => {
    const { spots: sp, fieldAxes } = matrixOf(component);
    const out: Preset[] = [];
    const a1 = fieldAxes[0];
    if (!a1) return out;
    // With 2+ field axes, pin the last axis to its middle value so each
    // "look" recipe resolves; with a single axis the pin would contradict
    // the look itself, so leave it free.
    const last = fieldAxes.length > 1 ? fieldAxes[fieldAxes.length - 1] : null;
    const midOf = (vals: string[]) =>
      vals.includes("medium")
        ? "medium"
        : vals[Math.floor((vals.length - 1) / 2)];
    const midV = last ? midOf(last.values) : null;
    for (const v of a1.values) {
      const s: Sel = {};
      for (const spot of sp) {
        const m = component.options.find(
          (o) =>
            whereOf(o) === spot &&
            o.axisValues?.[a1.key] === v &&
            (midV === null || o.axisValues?.[last!.key] === midV),
        );
        if (m) s[spot] = m.id;
      }
      const rep = component.options.find((o) => o.axisValues?.[a1.key] === v);
      if (rep && Object.keys(s).length > 0)
        out.push({
          id: `all-${v}`,
          name: `Everywhere · ${tc(v)}`,
          blurb: `${Object.keys(s).length} places`,
          rep,
          sel: s,
        });
    }
    const repSpot = sp.find((s) => s.toLowerCase() === "back") ?? sp[0];
    const solo = component.options.find((o) => whereOf(o) === repSpot);
    if (solo)
      out.push({
        id: "solo-back",
        name: `Just the ${placeShort(repSpot)}`,
        blurb: "one statement spot",
        rep: solo,
        sel: { [repSpot]: solo.id },
      });
    return out;
  }, [component]);

  const entries = selEntries(component, sel);

  return (
    <SampleFrame title={`${component.label} — presets`}>
      <p className="text-[12px] leading-relaxed text-ink-navy/50">
        Smart defaults: a handful of named recipes instead of a wall of choices.
        Tap one and the whole matrix resolves; edit after if needed.
      </p>
      <div className="grid grid-cols-2 gap-2">
        {presets.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => {
              setSel(p.sel);
              setPresetId(p.id);
            }}
            className={tileCls(presetId === p.id)}
          >
            <div className="flex items-center gap-2">
              <div className="h-12 w-12 flex-none overflow-hidden rounded-card bg-mist-navy">
                {p.rep && <Thumb opt={p.rep} />}
              </div>
              <div className="flex min-w-0 flex-col">
                <span className="truncate text-[13px] font-semibold text-ink-navy">
                  {p.name}
                </span>
                <span className="text-[11px] text-ink-navy/60">{p.blurb}</span>
              </div>
            </div>
          </button>
        ))}
      </div>
      <Tray
        entries={entries}
        onRemove={(s) => {
          dropSpot(setSel, s);
          setPresetId(null);
        }}
      />
      <DoneBar
        count={entries.length}
        onDone={() => setCommitted(commitLines(entries))}
      />
      <Result committed={committed} />
    </SampleFrame>
  );
}

// ─── G · shoppable hotspots ──────────────────────────────────────────────

function HotspotsSample({ component }: { component: StepComponent }) {
  const { spots } = matrixOf(component);
  const zones = useMemo(() => Array.from(new Set(spots.map(zoneOf))), [spots]);
  const [view, setView] = useState<"front" | "back">("front");
  const [openSpot, setOpenSpot] = useState<string | null>(spots[0] ?? null);
  const [sel, setSel] = useState<Sel>({});
  const [committed, setCommitted] = useState<string[] | null>(null);

  const dotPos: Record<string, string> = {
    front: "left-1/2 top-[40%] -translate-x-1/2",
    back: "left-1/2 top-[40%] -translate-x-1/2",
    "left-sleeve": "left-[9%] top-[22%]",
    "right-sleeve": "right-[9%] top-[22%]",
    sleeve: "left-1/2 top-[14%] -translate-x-1/2",
  };
  const entries = selEntries(component, sel);

  return (
    <SampleFrame title={`${component.label} — hotspots`}>
      <div className="flex justify-center gap-1.5">
        {(["front", "back"] as const).map((v) => (
          <button
            key={v}
            type="button"
            onClick={() => setView(v)}
            className={
              "rounded-full px-4 py-1 text-[12px] font-semibold uppercase tracking-[0.12em] transition-all ease-brand " +
              (view === v
                ? "bg-ink-navy text-chalk-white"
                : "border border-hairline bg-chalk-white text-ink-navy")
            }
          >
            {v}
          </button>
        ))}
      </div>

      {/* garment + small "+" dots (shoppable-image pattern) */}
      <div className="relative mx-auto h-56 w-48">
        <svg
          viewBox="0 0 96 112"
          className="absolute inset-0 h-full w-full text-navy-interactive/30"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.4}
        >
          <path d="M34 8 C38 4 58 4 62 8 L78 14 L92 34 L80 44 L71 34 L71 100 Q48 107 25 100 L25 34 L16 44 L4 34 L18 14 Z" />
        </svg>
        {zones.map((z) => {
          const spot = spots.find((s) => zoneOf(s) === z);
          if (!spot || dotPos[z] === undefined) return null;
          // torso dot swaps with the view; sleeve dots show on both sides
          if ((z === "front" || z === "back") && z !== view) return null;
          const isSet = !!sel[spot];
          const isOpen = openSpot === spot;
          return (
            <button
              key={z}
              type="button"
              onClick={() => setOpenSpot(spot)}
              className={
                "absolute flex h-7 w-7 items-center justify-center rounded-full border-2 text-[11px] font-bold shadow-card transition-all ease-brand " +
                dotPos[z] +
                " " +
                (isOpen
                  ? "scale-110 border-accent-text bg-ink-navy text-chalk-white"
                  : isSet
                    ? "border-accent-text bg-tape text-chalk-white"
                    : "border-ink-navy/30 bg-chalk-white text-ink-navy")
              }
            >
              {isSet ? "✓" : "+"}
            </button>
          );
        })}
      </div>
      <p className="text-center text-[12px] text-ink-navy/50">
        {openSpot
          ? `Pick the ${placeShort(openSpot)} look ↓`
          : "Tap a dot on the garment"}
      </p>

      {openSpot && (
        <div className="flex flex-col gap-2">
          <SectionLabel>{placeShort(openSpot)}</SectionLabel>
          <div className="flex snap-x gap-2 overflow-x-auto pb-1">
            {component.options
              .filter((o) => whereOf(o) === openSpot)
              .map((o) => (
                <button
                  key={o.id}
                  type="button"
                  onClick={() => setSel((p) => ({ ...p, [openSpot]: o.id }))}
                  className={
                    "w-24 flex-none snap-start " +
                    tileCls(sel[openSpot] === o.id)
                  }
                >
                  <div className="aspect-square overflow-hidden rounded-card bg-mist-navy">
                    <Thumb opt={o} />
                  </div>
                  <span className="text-center text-[12px] font-semibold leading-tight text-ink-navy">
                    {tailOf(o)}
                  </span>
                </button>
              ))}
          </div>
        </div>
      )}

      <Tray entries={entries} onRemove={(s) => dropSpot(setSel, s)} />
      <DoneBar
        count={entries.length}
        onDone={() => setCommitted(commitLines(entries))}
      />
      <Result committed={committed} />
    </SampleFrame>
  );
}

// ─── H · whole-matrix grid (sparsity made visible) ───────────────────────

function MatrixSample({ component }: { component: StepComponent }) {
  const { spots, fieldAxes } = matrixOf(component);
  const [sel, setSel] = useState<Sel>({});
  const [committed, setCommitted] = useState<string[] | null>(null);

  const colAxis = fieldAxes[fieldAxes.length - 1];
  const groupAxes = fieldAxes.slice(0, -1);
  const groups = useMemo(() => {
    const g = groupAxes[0];
    if (!g)
      return [
        { label: null as string | null, combo: {} as Record<string, string> },
      ];
    return g.values
      .map((v) => ({
        label: tc(v),
        combo: { [g.key]: v } as Record<string, string>,
      }))
      .filter((grp) =>
        component.options.some(
          (o) => o.axisValues?.[g.key] === grp.combo[g.key],
        ),
      );
  }, [component, groupAxes]);

  const cellOpt = (
    spot: string,
    colVal: string,
    combo: Record<string, string>,
  ) =>
    component.options.find(
      (o) =>
        whereOf(o) === spot &&
        o.axisValues?.[colAxis?.key ?? ""] === colVal &&
        Object.entries(combo).every(([k, v]) => o.axisValues?.[k] === v),
    );

  const entries = selEntries(component, sel);

  return (
    <SampleFrame title={`${component.label} — matrix grid`}>
      <p className="text-[12px] leading-relaxed text-ink-navy/50">
        The entire matrix as a table — rows are places, columns are{" "}
        {colAxis?.label.toLowerCase() ?? "values"}
        {groupAxes.length > 0 &&
          ", grouped by " + groupAxes[0].label.toLowerCase()}
        . Dashed cells are combinations that don&rsquo;t exist in the catalog.
      </p>
      {groups.map((grp) => (
        <div key={grp.label ?? "all"} className="flex flex-col gap-1.5">
          {grp.label && <SectionLabel>{grp.label}</SectionLabel>}
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-1 pl-16">
              {(colAxis?.values ?? []).map((v) => (
                <span
                  key={v}
                  className="flex-1 text-center font-mono text-[10px] uppercase tracking-[0.1em] text-ink-navy/50"
                >
                  {tc(v)}
                </span>
              ))}
            </div>
            {spots.map((spot) => (
              <div key={spot} className="flex items-center gap-1">
                <span className="w-16 flex-none font-mono text-[10px] uppercase tracking-[0.1em] text-ink-navy/60">
                  {placeShort(spot)}
                </span>
                {(colAxis?.values ?? []).map((v) => {
                  const opt = cellOpt(spot, v, grp.combo);
                  const isSel = !!opt && sel[spot] === opt.id;
                  return (
                    <button
                      key={v}
                      type="button"
                      disabled={!opt}
                      onClick={() =>
                        opt && setSel((p) => ({ ...p, [spot]: opt.id }))
                      }
                      className={
                        "aspect-square flex-1 overflow-hidden rounded-card border transition-all ease-brand " +
                        (isSel
                          ? "border-accent-text bg-mist-navy/70 shadow-card"
                          : opt
                            ? "border-hairline bg-chalk-white active:scale-[0.96]"
                            : "border-dashed border-hairline bg-warm-sand/60 opacity-40")
                      }
                    >
                      {opt && <Thumb opt={opt} />}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      ))}
      <Tray entries={entries} onRemove={(s) => dropSpot(setSel, s)} />
      <DoneBar
        count={entries.length}
        onDone={() => setCommitted(commitLines(entries))}
      />
      <Result committed={committed} />
    </SampleFrame>
  );
}

// ─── I · per-place rails (horizontal carousels) ──────────────────────────

function RailsSample({ component }: { component: StepComponent }) {
  const { spots } = matrixOf(component);
  const [sel, setSel] = useState<Sel>({});
  const [committed, setCommitted] = useState<string[] | null>(null);
  const entries = selEntries(component, sel);

  return (
    <SampleFrame title={`${component.label} — rails`}>
      <p className="text-[12px] text-ink-navy/50">
        Every place gets its own swipeable photo rail — no tabs, all places on
        one screen.
      </p>
      {spots.map((spot) => {
        const cur = component.options.find((o) => o.id === sel[spot]);
        return (
          <div key={spot} className="flex flex-col gap-1.5">
            <div className="flex items-baseline justify-between">
              <SectionLabel>{placeShort(spot)}</SectionLabel>
              <span className="text-[11px] text-ink-navy/60">
                {cur ? `✓ ${tailOf(cur)}` : "swipe →"}
              </span>
            </div>
            <div className="flex snap-x snap-mandatory gap-2 overflow-x-auto pb-1">
              {component.options
                .filter((o) => whereOf(o) === spot)
                .map((o) => (
                  <button
                    key={o.id}
                    type="button"
                    onClick={() => setSel((p) => ({ ...p, [spot]: o.id }))}
                    className={
                      "w-24 flex-none snap-start " + tileCls(sel[spot] === o.id)
                    }
                  >
                    <div className="aspect-square overflow-hidden rounded-card bg-mist-navy">
                      <Thumb opt={o} />
                    </div>
                    <span className="text-center text-[12px] font-semibold leading-tight text-ink-navy">
                      {tailOf(o)}
                    </span>
                  </button>
                ))}
            </div>
          </div>
        );
      })}
      <Tray entries={entries} onRemove={(s) => dropSpot(setSel, s)} />
      <DoneBar
        count={entries.length}
        onDone={() => setCommitted(commitLines(entries))}
      />
      <Result committed={committed} />
    </SampleFrame>
  );
}

// ─── J · master–detail with availability-aware chips ─────────────────────

function MasterDetailSample({ component }: { component: StepComponent }) {
  const { spots, fieldAxes } = matrixOf(component);
  const [active, setActive] = useState(spots[0] ?? "");
  const [draft, setDraft] = useState<Record<string, Record<string, string>>>(
    {},
  );
  const [committed, setCommitted] = useState<string[] | null>(null);

  const optionsAt = (spot: string) =>
    component.options.filter((o) => whereOf(o) === spot);

  const resolve = (spot: string) => {
    const d = draft[spot];
    if (!d) return undefined;
    return optionsAt(spot).find((o) =>
      fieldAxes.every((a) => o.axisValues?.[a.key] === d[a.key]),
    );
  };

  // A chip is available if some real variation keeps it alongside the
  // spot's other picks — unavailable values render struck through, so a
  // dead end can't even be tapped.
  const available = (spot: string, axisKey: string, val: string) => {
    const d = draft[spot];
    return optionsAt(spot).some(
      (o) =>
        o.axisValues?.[axisKey] === val &&
        fieldAxes.every(
          (a) => a.key === axisKey || !d || o.axisValues?.[a.key] === d[a.key],
        ),
    );
  };

  const openSpot = (s: string) => {
    setActive(s);
    if (!draft[s]) {
      const seed = optionsAt(s)[0];
      if (seed?.axisValues)
        setDraft((p) => ({ ...p, [s]: { ...seed.axisValues } }));
    }
  };

  const entries = Object.keys(draft)
    .map((spot) => {
      const opt = resolve(spot);
      return opt ? { spot, opt, key: `${spot}:${opt.id}` } : null;
    })
    .filter((x): x is { spot: string; opt: StepOption; key: string } => !!x);
  const activeOpt = resolve(active);

  return (
    <SampleFrame title={`${component.label} — master–detail`}>
      {/* master list */}
      <div className="flex flex-col gap-1">
        {spots.map((s) => {
          const opt = resolve(s);
          return (
            <button
              key={s}
              type="button"
              onClick={() => openSpot(s)}
              className={
                "flex items-center justify-between rounded-card border px-3 py-2 text-left transition-all ease-brand " +
                (s === active
                  ? "border-accent-text/70 bg-mist-navy/50"
                  : "border-hairline bg-chalk-white")
              }
            >
              <span className="text-[13px] font-semibold text-ink-navy">
                {placeShort(s)}
              </span>
              <span className="text-[12px] text-ink-navy/60">
                {opt ? `✓ ${tailOf(opt)}` : "—"}
              </span>
            </button>
          );
        })}
      </div>

      {/* detail pane for the active place */}
      {draft[active] && (
        <div className="flex flex-col gap-3 rounded-card border border-hairline p-3">
          <div className="flex h-40 items-center justify-center rounded-card bg-mist-navy px-3">
            {activeOpt ? (
              <Thumb opt={activeOpt} contain />
            ) : (
              <span className="text-[13px] text-ink-navy/50">pick below</span>
            )}
          </div>
          {fieldAxes.map((a) => (
            <div key={a.key} className="flex flex-wrap items-center gap-1.5">
              <span className="w-12 font-mono text-eyebrow uppercase tracking-[0.12em] text-ink-navy/50">
                {a.label}
              </span>
              {a.values.map((val) => {
                const isOn = draft[active]?.[a.key] === val;
                const ok = available(active, a.key, val);
                return (
                  <button
                    key={val}
                    type="button"
                    disabled={!ok}
                    onClick={() =>
                      setDraft((p) => ({
                        ...p,
                        [active]: { ...p[active], [a.key]: val },
                      }))
                    }
                    className={
                      "rounded-full px-2.5 py-1 text-[12px] font-medium transition-all ease-brand active:scale-[0.96] " +
                      (isOn
                        ? "bg-tape text-chalk-white"
                        : ok
                          ? "border border-hairline bg-chalk-white text-ink-navy"
                          : "border border-hairline bg-chalk-white text-ink-navy/30 line-through")
                    }
                  >
                    {tc(val)}
                  </button>
                );
              })}
            </div>
          ))}
          <button
            type="button"
            onClick={() =>
              setDraft((p) => {
                const n = { ...p };
                delete n[active];
                return n;
              })
            }
            className="self-start text-[12px] text-ink-navy/50 transition-opacity ease-brand active:opacity-60"
          >
            remove {placeShort(active)}
          </button>
        </div>
      )}

      <DoneBar
        count={entries.length}
        onDone={() => setCommitted(commitLines(entries))}
      />
      <Result committed={committed} />
    </SampleFrame>
  );
}

// ─── K · swipe deck (one variation at a time) ────────────────────────────

function DeckSample({ component }: { component: StepComponent }) {
  const { spots } = matrixOf(component);
  const [spot, setSpot] = useState(spots[0] ?? "");
  const [idx, setIdx] = useState(0);
  const [sel, setSel] = useState<Sel>({});
  const [committed, setCommitted] = useState<string[] | null>(null);

  const deck = useMemo(
    () => component.options.filter((o) => whereOf(o) === spot),
    [component, spot],
  );
  const opt = deck[Math.min(idx, Math.max(deck.length - 1, 0))];
  const entries = selEntries(component, sel);

  return (
    <SampleFrame title={`${component.label} — swipe deck`}>
      <div className="flex flex-wrap gap-1.5">
        {spots.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => {
              setSpot(s);
              setIdx(0);
            }}
            className={pillCls(s === spot)}
          >
            {placeShort(s)}
            {sel[s] ? " ✓" : ""}
          </button>
        ))}
      </div>

      {opt && (
        <div className="flex flex-col gap-3">
          <div className="flex h-56 items-center justify-center rounded-card bg-mist-navy px-3">
            <Thumb opt={opt} contain />
          </div>
          <div className="flex items-center justify-between">
            <span className="text-body font-semibold text-ink-navy">
              {tailOf(opt)}
            </span>
            <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-ink-navy/50">
              {(idx % deck.length) + 1} / {deck.length}
            </span>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setIdx((i) => (i + 1) % deck.length)}
              className="flex-1 rounded-full border border-hairline bg-chalk-white py-2.5 text-body font-semibold text-ink-navy transition-all ease-brand active:scale-[0.98]"
            >
              ✕ Skip
            </button>
            <button
              type="button"
              onClick={() => {
                setSel((p) => ({ ...p, [spot]: opt.id }));
                setIdx((i) => (i + 1) % deck.length);
              }}
              className="flex-1 rounded-full bg-tape py-2.5 text-body font-semibold text-chalk-white shadow-card transition-all ease-brand active:scale-[0.98]"
            >
              ✓ Choose
            </button>
          </div>
          <p className="text-[12px] text-ink-navy/50">
            One variation at a time, Tinder-style — playful, but 48 variations
            is a lot of swiping.
          </p>
        </div>
      )}

      <Tray entries={entries} onRemove={(s) => dropSpot(setSel, s)} />
      <DoneBar
        count={entries.length}
        onDone={() => setCommitted(commitLines(entries))}
      />
      <Result committed={committed} />
    </SampleFrame>
  );
}

// ─── L · sentence builder (mad-libs / Zapier-style) ──────────────────────

function SentenceSample({ component }: { component: StepComponent }) {
  const { spots, fieldAxes } = matrixOf(component);
  const [sel, setSel] = useState<Sel>({});
  const [committed, setCommitted] = useState<string[] | null>(null);

  const entries = selEntries(component, sel);
  const optionsAt = (spot: string) =>
    component.options.filter((o) => whereOf(o) === spot);

  // Tap a word → cycle to the next value of that axis, preferring to keep
  // the other axes — cycles only land on real combos, so no dead ends.
  const cycle = (spot: string, axisKey: string) => {
    const cur = optionsAt(spot).find((o) => o.id === sel[spot]);
    const axis = fieldAxes.find((a) => a.key === axisKey);
    if (!cur || !axis) return;
    const vals = axis.values.filter((v) =>
      optionsAt(spot).some((o) => o.axisValues?.[axisKey] === v),
    );
    const curV = cur.axisValues?.[axisKey] ?? vals[0];
    const nextV = vals[(vals.indexOf(curV) + 1) % vals.length];
    const next =
      optionsAt(spot).find(
        (o) =>
          o.axisValues?.[axisKey] === nextV &&
          fieldAxes.every(
            (a) =>
              a.key === axisKey ||
              o.axisValues?.[a.key] === cur.axisValues?.[a.key],
          ),
      ) ?? optionsAt(spot).find((o) => o.axisValues?.[axisKey] === nextV);
    if (next) setSel((p) => ({ ...p, [spot]: next.id }));
  };

  const addPlace = () => {
    const next = spots.find((s) => !sel[s]);
    const first = next ? optionsAt(next)[0] : undefined;
    if (next && first) setSel((p) => ({ ...p, [next]: first.id }));
  };

  const art = (w: string) => (/^[aeiou]/i.test(w) ? "an" : "a");

  return (
    <SampleFrame title={`${component.label} — sentence builder`}>
      <p className="text-[12px] leading-relaxed text-ink-navy/50">
        The config reads as a sentence — tap an underlined word to cycle it
        (Zapier / mad-libs style).
      </p>
      <div className="flex flex-col gap-3">
        {entries.map(({ spot, opt }) => (
          <div
            key={spot}
            className="flex items-start justify-between gap-2 rounded-card border border-hairline bg-warm-sand/60 p-3"
          >
            <p className="font-heading text-[17px] leading-relaxed text-ink-navy">
              On the {placeShort(spot).toLowerCase()}:{" "}
              {art(tc(opt.axisValues?.[fieldAxes[0]?.key ?? ""] ?? ""))}{" "}
              {fieldAxes.map((a, i) => (
                <span key={a.key}>
                  {i > 0 && ", "}
                  <button
                    type="button"
                    onClick={() => cycle(spot, a.key)}
                    className="font-semibold text-ink-navy underline decoration-accent-text/60 decoration-2 underline-offset-4 transition-opacity ease-brand active:opacity-60"
                  >
                    {tc(opt.axisValues?.[a.key] ?? "")}
                  </button>
                </span>
              ))}{" "}
              {component.label.toLowerCase()}.
            </p>
            <button
              type="button"
              aria-label={`Remove ${spot}`}
              onClick={() => dropSpot(setSel, spot)}
              className="flex-none text-ink-navy/40 transition-opacity ease-brand active:opacity-60"
            >
              ✕
            </button>
          </div>
        ))}
        {spots.some((s) => !sel[s]) && (
          <button
            type="button"
            onClick={addPlace}
            className="self-start rounded-full border border-dashed border-ink-navy/30 px-3.5 py-1.5 text-[13px] font-medium text-ink-navy/70 transition-all ease-brand active:scale-[0.97]"
          >
            + add another place
          </button>
        )}
      </div>
      <DoneBar
        count={entries.length}
        onDone={() => setCommitted(commitLines(entries))}
      />
      <Result committed={committed} />
    </SampleFrame>
  );
}

// ─── M · summary-first expander (progressive disclosure) ─────────────────

function SummaryFirstSample({ component }: { component: StepComponent }) {
  const { spots, fieldAxes } = matrixOf(component);
  const [sel, setSel] = useState<Sel>({});
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [committed, setCommitted] = useState<string[] | null>(null);
  const entries = selEntries(component, sel);

  const optionsAt = (spot: string) =>
    component.options.filter((o) => whereOf(o) === spot);

  // Tap a chip → snap to the closest real combo carrying that value.
  const snap = (spot: string, axisKey: string, val: string) => {
    const pool = optionsAt(spot).filter((o) => o.axisValues?.[axisKey] === val);
    const cur = optionsAt(spot).find((o) => o.id === sel[spot]);
    const best =
      pool.find(
        (o) =>
          cur &&
          fieldAxes.every(
            (a) =>
              a.key === axisKey ||
              o.axisValues?.[a.key] === cur.axisValues?.[a.key],
          ),
      ) ?? pool[0];
    if (best) setSel((p) => ({ ...p, [spot]: best.id }));
  };

  const addPlace = () => {
    const next = spots.find((s) => !sel[s]);
    const first = next ? optionsAt(next)[0] : undefined;
    if (next && first) {
      setSel((p) => ({ ...p, [next]: first.id }));
      setEditing(next);
    }
  };

  return (
    <SampleFrame title={`${component.label} — summary first`}>
      {/* collapses to a single row until tapped */}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between rounded-card border border-hairline bg-chalk-white px-3.5 py-3 text-left shadow-card transition-all ease-brand"
      >
        <span className="text-[14px] font-semibold text-ink-navy">
          {component.label}
          <span className="ml-2 font-normal text-ink-navy/60">
            {entries.length === 0
              ? "not added"
              : `${entries.length} place${entries.length > 1 ? "s" : ""}`}
          </span>
        </span>
        <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-accent-text">
          {open ? "collapse ▲" : "configure ▼"}
        </span>
      </button>

      {open && (
        <div className="flex flex-col gap-2">
          {entries.map(({ spot, opt }) => (
            <div
              key={spot}
              className="flex flex-col gap-1.5 rounded-card border border-hairline p-2.5"
            >
              <div className="flex items-center justify-between">
                <button
                  type="button"
                  onClick={() => setEditing(editing === spot ? null : spot)}
                  className="text-left"
                >
                  <span className="text-[13px] font-semibold text-ink-navy">
                    {placeShort(spot)}
                  </span>
                  <span className="ml-2 text-[12px] text-ink-navy/60">
                    {tailOf(opt)}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => dropSpot(setSel, spot)}
                  className="text-[12px] text-ink-navy/50 transition-opacity ease-brand active:opacity-60"
                >
                  remove
                </button>
              </div>
              {editing === spot && (
                <div className="flex flex-col gap-1">
                  {fieldAxes.map((a) => (
                    <div
                      key={a.key}
                      className="flex flex-wrap items-center gap-1.5"
                    >
                      <span className="w-12 font-mono text-[10px] uppercase tracking-[0.12em] text-ink-navy/50">
                        {a.label}
                      </span>
                      {a.values
                        .filter((v) =>
                          optionsAt(spot).some(
                            (o) => o.axisValues?.[a.key] === v,
                          ),
                        )
                        .map((val) => (
                          <button
                            key={val}
                            type="button"
                            onClick={() => snap(spot, a.key, val)}
                            className={pillCls(opt.axisValues?.[a.key] === val)}
                          >
                            {tc(val)}
                          </button>
                        ))}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
          {entries.length < spots.length && (
            <button
              type="button"
              onClick={addPlace}
              className="self-start rounded-full border border-dashed border-ink-navy/30 px-3.5 py-1.5 text-[13px] font-medium text-ink-navy/70 transition-all ease-brand active:scale-[0.97]"
            >
              + add place
            </button>
          )}
        </div>
      )}

      <DoneBar
        count={entries.length}
        onDone={() => setCommitted(commitLines(entries))}
      />
      <Result committed={committed} />
    </SampleFrame>
  );
}

// ─── N · one-for-all look + per-place overrides ──────────────────────────

function OneForAllSample({ component }: { component: StepComponent }) {
  const { spots, fieldAxes } = matrixOf(component);
  const [global, setGlobal] = useState<string | null>(null);
  const [overrides, setOverrides] = useState<Sel>({});
  const [showCustom, setShowCustom] = useState(false);
  const [committed, setCommitted] = useState<string[] | null>(null);

  const repSpot = spots.find((s) => s.toLowerCase() === "back") ?? spots[0];
  const repOptions = useMemo(
    () => component.options.filter((o) => whereOf(o) === repSpot),
    [component, repSpot],
  );

  // The global look mirrors onto every place that has the same combo;
  // per-place overrides win where set.
  const sel = useMemo(() => {
    const out: Sel = {};
    const g = repOptions.find((o) => o.id === global);
    if (g?.axisValues) {
      const want = { ...g.axisValues };
      delete want.where;
      for (const s of spots) {
        const m = component.options.find(
          (o) =>
            whereOf(o) === s &&
            Object.entries(want).every(([k, v]) => o.axisValues?.[k] === v),
        );
        if (m) out[s] = m.id;
      }
    }
    return { ...out, ...overrides };
  }, [global, overrides, repOptions, component, spots]);

  const entries = selEntries(component, sel);

  const cycleSpot = (spot: string) => {
    const list = component.options.filter((o) => whereOf(o) === spot);
    const cur = list.findIndex((o) => o.id === sel[spot]);
    const next = list[(cur + 1) % list.length];
    if (next) setOverrides((p) => ({ ...p, [spot]: next.id }));
  };

  return (
    <SampleFrame title={`${component.label} — one-for-all`}>
      <p className="text-[12px] leading-relaxed text-ink-navy/50">
        Step 1 — pick one look; it applies everywhere it exists. Step 2
        (optional) — override individual places.
      </p>
      <div className="grid grid-cols-3 gap-2">
        {repOptions.map((o) => (
          <button
            key={o.id}
            type="button"
            onClick={() => {
              setGlobal(o.id);
              setOverrides({});
            }}
            className={tileCls(global === o.id)}
          >
            <div className="aspect-square overflow-hidden rounded-card bg-mist-navy">
              <Thumb opt={o} />
            </div>
            <span className="text-center text-[12px] font-semibold leading-tight text-ink-navy">
              {tailOf(o)}
            </span>
          </button>
        ))}
      </div>
      {global && (
        <p className="text-[12px] text-ink-navy/60">
          Applied to {Object.keys(sel).length} of {spots.length} places
          {Object.keys(overrides).length > 0 &&
            ` · ${Object.keys(overrides).length} custom`}
        </p>
      )}

      <button
        type="button"
        onClick={() => setShowCustom((s) => !s)}
        className="self-start rounded-full border border-hairline px-3.5 py-1.5 text-[13px] font-medium text-ink-navy transition-all ease-brand active:scale-[0.97]"
      >
        {showCustom ? "Hide" : "Customize"} individual places
      </button>

      {showCustom && (
        <div className="flex flex-col gap-1">
          {spots.map((spot) => {
            const opt = component.options.find((o) => o.id === sel[spot]);
            const isOver = spot in overrides;
            return (
              <div
                key={spot}
                className="flex items-center justify-between rounded-card border border-hairline px-3 py-2"
              >
                <span className="text-[13px] font-semibold text-ink-navy">
                  {placeShort(spot)}
                  <span className="ml-2 font-normal text-ink-navy/60">
                    {opt ? tailOf(opt) : "—"}
                  </span>
                </span>
                <span className="flex items-center gap-2">
                  <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-ink-navy/40">
                    {isOver ? "custom" : global ? "global" : ""}
                  </span>
                  {opt && (
                    <>
                      <button
                        type="button"
                        onClick={() => cycleSpot(spot)}
                        className="text-[12px] font-medium text-accent-text transition-opacity ease-brand active:opacity-60"
                      >
                        change
                      </button>
                      {isOver && (
                        <button
                          type="button"
                          onClick={() =>
                            setOverrides((p) => {
                              const n = { ...p };
                              delete n[spot];
                              return n;
                            })
                          }
                          className="text-[12px] text-ink-navy/50 transition-opacity ease-brand active:opacity-60"
                        >
                          ↺
                        </button>
                      )}
                    </>
                  )}
                </span>
              </div>
            );
          })}
          <p className="text-[11px] text-ink-navy/50">
            Axes here:{" "}
            {fieldAxes.map((a) => a.label.toLowerCase()).join(" × ") || "—"}
          </p>
        </div>
      )}

      <DoneBar
        count={entries.length}
        onDone={() => setCommitted(commitLines(entries))}
      />
      <Result committed={committed} />
    </SampleFrame>
  );
}

// ─── page ────────────────────────────────────────────────────────────────

const VARIANTS = [
  {
    key: "a",
    name: "A · Tabs + cards",
    pitch:
      "Place tabs first, then photo cards of that spot's real variations. Impossible combos never appear; 'apply to all' mirrors one pick everywhere.",
    render: TabsCardsSample,
  },
  {
    key: "b",
    name: "B · Configurator",
    pitch:
      "Today's chip flow, upgraded: live photo of the combo being assembled, status on every place chip, apply-to-all. Keeps the dead-end risk on sparse matrices.",
    render: ConfiguratorSample,
  },
  {
    key: "c",
    name: "C · Gallery",
    pitch:
      "Everything in one scrollable grid with filter chips. Fast for small matrices; feel the noise on Key Hole's 48 variations.",
    render: GallerySample,
  },
  {
    key: "d",
    name: "D · Garment map",
    pitch:
      "Tap the blouse itself — front/back flip + sleeve zones. Most spatial, most build effort.",
    render: MapSample,
  },
  {
    key: "e",
    name: "E · Guided wizard",
    pitch:
      "One question per screen: where → each place's look → review (progressive disclosure / guided selling, the car-configurator staple). Zero dead ends by construction.",
    render: WizardSample,
  },
  {
    key: "f",
    name: "F · Presets",
    pitch:
      "Smart defaults: a handful of named recipes ('Everywhere · Round', 'Just the back') instead of a wall of choices — the fastest entry into a sparse matrix.",
    render: PresetsSample,
  },
  {
    key: "g",
    name: "G · Hotspots",
    pitch:
      "Shoppable-image pattern: small + dots on the garment, tap one to open that spot's options inline. Compact cousin of the garment map.",
    render: HotspotsSample,
  },
  {
    key: "h",
    name: "H · Matrix grid",
    pitch:
      "The whole matrix as a table — rows are places, columns are size/type, grouped by shape. Dashed cells = combos that don't exist: sparsity made visible.",
    render: MatrixSample,
  },
  {
    key: "i",
    name: "I · Rails",
    pitch:
      "Every place gets its own horizontally-swipeable photo rail (the fashion-app carousel). No tabs, no filters — all places on one screen.",
    render: RailsSample,
  },
  {
    key: "j",
    name: "J · Master–detail",
    pitch:
      "Compact place list on top, one detail pane below — with availability-aware chips: impossible values are struck through, so dead ends can't even be tapped.",
    render: MasterDetailSample,
  },
  {
    key: "k",
    name: "K · Swipe deck",
    pitch:
      "Tinder-style discovery: one variation at a time, Skip / Choose. Playful and photo-first, but slow once the matrix grows.",
    render: DeckSample,
  },
  {
    key: "l",
    name: "L · Sentence builder",
    pitch:
      "Zapier / mad-libs style: the config reads as a sentence — 'On the back: a round, medium key hole' — and tapping an underlined word cycles it to the next real combo.",
    render: SentenceSample,
  },
  {
    key: "m",
    name: "M · Summary first",
    pitch:
      "Progressive disclosure, cart-style: collapses to one row until opened, then the config reads as editable summary lines. Smallest footprint of all.",
    render: SummaryFirstSample,
  },
  {
    key: "n",
    name: "N · One-for-all",
    pitch:
      "The 'same everywhere' path made primary: pick a single look for every place, then optionally override individual places (global → custom is visible per row).",
    render: OneForAllSample,
  },
] as const;

type VariantKey = (typeof VARIANTS)[number]["key"];

export default function UxPlaygroundPage() {
  const router = useRouter();
  const [components, setComponents] = useState<StepComponent[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [addonIdx, setAddonIdx] = useState(0);
  const [variant, setVariant] = useState<VariantKey>("a");

  useEffect(() => {
    (async () => {
      try {
        // "blouse" is a slug — the tree endpoint wants the id, so resolve it
        // through the list on failure (same dance MyodSheet does).
        let t;
        try {
          t = await getGarmentTree("blouse");
        } catch (err) {
          const list = await listGarments();
          const bySlug = (list.items ?? []).find((g) => g.slug === "blouse");
          if (!bySlug) throw err;
          t = await getGarmentTree(bySlug.id);
        }
        setComponents(
          (t.addons ?? [])
            .map(addonToStepComponent)
            .filter(
              (c) =>
                (c.axes ?? []).some((a) => a.key === "where") &&
                (c.axes ?? []).length >= 2,
            ),
        );
      } catch (e) {
        setError(String(e));
      }
    })();
  }, []);

  const active = VARIANTS.find((v) => v.key === variant) ?? VARIANTS[0];
  const Sample = active.render;
  const component = components?.[addonIdx];

  return (
    <div className="column flex h-dvh flex-col bg-warm-sand">
      <header className="relative flex flex-none flex-col justify-end overflow-hidden bg-ink-navy text-chalk-white">
        <div
          aria-hidden
          className="pointer-events-none absolute -right-32 -top-32 h-96 w-96 rounded-full opacity-20 blur-md"
          style={{ background: "var(--tape-gradient)" }}
        />
        <div className="relative z-10 flex items-center gap-3 px-4 py-2.5">
          <button
            type="button"
            onClick={() => router.push("/myod/blouse")}
            aria-label="Back to configurator"
            className="flex h-9 w-9 items-center justify-center rounded-full border border-chalk-white/25 bg-chalk-white/10 text-chalk-white transition-all ease-brand active:scale-95 active:bg-chalk-white/20"
          >
            <ArrowLeft size={20} />
          </button>
          <div>
            <span className="font-mono text-eyebrow font-medium uppercase tracking-[0.18em] text-chalk-white/80">
              MYOD · PLAYGROUND
            </span>
            <h1 className="font-heading text-h3 font-semibold text-chalk-white">
              Matrix picker options
            </h1>
          </div>
        </div>
        <div
          aria-hidden
          className="lp-tape-strip absolute inset-x-0 bottom-0 z-10"
        />
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-16 pt-4">
        {error && (
          <p className="rounded-card border border-hairline bg-chalk-white p-4 text-body text-ink-navy">
            Couldn&rsquo;t load the blouse catalog ({error}). Is the API up on
            :8000?
          </p>
        )}
        {!components && !error && (
          <p className="p-4 text-center text-body text-ink-navy/60">
            Loading blouse catalog…
          </p>
        )}

        {components && component && (
          <div className="mx-auto flex max-w-md flex-col gap-4">
            {/* pickers */}
            <div className="flex flex-col gap-2">
              <SectionLabel>Add-on</SectionLabel>
              <div className="flex flex-wrap gap-1.5">
                {components.map((c, i) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => setAddonIdx(i)}
                    className={
                      "rounded-full px-3 py-1.5 text-[13px] font-medium transition-all ease-brand active:scale-[0.97] " +
                      (i === addonIdx
                        ? "bg-tape text-chalk-white"
                        : "border border-hairline bg-chalk-white text-ink-navy")
                    }
                  >
                    {c.label}
                  </button>
                ))}
              </div>
              <SectionLabel>Variant</SectionLabel>
              <div className="flex flex-wrap gap-1.5">
                {VARIANTS.map((v) => (
                  <button
                    key={v.key}
                    type="button"
                    onClick={() => setVariant(v.key)}
                    className={
                      "rounded-full px-3 py-1.5 text-[13px] font-medium transition-all ease-brand active:scale-[0.97] " +
                      (v.key === variant
                        ? "bg-ink-navy text-chalk-white"
                        : "border border-hairline bg-chalk-white text-ink-navy")
                    }
                  >
                    {v.name}
                  </button>
                ))}
              </div>
              <p className="text-[13px] leading-relaxed text-ink-navy/70">
                {active.pitch}
              </p>
            </div>

            {/* the sample itself — remounts on addon change so state resets */}
            <Sample key={`${component.id}-${variant}`} component={component} />

            <p className="text-center text-[12px] leading-relaxed text-ink-navy/50">
              Dummy playground wired to the real blouse catalog. A–D are
              homegrown; E–N come from a UX research pass (configurator wizards,
              smart defaults, shoppable hotspots, swipe decks…). Variation
              photos for these add-ons aren&rsquo;t generated yet — cells show
              semantic glyphs (shape / folds / wave size) standing in.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
