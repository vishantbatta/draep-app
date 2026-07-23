"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  createCondition,
  createGroup,
  fetchTableData,
  fetchTables,
  FILTER_LABELS,
  nextId,
  type AdminTableData,
  type FilterCondition,
  type FilterGroup,
  type FilterNode,
  type FilterOp,
  type SortDirection,
  type SortState,
} from "@/lib/admin-api";

const PER_PAGE = 20;

// ─── Extend filter node types with transient id for React keys ─────────────────

interface TreeNode extends Omit<FilterCondition, "type"> {
  type: "filter";
  id: string;
}

interface TreeGroup {
  type: "group";
  id: string;
  logic: "and" | "or";
  children: TypedFilterNode[];
}

type TypedFilterNode = TreeNode | TreeGroup;

function typedCondition(col: string): TreeNode {
  return { ...createCondition(col), id: nextId() } as TreeNode;
}

function typedGroup(logic: "and" | "or" = "and"): TreeGroup {
  return { ...createGroup(logic), id: nextId() } as TreeGroup;
}

/** Convert typed tree → plain FilterNode for the API (strip ids). */
function toApiNode(node: TypedFilterNode): FilterNode {
  if (node.type === "filter") {
    return { type: "filter", column: node.column, op: node.op, value: node.value };
  }
  return {
    type: "group",
    logic: node.logic,
    children: node.children.map(toApiNode),
  };
}

/** Deep-clone a typed node (with new ids) for safe mutation. */
function cloneNode(node: TypedFilterNode): TypedFilterNode {
  if (node.type === "filter") {
    return { ...node, id: nextId() };
  }
  return { ...node, id: nextId(), children: node.children.map(cloneNode) };
}

/** Count how many leaf conditions exist in a typed tree. */
function countConditions(node: TypedFilterNode): number {
  if (node.type === "filter") return 1;
  return node.children.reduce((sum, c) => sum + countConditions(c), 0);
}

// ═══════════════════════════════════════════════════════════════════════════════
//  Main dashboard component
// ═══════════════════════════════════════════════════════════════════════════════

