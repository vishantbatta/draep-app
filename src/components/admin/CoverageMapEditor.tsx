"use client";

/**
 * CoverageMapEditor — admin draws a style captain's serviceable shapes.
 *
 * UX (per spec): "Add serviceable areas" opens a full map. The admin clicks
 * the map to drop points ONE BY ONE (1st, 2nd, 3rd…); a rubber-band line
 * follows the cursor, and once ≥3 points exist a dashed preview shows what
 * closing would look like. Hovering the FIRST point highlights it with a
 * "Click to close area" tooltip — clicking it (or the Close area button)
 * finishes the shape. Shapes accumulate in a list; Save persists the whole
 * coverage to style_captain_profiles.coverage (generic admin table API).
 *
 * Vanilla Leaflet in refs (no react-leaflet) — same pattern as
 * LeafletMapPicker: the draft layers are managed imperatively so mousemove
 * rubber-banding never re-renders React.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import L from "leaflet";

export type Ring = { lat: number; lng: number }[];

const CENTER: [number, number] = [12.9716, 77.5946]; // Bengaluru
const ZOOM = 11;
const MAX_SHAPES = 5;
const MIN_POINTS = 3;

type LatLng = { lat: number; lng: number };

const toLL = (p: LatLng): [number, number] => [p.lat, p.lng];

export function CoverageMapEditor({
  coverage,
  saving,
  onClose,
  onSave,
  captainName,
}: {
  coverage: Ring[];
  saving: boolean;
  onClose: () => void;
  onSave: (next: Ring[]) => Promise<void>;
  captainName: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const shapesLayerRef = useRef<L.LayerGroup | null>(null);
  const draftLayerRef = useRef<L.LayerGroup | null>(null);
  const verticesRef = useRef<LatLng[]>([]);
  const firstMarkerRef = useRef<L.CircleMarker | null>(null);
  const mouseRef = useRef<LatLng | null>(null);
  const rubberRef = useRef<L.Polyline | null>(null);
  const closePrevRef = useRef<L.Polyline | null>(null);
  const drawingRef = useRef(false);

  const [shapes, setShapes] = useState<Ring[]>(coverage);
  const [drawing, setDrawing] = useState(false);
  const [pointCount, setPointCount] = useState(0);
  const [hoverFirst, setHoverFirst] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // refs mirroring state for imperative (non-React) map handlers
  const shapesRef = useRef<Ring[]>(coverage);
  shapesRef.current = shapes;
  const hoverFirstRef = useRef(false);
  const redrawDraftRef = useRef<() => void>(() => {});

  // ── init map once ────────────────────────────────────────────────────────
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = L.map(containerRef.current, { center: CENTER, zoom: ZOOM });
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "© OpenStreetMap contributors",
    }).addTo(map);
    shapesLayerRef.current = L.layerGroup().addTo(map);
    draftLayerRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;

    // Drop a point
    map.on("click", (e: L.LeafletMouseEvent) => {
      if (!drawingRef.current) return;
      if (verticesRef.current.length >= 30) return; // sanity cap per shape
      verticesRef.current.push({ lat: e.latlng.lat, lng: e.latlng.lng });
      setPointCount(verticesRef.current.length);
      redrawDraftRef.current();
    });

    // Rubber band + close-preview follow the cursor
    map.on("mousemove", (e: L.LeafletMouseEvent) => {
      if (!drawingRef.current || verticesRef.current.length === 0) return;
      mouseRef.current = { lat: e.latlng.lat, lng: e.latlng.lng };
      redrawRubber();
    });

    // fit to existing shapes, else center
    if (coverage.length > 0) {
      const bounds = L.latLngBounds(
        coverage.flat().map((p) => [p.lat, p.lng] as [number, number]),
      );
      map.fitBounds(bounds.pad(0.25));
    }

    return () => {
      map.off();
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── redraw saved shapes whenever the list changes ────────────────────────
  useEffect(() => {
    const layer = shapesLayerRef.current;
    if (!layer) return;
    layer.clearLayers();
    shapes.forEach((ring, i) => {
      if (ring.length < MIN_POINTS) return;
      L.polygon(ring.map(toLL), {
        color: "#1e3a5f",
        weight: 2,
        fillColor: "#ff5a1f",
        fillOpacity: 0.25,
      })
        .bindTooltip(`Area ${i + 1}`, { permanent: false })
        .addTo(layer);
    });
  }, [shapes]);

  // ── imperative draft rendering ───────────────────────────────────────────
  const redrawRubber = useCallback(() => {
    const map = mapRef.current;
    const layer = draftLayerRef.current;
    if (!map || !layer) return;
    const vs = verticesRef.current;
    const mouse = mouseRef.current;
    if (rubberRef.current) {
      layer.removeLayer(rubberRef.current);
      rubberRef.current = null;
    }
    if (closePrevRef.current) {
      layer.removeLayer(closePrevRef.current);
      closePrevRef.current = null;
    }
    if (!drawingRef.current || vs.length === 0 || !mouse) return;
    // solid segment: last committed point → cursor
    rubberRef.current = L.polyline([toLL(vs[vs.length - 1]), toLL(mouse)], {
      color: "#1e3a5f",
      weight: 2,
      dashArray: "4 6",
      interactive: false, // never steal clicks/hovers from the vertex markers
    }).addTo(layer);
    // dashed segment: cursor → first point (what closing would look like)
    if (vs.length >= MIN_POINTS) {
      closePrevRef.current = L.polyline([toLL(mouse), toLL(vs[0])], {
        color: "#ff5a1f",
        weight: 2,
        dashArray: "2 8",
        interactive: false, // must not cover the first-point marker
      }).addTo(layer);
    }
  }, []);

  const closeShape = useCallback(() => {
    const vs = verticesRef.current;
    if (vs.length < MIN_POINTS) {
      setError(`An area needs at least ${MIN_POINTS} points.`);
      return;
    }
    const next = [...shapesRef.current, vs];
    setShapes(next);
    verticesRef.current = [];
    mouseRef.current = null;
    drawingRef.current = false;
    setDrawing(false);
    setPointCount(0);
    setHoverFirst(false);
    hoverFirstRef.current = false;
    setError(null);
    redrawDraftRef.current();
  }, []);

  const redrawDraft = useCallback(() => {
    const layer = draftLayerRef.current;
    if (!layer) return;
    layer.eachLayer((l) => {
      if (
        l !== firstMarkerRef.current &&
        l !== rubberRef.current &&
        l !== closePrevRef.current
      ) {
        layer.removeLayer(l);
      }
    });
    const vs = verticesRef.current;
    if (vs.length >= 2) {
      L.polyline(vs.map(toLL), {
        color: "#1e3a5f",
        weight: 2,
        interactive: false,
      }).addTo(layer);
    }
    // non-first vertices — plain dots, rebuilt freely (no hover handlers)
    vs.slice(1).forEach((p) => {
      L.circleMarker(toLL(p), {
        radius: 6,
        color: "#ffffff",
        weight: 2,
        fillColor: "#1e3a5f",
        fillOpacity: 1,
      }).addTo(layer);
    });

    // FIRST vertex — persistent marker; hover only restyles it in place so
    // the element never detaches (no flicker / lost-hover loops).
    const canClose = vs.length >= MIN_POINTS;
    if (vs.length >= 1) {
      if (!firstMarkerRef.current) {
        const marker = L.circleMarker(toLL(vs[0]), {
          radius: 8,
          color: "#ff5a1f",
          weight: 2,
          fillColor: "#1e3a5f",
          fillOpacity: 1,
        });
        marker.bindTooltip("", { direction: "top", offset: [0, -8] });
        marker.on("mouseover", () => {
          if (verticesRef.current.length < MIN_POINTS) return;
          hoverFirstRef.current = true;
          setHoverFirst(true);
          marker.setStyle({ radius: 11, fillColor: "#ff5a1f" });
          marker.setTooltipContent("Click to close area");
          marker.openTooltip();
        });
        marker.on("mouseout", () => {
          hoverFirstRef.current = false;
          setHoverFirst(false);
          marker.setStyle({ radius: 8, fillColor: "#1e3a5f" });
          marker.closeTooltip();
        });
        marker.on("click", () => {
          if (verticesRef.current.length >= MIN_POINTS) closeShape();
        });
        firstMarkerRef.current = marker;
      }
      if (!layer.hasLayer(firstMarkerRef.current)) {
        firstMarkerRef.current.addTo(layer);
      }
      firstMarkerRef.current.setLatLng(toLL(vs[0]));
      firstMarkerRef.current.setTooltipContent(
        canClose ? "Click to close area" : "First point — close after 3+ points",
      );
    } else if (firstMarkerRef.current) {
      layer.removeLayer(firstMarkerRef.current);
      firstMarkerRef.current = null;
    }
    redrawRubber();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  redrawDraftRef.current = redrawDraft;

  const startDrawing = () => {
    if (shapes.length >= MAX_SHAPES) {
      setError(`Up to ${MAX_SHAPES} areas per captain.`);
      return;
    }
    setError(null);
    verticesRef.current = [];
    mouseRef.current = null;
    drawingRef.current = true;
    setDrawing(true);
    setPointCount(0);
    redrawDraftRef.current();
    mapRef.current?.getContainer().classList.add("cursor-crosshair");
  };

  const stopDrawing = () => {
    drawingRef.current = false;
    setDrawing(false);
    setPointCount(0);
    setHoverFirst(false);
    hoverFirstRef.current = false;
    verticesRef.current = [];
    redrawDraftRef.current();
    mapRef.current?.getContainer().classList.remove("cursor-crosshair");
  };

  const undoPoint = () => {
    verticesRef.current.pop();
    setPointCount(verticesRef.current.length);
    redrawDraftRef.current();
  };

  const removeShape = (i: number) => {
    setShapes((list) => list.filter((_, j) => j !== i));
  };

  const handleSave = async () => {
    for (const ring of shapes) {
      if (ring.length < MIN_POINTS) {
        setError(`Every area needs at least ${MIN_POINTS} points.`);
        return;
      }
    }
    setError(null);
    await onSave(shapes);
  };

  const dirty = JSON.stringify(shapes) !== JSON.stringify(coverage);

  return (
    <div className="fixed inset-0 z-[1200] flex items-center justify-center bg-ink-navy/50 p-4">
      <div className="flex max-h-[92vh] w-full max-w-4xl flex-col overflow-hidden rounded-xl bg-chalk-white shadow-xl">
        {/* header */}
        <div className="flex items-center justify-between border-b border-hairline px-5 py-3">
          <div>
            <h2 className="font-heading text-base font-semibold text-ink-navy">
              Serviceable areas — {captainName}
            </h2>
            <p className="text-[11px] text-muted">
              The captain is only bookable inside these shapes.
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close editor"
            className="flex h-8 w-8 items-center justify-center rounded-pill text-muted transition hover:bg-mist-navy"
          >
            ✕
          </button>
        </div>

        {/* toolbar */}
        <div className="flex flex-wrap items-center gap-2 border-b border-hairline px-5 py-2.5">
          {!drawing ? (
            <button
              onClick={startDrawing}
              disabled={shapes.length >= MAX_SHAPES}
              className="rounded-lg bg-ink-navy px-3 py-1.5 text-xs font-semibold text-chalk-white transition hover:bg-tape disabled:cursor-not-allowed disabled:opacity-40"
            >
              + Draw new area
            </button>
          ) : (
            <>
              <span className="text-[11px] font-medium text-ink-navy">
                Point {pointCount} dropped — click the map to add the next
              </span>
              <button
                onClick={undoPoint}
                disabled={pointCount === 0}
                className="rounded-lg border border-hairline-strong px-3 py-1.5 text-xs font-semibold text-ink-navy transition hover:bg-mist-navy/40 disabled:opacity-40"
              >
                Undo point
              </button>
              <button
                onClick={closeShape}
                disabled={pointCount < MIN_POINTS}
                className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                  pointCount >= MIN_POINTS
                    ? "bg-draep-orange text-chalk-white hover:opacity-90"
                    : "cursor-not-allowed border border-hairline text-muted opacity-50"
                }`}
              >
                Close area
              </button>
              <button
                onClick={stopDrawing}
                className="rounded-lg px-3 py-1.5 text-xs text-muted underline"
              >
                Discard
              </button>
            </>
          )}
          {hoverFirst && (
            <span className="text-[11px] font-semibold text-draep-orange">
              Release over the first point — click it to close the shape
            </span>
          )}
        </div>

        {/* map */}
        <div className="relative">
          <div ref={containerRef} className="h-[55vh] w-full" />
        </div>

        {/* footer: shapes list + save */}
        <div className="border-t border-hairline px-5 py-3">
          {error && <p className="mb-2 text-[11px] font-medium text-red-600">{error}</p>}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              {shapes.length === 0 && (
                <span className="text-[11px] text-muted">
                  No areas yet — this captain can&apos;t be booked until one is drawn.
                </span>
              )}
              {shapes.map((ring, i) => (
                <span
                  key={i}
                  className="inline-flex items-center gap-2 rounded-pill border border-hairline bg-mist-navy/40 px-3 py-1 text-[11px] font-medium text-ink-navy"
                >
                  Area {i + 1} · {ring.length} points
                  <button
                    onClick={() => removeShape(i)}
                    aria-label={`Remove area ${i + 1}`}
                    className="text-muted transition hover:text-red-600"
                  >
                    ✕
                  </button>
                </span>
              ))}
            </div>
            <div className="flex items-center gap-3">
              {dirty && <span className="text-[11px] text-muted">Unsaved changes</span>}
              <button
                onClick={handleSave}
                disabled={saving || !dirty}
                className="rounded-lg bg-ink-navy px-5 py-2 text-xs font-semibold text-chalk-white transition hover:bg-tape disabled:cursor-not-allowed disabled:opacity-40"
              >
                {saving ? "Saving…" : "Save serviceable areas"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