export default function AdminDashboard() {
  // ─── State ────────────────────────────────────────────────────────────────
  const [tables, setTables] = useState<string[]>([]);
  const [activeTable, setActiveTable] = useState<string | null>(null);
  const [data, setData] = useState<AdminTableData | null>(null);
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState<SortState>({ column: null, direction: "desc" });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Filter state — root is always a group (AND by default)
  const [filterRoot, setFilterRoot] = useState<TreeGroup | null>(null);
  const [showFilters, setShowFilters] = useState(false);

  // ─── Load table list on mount ─────────────────────────────────────────────
  useEffect(() => {
    fetchTables()
      .then((t) => {
        setTables(t);
        if (t.length > 0) {
          setActiveTable(t[0]);
          setPage(1);
        }
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load tables"));
  }, []);

  // ─── Push table list + active table to sidebar ───────────────────────────
  useEffect(() => {
    window.dispatchEvent(
      new CustomEvent("admin-sidebar-update", {
        detail: {
          items: tables.map((t) => ({
            label: t,
            active: activeTable === t,
            onClick: () => handleTableSelect(t),
          })),
        },
      }),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tables, activeTable]);

  // ─── Compute the API-ready filter object (memoised) ──────────────────────
  const apiFilters = useMemo(() => {
    if (!filterRoot || filterRoot.children.length === 0) return null;
    return toApiNode(filterRoot);
  }, [filterRoot]);

  // ─── Load table data ─────────────────────────────────────────────────────
  const loadRef = useRef(0);

  useEffect(() => {
    if (!activeTable) return;

    const myLoadId = ++loadRef.current;
    setLoading(true);
    setError(null);

    fetchTableData(activeTable, page, PER_PAGE, sort, apiFilters)
      .then((d) => {
        if (loadRef.current === myLoadId) {
          setData(d);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (loadRef.current === myLoadId) {
          setError(err instanceof Error ? err.message : "Failed to load data");
          setLoading(false);
        }
      });
  }, [activeTable, page, sort, apiFilters]);

  // ─── Keyboard pagination (←/→) ─────────────────────────────────────────────
  const totalPages = data?.total_pages ?? 1;

  const goNext = useCallback(() => {
    setPage((p) => Math.min(p + 1, totalPages));
  }, [totalPages]);

  const goPrev = useCallback(() => {
    setPage((p) => Math.max(p - 1, 1));
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;

      if (e.key === "ArrowRight") {
        e.preventDefault();
        goNext();
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        goPrev();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [goNext, goPrev]);

  // ─── Handlers ──────────────────────────────────────────────────────────────

  function handleTableSelect(t: string) {
    setActiveTable(t);
    setPage(1);
    setSort({ column: null, direction: "desc" });
    setFilterRoot(null);
    setShowFilters(false);
  }

  function handleSort(col: string) {
    setPage(1);
    setSort((prev) => {
      if (prev.column === col) {
        const nextDir: SortDirection = prev.direction === "asc" ? "desc" : "asc";
        return { column: col, direction: nextDir };
      }
      return { column: col, direction: "asc" };
    });
  }

  // ─── Filter mutation helpers ──────────────────────────────────────────────

  /** Toggle the filter panel. Creates root group on first open. */
  function toggleFilterPanel() {
    setShowFilters((prev) => {
      const next = !prev;
      if (next && !filterRoot) {
        setFilterRoot(typedGroup("and"));
      }
      return next;
    });
  }

  /** Clear all filters. */
  function clearFilters() {
    setFilterRoot(typedGroup("and"));
    setPage(1);
  }

  const activeFilterCount = filterRoot ? countConditions(filterRoot) : 0;
  const columns = data?.columns ?? [];

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="px-4 py-4 md:px-6 md:py-6">
      {/* ─── Table info bar ────────────────────────────────────────────────── */}
      {data && (
        <div className="mb-3 flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <h1 className="truncate font-heading text-h3 font-semibold text-ink-navy md:text-h2">
              {data.table}
            </h1>
            <span className="shrink-0 rounded-pill bg-mist-navy px-2.5 py-0.5 font-mono text-caption text-ink-navy">
              {data.total}
            </span>
          </div>
          <div className="flex shrink-0 items-center gap-3">
            {/* Filter toggle */}
            <button
              onClick={toggleFilterPanel}
              className={`tap flex items-center gap-1.5 rounded-pill border px-3 py-1.5 font-mono text-caption transition ${
                showFilters || activeFilterCount > 0
                  ? "border-accent-text bg-accent-bg text-accent-text"
                  : "border-hairline-strong bg-chalk-white text-ink-navy hover:bg-mist-navy"
              }`}
            >
              <svg className="h-3.5 w-3.5" viewBox="0 0 16 16" fill="none">
                <path
                  d="M2 3h12M4 8h8M6 13h4"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                />
              </svg>
              <span>Filter</span>
              {activeFilterCount > 0 && (
                <span className="ml-0.5 rounded-pill bg-accent-text px-1.5 text-[10px] font-bold text-chalk-white">
                  {activeFilterCount}
                </span>
              )}
            </button>
            <div className="font-mono text-caption text-muted">
              {data.page} / {data.total_pages}
            </div>
          </div>
        </div>
      )}

      {/* ─── Filter panel ──────────────────────────────────────────────────── */}
      {showFilters && filterRoot && columns.length > 0 && (
        <FilterPanel
          root={filterRoot}
          columns={columns}
          onChange={setFilterRoot}
          onClear={clearFilters}
          onApply={() => {
            setPage(1);
            setShowFilters(false);
          }}
        />
      )}

      {/* ─── Error ─────────────────────────────────────────────────────────── */}
      {error && (
        <div className="mb-4 rounded-card border border-error-border bg-error-bg px-4 py-3 text-caption text-error-text">
          {error}
        </div>
      )}

      {/* ─── Desktop: data table ──────────────────────────────────────────── */}
      <div className="hidden overflow-x-auto rounded-card border border-hairline bg-chalk-white shadow-card md:block">
        {loading ? (
          <div className="flex h-48 items-center justify-center">
            <span className="text-caption text-muted">Loading…</span>
          </div>
        ) : data && data.rows.length > 0 ? (
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="border-b border-hairline bg-mist-navy">
                {data.columns.map((col) => (
                  <SortableTh
                    key={col}
                    column={col}
                    sort={sort}
                    onSort={handleSort}
                  />
                ))}
              </tr>
            </thead>
            <tbody>
              {data.rows.map((row, idx) => (
                <tr
                  key={idx}
                  className="border-b border-hairline transition last:border-b-0 hover:bg-warm-sand"
                >
                  {data.columns.map((col) => (
                    <td
                      key={col}
                      className="whitespace-nowrap px-3 py-2 text-data text-ink"
                    >
                      <CellRenderer value={row[col]} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="flex h-48 items-center justify-center">
            <span className="text-caption text-muted">No rows</span>
          </div>
        )}
      </div>

      {/* ─── Mobile: card list ────────────────────────────────────────────── */}
      <div className="space-y-2 md:hidden">
        {loading ? (
          <div className="flex h-48 items-center justify-center rounded-card border border-hairline bg-chalk-white">
            <span className="text-caption text-muted">Loading…</span>
          </div>
        ) : data && data.rows.length > 0 ? (
          <>
            {/* Sort selector for mobile */}
            <MobileSortBar
              columns={data.columns}
              sort={sort}
              onSort={handleSort}
            />
            {data.rows.map((row, idx) => (
              <MobileRowCard
                key={idx}
                row={row}
                columns={data.columns}
              />
            ))}
          </>
        ) : (
          <div className="flex h-48 items-center justify-center rounded-card border border-hairline bg-chalk-white">
            <span className="text-caption text-muted">No rows</span>
          </div>
        )}
      </div>

      {/* ─── Pagination ────────────────────────────────────────────────────── */}
      {data && (
        <div className="mt-4 flex flex-col gap-3">
          {/* Prev / Next row */}
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <button
                onClick={goPrev}
                disabled={page <= 1}
                className="tap flex items-center gap-1 rounded-pill border border-hairline-strong bg-chalk-white px-4 py-2 text-caption font-medium text-ink-navy transition hover:bg-mist-navy disabled:cursor-not-allowed disabled:opacity-40"
              >
                <span aria-hidden>←</span> Prev
              </button>
              <button
                onClick={goNext}
                disabled={page >= totalPages}
                className="tap flex items-center gap-1 rounded-pill border border-hairline-strong bg-chalk-white px-4 py-2 text-caption font-medium text-ink-navy transition hover:bg-mist-navy disabled:cursor-not-allowed disabled:opacity-40"
              >
                Next <span aria-hidden>→</span>
              </button>
            </div>

            <span className="hidden font-mono text-caption text-muted sm:inline">
              Use ← → arrow keys to navigate
            </span>

            {/* Page number pills */}
            <PagePills
              current={page}
              total={totalPages}
              onSelect={setPage}
            />
          </div>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
//  Filter Panel — top-level wrapper with Apply / Clear buttons
// ═══════════════════════════════════════════════════════════════════════════════

function FilterPanel({
  root,
  columns,
  onChange,
  onClear,
  onApply,
}: {
  root: TreeGroup;
  columns: string[];
  onChange: (root: TreeGroup) => void;
  onClear: () => void;
  onApply: () => void;
}) {
  return (
    <div className="mb-4 rounded-card border border-hairline bg-chalk-white p-3 shadow-card md:p-4">
      {/* Header */}
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="font-heading text-body font-semibold text-ink-navy">
          Filters
        </h2>
        <div className="flex items-center gap-2">
          <button
            onClick={onClear}
            className="tap rounded-pill border border-hairline-strong px-3 py-1 text-eyebrow text-muted transition hover:bg-mist-navy hover:text-ink-navy"
          >
            Clear all
          </button>
          <button
            onClick={onApply}
            className="tap rounded-pill bg-ink-navy px-4 py-1 text-eyebrow font-medium text-chalk-white transition hover:bg-ink-navy/90"
          >
            Apply
          </button>
        </div>
      </div>

      {/* Recursive tree */}
      <FilterGroupEditor
        group={root}
        columns={columns}
        depth={0}
        onChange={(newGroup) => onChange(newGroup as TreeGroup)}
        onRemove={() => onChange(typedGroup("and"))}
      />
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
//  Recursive Group Editor — renders a group with AND/OR toggle and children
// ═══════════════════════════════════════════════════════════════════════════════

function FilterGroupEditor({
  group,
  columns,
  depth,
  onChange,
  onRemove,
}: {
  group: TreeGroup;
  columns: string[];
  depth: number;
  onChange: (node: TreeGroup) => void;
  onRemove: () => void;
}) {
  // Update a specific child by id
  function updateChild(id: string, newChild: TypedFilterNode) {
    onChange({
      ...group,
      children: group.children.map((c) => (c.id === id ? newChild : c)),
    });
  }

  // Remove a child by id
  function removeChild(id: string) {
    onChange({
      ...group,
      children: group.children.filter((c) => c.id !== id),
    });
  }

  // Add a new condition
  function addCondition() {
    const col = columns[0] ?? "";
    onChange({ ...group, children: [...group.children, typedCondition(col)] });
  }

  // Add a new nested group
  function addGroup() {
    onChange({
      ...group,
      children: [
        ...group.children,
        typedGroup("and"),
      ],
    });
  }

  // Toggle AND / OR
  function toggleLogic() {
    onChange({ ...group, logic: group.logic === "and" ? "or" : "and" });
  }

  const isRoot = depth === 0;

  return (
    <div
      className={`rounded-card ${
        isRoot
          ? "bg-warm-sand/50"
          : "border border-hairline bg-warm-sand/30"
      } ${depth > 0 ? "ml-2 md:ml-4" : ""}`}
    >
      {/* Group header: logic toggle + remove (if not root) */}
      <div className="flex items-center gap-2 p-2">
        <div className="flex shrink-0 items-center gap-1">
          <span className="text-[11px] font-medium uppercase tracking-wide text-muted">
            Match
          </span>
          {/* AND/OR toggle */}
          <div className="flex overflow-hidden rounded-pill border border-hairline-strong">
            <button
              onClick={() => group.logic !== "and" && toggleLogic()}
              className={`px-2.5 py-0.5 text-[11px] font-semibold transition ${
                group.logic === "and"
                  ? "bg-ink-navy text-chalk-white"
                  : "bg-chalk-white text-ink-navy hover:bg-mist-navy"
              }`}
            >
              AND
            </button>
            <button
              onClick={() => group.logic !== "or" && toggleLogic()}
              className={`px-2.5 py-0.5 text-[11px] font-semibold transition ${
                group.logic === "or"
                  ? "bg-ink-navy text-chalk-white"
                  : "bg-chalk-white text-ink-navy hover:bg-mist-navy"
              }`}
            >
              OR
            </button>
          </div>
        </div>

        {!isRoot && (
          <button
            onClick={onRemove}
            className="tap ml-auto flex h-6 w-6 items-center justify-center rounded-pill text-muted transition hover:bg-error-bg hover:text-error-text"
            aria-label="Remove group"
            title="Remove group"
          >
            <svg className="h-3.5 w-3.5" viewBox="0 0 16 16" fill="none">
              <path
                d="M4 4l8 8M12 4l-8 8"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>
          </button>
        )}
      </div>

      {/* Children */}
      <div className="space-y-2 px-2 pb-2">
        {group.children.length === 0 && (
          <div className="rounded-card border border-dashed border-hairline-strong px-3 py-3 text-center text-caption text-muted">
            No conditions yet. Add one below.
          </div>
        )}

        {group.children.map((child) => (
          <div key={child.id} className="relative">
            {/* AND/OR connector label between items */}
            {group.children.length > 1 && (
              <div className="absolute -top-2 left-1/2 z-10 -translate-x-1/2">
                <span className="rounded-pill bg-ink-navy px-1.5 py-0 text-[9px] font-bold leading-4 text-chalk-white">
                  {group.logic.toUpperCase()}
                </span>
              </div>
            )}

            {child.type === "filter" ? (
              <FilterConditionEditor
                condition={child}
                columns={columns}
                onChange={(c) => updateChild(child.id, c)}
                onRemove={() => removeChild(child.id)}
              />
            ) : (
              <FilterGroupEditor
                group={child}
                columns={columns}
                depth={depth + 1}
                onChange={(g) => updateChild(child.id, g)}
                onRemove={() => removeChild(child.id)}
              />
            )}
          </div>
        ))}
      </div>

      {/* Add buttons */}
      <div className="flex flex-wrap gap-2 p-2 pt-0">
        <button
          onClick={addCondition}
          className="tap flex items-center gap-1 rounded-pill border border-hairline-strong bg-chalk-white px-3 py-1 text-caption font-medium text-ink-navy transition hover:bg-mist-navy"
        >
          <svg className="h-3 w-3" viewBox="0 0 12 12" fill="none">
            <path d="M6 2v8M2 6h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
          Condition
        </button>
        <button
          onClick={addGroup}
          className="tap flex items-center gap-1 rounded-pill border border-hairline-strong bg-chalk-white px-3 py-1 text-caption font-medium text-ink-navy transition hover:bg-mist-navy"
        >
          <svg className="h-3 w-3" viewBox="0 0 12 12" fill="none">
            <path d="M6 2v8M2 6h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
          Group
        </button>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
//  Filter Condition Editor — column select, operator select, value input
// ═══════════════════════════════════════════════════════════════════════════════

function FilterConditionEditor({
  condition,
  columns,
  onChange,
  onRemove,
}: {
  condition: TreeNode;
  columns: string[];
  onChange: (c: TreeNode) => void;
  onRemove: () => void;
}) {
  const ops = Object.keys(FILTER_LABELS) as FilterOp[];

  return (
    <div className="flex flex-wrap items-center gap-1.5 rounded-card border border-hairline bg-chalk-white p-2">
      {/* Column select */}
      <select
        value={condition.column}
        onChange={(e) => onChange({ ...condition, column: e.target.value })}
        className="min-w-0 flex-1 rounded-pill border border-hairline-strong bg-chalk-white px-2.5 py-1 text-[13px] text-ink-navy outline-none focus:border-accent-text"
      >
        {columns.map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
      </select>

      {/* Operator select */}
      <select
        value={condition.op}
        onChange={(e) => onChange({ ...condition, op: e.target.value as FilterOp })}
        className="shrink-0 rounded-pill border border-hairline-strong bg-chalk-white px-2.5 py-1 text-[13px] text-ink-navy outline-none focus:border-accent-text"
      >
        {ops.map((op) => (
          <option key={op} value={op}>
            {FILTER_LABELS[op]}
          </option>
        ))}
      </select>

      {/* Value input */}
      <input
        type="text"
        value={condition.value}
        onChange={(e) => onChange({ ...condition, value: e.target.value })}
        placeholder="Value…"
        className="min-w-0 flex-1 rounded-pill border border-hairline-strong bg-chalk-white px-2.5 py-1 text-[13px] text-ink outline-none focus:border-accent-text"
      />

      {/* Remove */}
      <button
        onClick={onRemove}
        className="tap flex h-6 w-6 shrink-0 items-center justify-center rounded-pill text-muted transition hover:bg-error-bg hover:text-error-text"
        aria-label="Remove condition"
        title="Remove condition"
      >
        <svg className="h-3.5 w-3.5" viewBox="0 0 16 16" fill="none">
          <path
            d="M4 4l8 8M12 4l-8 8"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </svg>
      </button>
    </div>
  );
}

// ─── Desktop sortable header ─────────────────────────────────────────────────

function SortableTh({
  column,
  sort,
  onSort,
}: {
  column: string;
  sort: SortState;
  onSort: (col: string) => void;
}) {
  const isActive = sort.column === column;
  const isSorted = isActive && sort.direction;

  return (
    <th className="whitespace-nowrap px-3 py-2.5 font-mono text-eyebrow text-ink-navy">
      <button
        onClick={() => onSort(column)}
        className={`group inline-flex items-center gap-1 transition ${
          isActive ? "text-accent-text" : "text-ink-navy hover:text-accent-text"
        }`}
      >
        <span>{column}</span>
        <SortIcon active={isActive} direction={isSorted} />
      </button>
    </th>
  );
}

function SortIcon({
  active,
  direction,
}: {
  active: boolean;
  direction: SortDirection | false;
}) {
  if (!active || !direction) {
    return (
      <svg
        className="h-3 w-3 opacity-30 group-hover:opacity-60"
        viewBox="0 0 12 12"
        fill="none"
      >
        <path d="M4 4l2-2 2 2M4 8l2 2 2-2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }

  if (direction === "asc") {
    return (
      <svg className="h-3 w-3" viewBox="0 0 12 12" fill="none">
        <path d="M6 2v8M6 2L3 5M6 2l3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }

  return (
    <svg className="h-3 w-3" viewBox="0 0 12 12" fill="none">
      <path d="M6 10V2M6 10L3 7M6 10l3-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// ─── Mobile: sort dropdown bar ───────────────────────────────────────────────

function MobileSortBar({
  columns,
  sort,
  onSort,
}: {
  columns: string[];
  sort: SortState;
  onSort: (col: string) => void;
}) {
  const activeCol = sort.column;

  return (
    <div className="flex items-center gap-2 overflow-x-auto rounded-card border border-hairline bg-chalk-white px-3 py-2">
      <span className="shrink-0 font-mono text-eyebrow text-ink-navy">Sort:</span>
      <div className="flex gap-1">
        {columns.map((col) => {
          const isActive = activeCol === col;
          return (
            <button
              key={col}
              onClick={() => onSort(col)}
              className={`flex shrink-0 items-center gap-0.5 rounded-pill px-2.5 py-1 font-mono text-[12px] transition ${
                isActive
                  ? "bg-ink-navy text-chalk-white"
                  : "bg-mist-navy text-ink-navy"
              }`}
            >
              {col}
              {isActive && (
                <span className="ml-0.5 text-[10px]">
                  {sort.direction === "asc" ? "↑" : "↓"}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ─── Mobile: row rendered as card ────────────────────────────────────────────

function MobileRowCard({
  row,
  columns,
}: {
  row: Record<string, unknown>;
  columns: string[];
}) {
  return (
    <div className="rounded-card border border-hairline bg-chalk-white p-3 shadow-card">
      <dl className="space-y-1">
        {columns.map((col) => (
          <div key={col} className="flex gap-2">
            <dt className="w-28 shrink-0 truncate font-mono text-[11px] uppercase tracking-wide text-muted">
              {col}
            </dt>
            <dd className="min-w-0 flex-1 break-words text-[13px] text-ink">
              <CellRenderer value={row[col]} />
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

// ─── Cell renderer ────────────────────────────────────────────────────────────

function CellRenderer({ value }: { value: unknown }) {
  const display = useMemo(() => formatCellValue(value), [value]);
  const isLong = display.length > 60;

  if (value === null || value === undefined) {
    return <span className="text-muted/50 italic">NULL</span>;
  }

  if (isLong) {
    return (
      <span className="inline-block max-w-[280px] truncate" title={display}>
        {display}
      </span>
    );
  }

  return <span>{display}</span>;
}

function formatCellValue(value: unknown): string {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

// ─── Page pills ───────────────────────────────────────────────────────────────

function PagePills({
  current,
  total,
  onSelect,
}: {
  current: number;
  total: number;
  onSelect: (p: number) => void;
}) {
  const pages = useMemo(() => {
    const range: (number | "...")[] = [];
    const window = 1;
    const start = Math.max(1, current - window);
    const end = Math.min(total, current + window);

    if (start > 1) {
      range.push(1);
      if (start > 2) range.push("...");
    }
    for (let i = start; i <= end; i++) range.push(i);
    if (end < total) {
      if (end < total - 1) range.push("...");
      range.push(total);
    }

    return range;
  }, [current, total]);

  return (
    <div className="flex items-center gap-1">
      {pages.map((p, i) =>
        p === "..." ? (
          <span key={`ellipsis-${i}`} className="px-1 font-mono text-caption text-muted">
            …
          </span>
        ) : (
          <button
            key={p}
            onClick={() => onSelect(p)}
            className={`tap min-w-[32px] rounded-pill px-2 py-1 font-mono text-caption transition ${
              p === current
                ? "bg-ink-navy text-chalk-white"
                : "border border-hairline-strong bg-chalk-white text-ink-navy hover:bg-mist-navy"
            }`}
          >
            {p}
          </button>
        ),
      )}
    </div>
  );
}
