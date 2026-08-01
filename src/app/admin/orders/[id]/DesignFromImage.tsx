"use client";

/**
 * DesignFromImage — Conversational AI Design Assistant
 *
 * A chat-based UI where the admin can iteratively refine a garment design:
 * - Upload reference images
 * - Type instructions (with voice-to-text via Web Speech API)
 * - The AI (Gemini 3.6 Flash) maintains conversation context across turns
 *   and returns the revised full set of selections each time.
 *
 * The admin can keep iterating until satisfied, then clicks "Confirm Design"
 * to hand the selections off to the parent (NewOrderSheet) which loads them
 * into GarmentOrderEditor.
 *
 * Supports two modes:
 * 1. Draft mode (draftMode=true): passes DraftItem[] + imageUrl to parent
 *    via onDraftChange. Used in NewOrderSheet.
 * 2. Apply mode (garmentOrderId provided): writes to DB via applyDesignFromAI.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  chatDesign,
  clearDesignThread,
  applyDesignFromAI,
  createTableRow,
  fetchGarmentTree,
  type AISelection,
  type AIAddon,
  type AIUnknownItem,
  type ChatDesignResult,
  type GarmentOrderItemRow,
  type GarmentTree,
} from "@/lib/admin-api";
import type { DraftItem } from "./GarmentOrderEditor";

// ─── Props ─────────────────────────────────────────────────────────────

interface DesignFromImageProps {
  garmentId: string;
  /** Set when editing an existing garment order (apply mode). */
  garmentOrderId?: string;
  /** Draft mode: return DraftItems to parent instead of writing to DB. */
  draftMode?: boolean;
  onSaveComplete?: (items: GarmentOrderItemRow[]) => void;
  /** Called with draft items + last reference image URL (draft mode only). */
  onDraftChange?: (items: DraftItem[], imageUrl: string) => void;
  /**
   * Apply mode (composerOnly): fired with the raw AI selections + add-ons +
   * reference image URL on every AI response, so the parent can prefill a
   * GarmentOrderEditor (apply mode) without writing to the DB itself. The
   * admin then saves explicitly via the editor's "Save Design" button.
   */
  onApplyDraft?: (
    selections: AISelection[],
    addons: AIAddon[],
    imageUrl: string,
  ) => void;
  onCancel?: () => void;
  /**
   * When provided, the component skips the upload zone and immediately
   * sends this text as the first user message to start the conversation.
   * Used by the "Audio Describe" tab.
   */
  initialMessage?: string;
  /**
   * Render ONLY the composer (upload/mic/send) and fire the appropriate
   * draft callback (onDraftChange in draft mode, onApplyDraft in apply mode)
   * on every AI response. The parent owns the reference image +
   * GarmentOrderEditor and renders this beneath them.
   */
  composerOnly?: boolean;
  /**
   * Optional thread id to share conversation context across instances
   * (e.g. the upload-zone instance and the composerOnly instance).
   */
  threadId?: string;
}

// ─── Types ─────────────────────────────────────────────────────────────

interface ChatMessageUser {
  role: "user";
  id: string;
  text?: string;
  imageUrl?: string; // local object URL for preview
}

interface ChatMessageAI {
  role: "ai";
  id: string;
  message: string;
  selections: AISelection[];
  addons: AIAddon[];
  unknown_items: AIUnknownItem[];
}

type ChatMessage = ChatMessageUser | ChatMessageAI;

// ─── Helpers ───────────────────────────────────────────────────────────

const UNKNOWN_TYPE_LABELS: Record<string, string> = {
  variation: "New Variation",
  variation_type: "New Sub-type",
  addon: "New Add-on",
  addon_variation: "New Add-on Variation",
};

const UNKNOWN_TYPE_COLORS: Record<string, string> = {
  variation: "bg-amber-100 text-amber-800 border-amber-300",
  variation_type: "bg-orange-100 text-orange-800 border-orange-300",
  addon: "bg-purple-100 text-purple-800 border-purple-300",
  addon_variation: "bg-pink-100 text-pink-800 border-pink-300",
};

function makeId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Convert the latest AI result into DraftItem[] for draft mode. */
function aiResultToDraftItems(
  selections: AISelection[],
  addons: AIAddon[],
): DraftItem[] {
  const items: DraftItem[] = [];

  for (const sel of selections) {
    const compLabel = sel.component_label ?? sel.component_id;
    const varLabel = sel.variation_label ?? sel.variation_id;
    const vtLabel = sel.variation_type_label;

    const labelSnapshot = vtLabel
      ? `${compLabel} → ${varLabel} → ${vtLabel}`
      : `${compLabel} → ${varLabel}`;

    items.push({
      type: "variation",
      garment_style_component_id: sel.component_id,
      variation_id: sel.variation_id,
      variation_type_id: sel.variation_type_id,
      addon_id: null,
      addon_variation_id: null,
      placement: null,
      price: null,
      label_snapshot: labelSnapshot,
    });
  }

  for (const addon of addons) {
    const addonLabel = addon.addon_label ?? addon.addon_id;
    const avLabel = addon.addon_variation_label;
    const labelSnapshot = avLabel ? `${addonLabel} → ${avLabel}` : addonLabel;

    items.push({
      type: "add_on",
      garment_style_component_id: null,
      variation_id: null,
      variation_type_id: null,
      addon_id: addon.addon_id,
      addon_variation_id: addon.addon_variation_id,
      placement: addon.placement?.join(", ") ?? null,
      price: null,
      label_snapshot: labelSnapshot,
    });
  }

  return items;
}

/**
 * Convert the latest AI result into GarmentOrderItemRow[] (apply-mode shape)
 * so a real GarmentOrderEditor can be prefilled from it. Mirrors
 * aiResultToDraftItems but stamps the garment_order_id and row id.
 */
export function aiResultToGarmentOrderItems(
  selections: AISelection[],
  addons: AIAddon[],
  garmentOrderId: string,
): GarmentOrderItemRow[] {
  return aiResultToDraftItems(selections, addons).map((it, i) => ({
    id: `prefilled-${garmentOrderId}-${i}`,
    garment_order_id: garmentOrderId,
    garment_style_component_id: it.garment_style_component_id,
    type: it.type,
    variation_id: it.variation_id,
    variation_type_id: it.variation_type_id,
    addon_id: it.addon_id,
    addon_variation_id: it.addon_variation_id,
    placement: it.placement,
    price: it.price,
    custom_input: null,
    label_snapshot: it.label_snapshot,
  }));
}

interface SpeechRecognitionEventLike {
  results: {
    length: number;
    [index: number]: { 0: { transcript: string } };
  };
}

// ─── Component ─────────────────────────────────────────────────────────

export function DesignFromImage({
  garmentId,
  garmentOrderId,
  draftMode = false,
  onSaveComplete,
  onDraftChange,
  onApplyDraft,
  onCancel,
  initialMessage,
  composerOnly = false,
  threadId,
}: DesignFromImageProps) {
  // Conversation state
  const threadIdRef = useRef<string>(threadId ?? makeId());
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Current state (from last AI response)
  const [currentSelections, setCurrentSelections] = useState<AISelection[]>([]);
  const [currentAddons, setCurrentAddons] = useState<AIAddon[]>([]);
  const [currentUnknowns, setCurrentUnknowns] = useState<AIUnknownItem[]>([]);
  const [lastImageUrl, setLastImageUrl] = useState<string | null>(null);

  // Resolved unknowns (index → added to catalog)
  const [resolvedUnknowns, setResolvedUnknowns] = useState<Set<number>>(new Set());
  const [discardedUnknowns, setDiscardedUnknowns] = useState<Set<number>>(new Set());

  // Catalog tree — used to (a) validate each unknown's parent_id before
  // showing the "+ Add" action and (b) look up labels when auto-selecting a
  // freshly-created catalog row.
  const [tree, setTree] = useState<GarmentTree | null>(null);

  // Composer state
  const [textDraft, setTextDraft] = useState("");
  const [pendingImage, setPendingImage] = useState<File | null>(null);
  const [pendingImagePreview, setPendingImagePreview] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);

  // Refs
  const fileInputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const speechRef = useRef<any>(null);
  const textInputRef = useRef<HTMLTextAreaElement>(null);

  // ── Load the garment catalog tree once ───────────────────────────────
  useEffect(() => {
    let cancelled = false;
    fetchGarmentTree(garmentId)
      .then((t) => {
        if (!cancelled) setTree(t);
      })
      .catch(() => {
        /* tree is best-effort for unknown validation; ignore failures */
      });
    return () => {
      cancelled = true;
    };
  }, [garmentId]);

  // Sets of valid parent ids, derived from the tree. An unknown is only
  // actionable if its parent_id resolves against one of these.
  const validParentIds = useMemo(() => {
    const componentIds = new Set<string>();
    const variationIds = new Set<string>();
    const addonIds = new Set<string>();
    if (tree) {
      for (const comp of tree.components) {
        componentIds.add(comp.id);
        for (const v of comp.variations) variationIds.add(v.id);
      }
      for (const addon of tree.addons) addonIds.add(addon.id);
    }
    return { componentIds, variationIds, addonIds };
  }, [tree]);

  // ── Auto-scroll to bottom ────────────────────────────────────────────
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, loading]);

  // ── Cleanup thread on unmount ────────────────────────────────────────
  // Only clear when this instance OWNS the thread. When a threadId was passed
  // in (shared with a sibling instance, e.g. the upload-zone → composerOnly
  // handoff in NewOrderSheet), the parent owns the lifecycle and clearing
  // here would wipe the shared conversation out from under the other instance.
  useEffect(() => {
    if (threadId) return; // externally-owned thread — don't clear on unmount
    const tid = threadIdRef.current;
    return () => {
      clearDesignThread(tid).catch(() => {});
    };
  }, [threadId]);

  // ── Auto-send initialMessage (e.g. from Audio Describe tab) ──────────
  const initialSentRef = useRef(false);
  useEffect(() => {
    if (initialMessage && !initialSentRef.current && !loading) {
      initialSentRef.current = true;
      // Send directly with the text, bypassing textDraft state
      sendMessage(initialMessage);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialMessage]);

  // ── Web Speech API setup ─────────────────────────────────────────────
  const supportsSpeech =
    typeof window !== "undefined" &&
    (("SpeechRecognition" in window) || ("webkitSpeechRecognition" in window));

  const startRecording = useCallback(() => {
    if (!supportsSpeech) return;
    const SR =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    const recognition = new SR();
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.lang = "en-IN";

    recognition.onresult = (event: SpeechRecognitionEventLike) => {
      const transcript = event.results[0][0].transcript;
      setTextDraft((prev) => (prev ? `${prev} ${transcript}` : transcript));
      textInputRef.current?.focus();
    };

    recognition.onerror = () => {
      setRecording(false);
    };

    recognition.onend = () => {
      setRecording(false);
    };

    speechRef.current = recognition;
    recognition.start();
    setRecording(true);
  }, [supportsSpeech]);

  const stopRecording = useCallback(() => {
    speechRef.current?.stop();
    setRecording(false);
  }, []);

  // ── Push the current design up to the parent (live editor update) ────
  /**
   * Fire the appropriate live callback so the parent's GarmentOrderEditor
   * remounts with the given selections + add-ons. Shared by sendMessage
   * (on every AI response) and handleAddUnknownToCatalog (after a row is
   * created and auto-selected).
   *
   * `imageUrl` is passed explicitly (rather than read from lastImageUrl
   * state) because callers run in the same tick as setLastImageUrl — the
   * state closure would be stale and yield "" → broken <img> in the parent.
   */
  const pushDesignUp = useCallback(
    (
      selections: AISelection[],
      addons: AIAddon[],
      imageUrl?: string,
    ) => {
      const refUrl = imageUrl ?? lastImageUrl ?? "";
      if (selections.length === 0 && addons.length === 0) return;
      if (draftMode) {
        const draftItems = aiResultToDraftItems(selections, addons);
        onDraftChange?.(draftItems, refUrl);
      } else {
        onApplyDraft?.(selections, addons, refUrl);
      }
    },
    [draftMode, lastImageUrl, onDraftChange, onApplyDraft],
  );

  // ── Unknown-item validation (#2) ─────────────────────────────────────
  /**
   * An unknown is only actionable (can be "+ Add"-ed) when its parent_id
   * resolves to a real catalog row of the right kind. Unknowns with a
   * dangling parent are silently dropped from the UI; defaults stay as-is.
   * `addon` needs no parent (created under the garment itself).
   */
  const isActionableUnknown = useCallback(
    (item: AIUnknownItem): boolean => {
      if (!item.parent_id) return item.type === "addon";
      switch (item.type) {
        case "variation":
          return validParentIds.componentIds.has(item.parent_id);
        case "variation_type":
          return validParentIds.variationIds.has(item.parent_id);
        case "addon_variation":
          return validParentIds.addonIds.has(item.parent_id);
        case "addon":
          return true;
        default:
          return false;
      }
    },
    [validParentIds],
  );

  // ── Send message ─────────────────────────────────────────────────────

  /**
   * Core send logic. Accepts an optional overrideText so it can be called
   * before textDraft state is set (e.g. from the initialMessage effect).
   */
  const sendMessage = async (overrideText?: string) => {
    const rawText = overrideText ?? textDraft;
    const hasText = rawText.trim().length > 0;
    const hasImage = !!pendingImage;
    if (!hasText && !hasImage) return;
    if (loading) return;

    setError(null);

    // Capture values before clearing composer state. We do NOT revoke the
    // blob URL yet — it stays valid for the upload-zone preview and is only
    // revoked once we have the hosted image_url back from the server.
    const sendText = rawText.trim();
    const sendImage = pendingImage;
    const sendImagePreview = pendingImagePreview;

    setTextDraft("");
    setPendingImage(null);
    setPendingImagePreview(null);

    setLoading(true);
    try {
      const result: ChatDesignResult = await chatDesign(
        threadIdRef.current,
        garmentId,
        { text: sendText || undefined, image: sendImage ?? undefined },
      );

      // Add the user message AFTER the response, using the backend-hosted
      // image_url (valid forever) instead of the local blob URL.
      const userMsg: ChatMessageUser = {
        role: "user",
        id: makeId(),
        text: hasText ? sendText : undefined,
        imageUrl: hasImage
          ? result.image_url ?? sendImagePreview ?? undefined
          : undefined,
      };
      setMessages((prev) => [...prev, userMsg]);

      // Add AI message
      const aiMsg: ChatMessageAI = {
        role: "ai",
        id: makeId(),
        message: result.message,
        selections: result.selections,
        addons: result.addons,
        unknown_items: result.unknown_items,
      };
      setMessages((prev) => [...prev, aiMsg]);

      // Update current state
      setCurrentSelections(result.selections);
      setCurrentAddons(result.addons);
      setCurrentUnknowns(result.unknown_items);
      setResolvedUnknowns(new Set());
      setDiscardedUnknowns(new Set());

      if (result.image_url) {
        setLastImageUrl(result.image_url);
      }

      // Push the latest selections up to the parent on EVERY AI response so
      // the editor + reference image update live. Pass image_url explicitly
      // (see pushDesignUp) — lastImageUrl state is stale in this same tick.
      pushDesignUp(
        result.selections,
        result.addons,
        result.image_url ?? undefined,
      );

      // Blob URL no longer needed — the user message uses the hosted URL now.
      if (sendImagePreview) {
        URL.revokeObjectURL(sendImagePreview);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to get AI response");
      // Restore the composer so the user can retry without losing their input.
      setTextDraft(sendText);
      if (sendImage) {
        setPendingImage(sendImage);
        setPendingImagePreview(sendImagePreview);
      }
    } finally {
      setLoading(false);
    }
  };

  // ── Image selection ──────────────────────────────────────────────────

  const handleFileSelect = (file: File) => {
    if (!file.type.startsWith("image/")) {
      setError("Please select an image file (JPG, PNG, WebP).");
      return;
    }
    // HEIC/HEIF/AVIF can't be decoded by browsers in an <img> tag, so the
    // preview would render as a broken image. Reject up front with guidance.
    const name = file.name.toLowerCase();
    const undecodable =
      file.type === "image/heic" ||
      file.type === "image/heif" ||
      file.type === "image/avif" ||
      name.endsWith(".heic") ||
      name.endsWith(".heif") ||
      name.endsWith(".avif");
    if (undecodable) {
      setError(
        "HEIC/AVIF images can't be previewed. Please convert to JPG, PNG, or WebP and try again.",
      );
      return;
    }
    if (file.size > 12 * 1024 * 1024) {
      setError("Image is too large. Please use an image under 12 MB.");
      return;
    }
    setError(null);
    setPendingImage(file);
    setPendingImagePreview(URL.createObjectURL(file));
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFileSelect(file);
    e.target.value = ""; // reset so same file can be re-selected
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (file) handleFileSelect(file);
  };

  // ── Key handling ─────────────────────────────────────────────────────

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  // ── Add unknown to catalog ───────────────────────────────────────────

  const handleAddUnknownToCatalog = async (idx: number) => {
    const item = currentUnknowns[idx];
    if (!item) return;
    // Safety net (#2): never action an unknown whose parent doesn't resolve.
    if (!isActionableUnknown(item)) {
      setError(
        `Can't add "${item.name}" — its parent isn't in the catalog. Add it manually first.`,
      );
      return;
    }
    try {
      // The payload is the same for every leaf type; only the table + FK field differ.
      const payload = {
        slug: item.slug,
        labels: { en: item.name },
        priority_order: 999,
        price: item.suggested_price,
      };

      if (item.type === "variation") {
        // Create the variation under its component, then auto-select it.
        const created = await createTableRow<{ id: string }>(
          "garment_style_component_variations",
          { ...payload, component_id: item.parent_id },
        );
        const newSel: AISelection = {
          component_id: item.parent_id!,
          component_label: item.parent_label,
          variation_id: created.id,
          variation_label: item.name,
          variation_type_id: null,
          variation_type_label: null,
        };
        // Replace any existing choice for this component, then push up.
        setCurrentSelections((prev) => [
          ...prev.filter((s) => s.component_id !== item.parent_id),
          newSel,
        ]);
        pushDesignUp(
          [
            ...currentSelections.filter((s) => s.component_id !== item.parent_id),
            newSel,
          ],
          currentAddons,
        );
      } else if (item.type === "variation_type") {
        // Create the sub-type under its variation. We need the parent
        // component id + variation label to build a complete selection.
        const created = await createTableRow<{ id: string }>(
          "garment_style_component_variation_types",
          { ...payload, variation_id: item.parent_id },
        );
        const parentSel = currentSelections.find(
          (s) => s.variation_id === item.parent_id,
        );
        const newSel: AISelection = {
          component_id: parentSel?.component_id ?? "",
          component_label: parentSel?.component_label ?? null,
          variation_id: item.parent_id!,
          variation_label: parentSel?.variation_label ?? null,
          variation_type_id: created.id,
          variation_type_label: item.name,
        };
        const componentId = parentSel?.component_id ?? null;
        const nextSelections = [
          ...currentSelections.filter(
            (s) => componentId !== null && s.component_id !== componentId,
          ),
          newSel,
        ];
        setCurrentSelections(nextSelections);
        pushDesignUp(nextSelections, currentAddons);
      } else if (item.type === "addon") {
        // Create a brand-new add-on under the garment, then auto-add it.
        const created = await createTableRow<{ id: string }>(
          "garment_addons",
          { ...payload, garment_id: garmentId },
        );
        const newAddon: AIAddon = {
          addon_id: created.id,
          addon_label: item.name,
          addon_variation_id: null,
          addon_variation_label: null,
          placement: null,
        };
        const nextAddons = [
          ...currentAddons.filter((a) => a.addon_id !== created.id),
          newAddon,
        ];
        setCurrentAddons(nextAddons);
        pushDesignUp(currentSelections, nextAddons);
      } else if (item.type === "addon_variation") {
        // Create an add-on variation under its add-on, then auto-select it.
        const created = await createTableRow<{ id: string }>(
          "garment_addon_variations",
          { ...payload, addon_id: item.parent_id },
        );
        const newAddon: AIAddon = {
          addon_id: item.parent_id!,
          addon_label: item.parent_label,
          addon_variation_id: created.id,
          addon_variation_label: item.name,
          placement: null,
        };
        const nextAddons = [
          ...currentAddons.filter((a) => a.addon_id !== item.parent_id),
          newAddon,
        ];
        setCurrentAddons(nextAddons);
        pushDesignUp(currentSelections, nextAddons);
      }
      setResolvedUnknowns((prev) => new Set(prev).add(idx));
    } catch (e) {
      setError(
        e instanceof Error
          ? `Failed to add to catalog: ${e.message}`
          : "Failed to add to catalog",
      );
    }
  };

  const handleDiscardUnknown = (idx: number) => {
    setDiscardedUnknowns((prev) => new Set(prev).add(idx));
  };

  // ── Confirm design ───────────────────────────────────────────────────

  const handleConfirm = async () => {
    if (draftMode) {
      const draftItems = aiResultToDraftItems(currentSelections, currentAddons);
      onDraftChange?.(draftItems, lastImageUrl ?? "");
      return;
    }

    if (!garmentOrderId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await applyDesignFromAI(
        garmentOrderId,
        currentSelections,
        currentAddons,
      );
      onSaveComplete?.(res.items);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to apply design");
    } finally {
      setLoading(false);
    }
  };

  // ── Reset conversation ───────────────────────────────────────────────

  const handleReset = async () => {
    // Only clear/rotate the thread when this instance owns it. For a shared
    // (externally-owned) thread, just clear local state so the server-side
    // conversation is preserved for the sibling instance.
    if (!threadId) {
      await clearDesignThread(threadIdRef.current).catch(() => {});
      threadIdRef.current = makeId();
    }
    setMessages([]);
    setCurrentSelections([]);
    setCurrentAddons([]);
    setCurrentUnknowns([]);
    setLastImageUrl(null);
    setResolvedUnknowns(new Set());
    setDiscardedUnknowns(new Set());
    setError(null);
    setTextDraft("");
    setPendingImage(null);
    if (pendingImagePreview) {
      URL.revokeObjectURL(pendingImagePreview);
      setPendingImagePreview(null);
    }
  };

  const hasResult = currentSelections.length > 0 || currentAddons.length > 0;
  const canSend = (textDraft.trim() || pendingImage) && !loading;

  // Whether the conversation has started (first message sent)
  const conversationStarted = messages.length > 0 || loading;

  // ── Composer (shared by the chat UI and the composerOnly branch) ────

  const renderComposer = () => (
    <div
      className="border-t border-hairline px-4 py-3"
      onDrop={handleDrop}
      onDragOver={(e) => e.preventDefault()}
    >
      {/* Pending image preview */}
      {pendingImagePreview && (
        <div className="mb-2 flex items-center gap-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={pendingImagePreview}
            alt="Pending"
            className="h-16 w-16 rounded-lg border border-hairline object-cover"
          />
          <button
            onClick={() => {
              URL.revokeObjectURL(pendingImagePreview);
              setPendingImagePreview(null);
              setPendingImage(null);
            }}
            className="rounded-md border border-hairline-strong px-2 py-1 text-[11px] text-muted hover:bg-mist-navy"
          >
            Remove
          </button>
        </div>
      )}

      <div className="flex items-end gap-2">
        {/* Upload button */}
        <button
          onClick={() => fileInputRef.current?.click()}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-hairline-strong bg-chalk-white text-muted transition hover:border-tape hover:text-tape"
          title="Upload image"
        >
          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          onChange={handleInputChange}
          className="hidden"
        />

        {/* Text input */}
        <div className="flex flex-1 items-end gap-1 rounded-lg border border-hairline-strong bg-chalk-white px-2 py-1">
          <textarea
            ref={textInputRef}
            value={textDraft}
            onChange={(e) => setTextDraft(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Describe or refine the design…"
            rows={1}
            className="max-h-24 flex-1 resize-none bg-transparent py-1 text-xs text-ink placeholder:text-muted focus:outline-none"
          />

          {/* Mic button */}
          {supportsSpeech && (
            <button
              onClick={recording ? stopRecording : startRecording}
              className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md transition ${
                recording
                  ? "bg-red-500 text-chalk-white animate-pulse"
                  : "text-muted hover:text-tape hover:bg-mist-navy"
              }`}
              title={recording ? "Stop recording" : "Voice input"}
            >
              {recording ? (
                <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="currentColor">
                  <rect x="6" y="6" width="12" height="12" rx="2" />
                </svg>
              ) : (
                <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3z" strokeLinecap="round" strokeLinejoin="round" />
                  <path d="M19 10v2a7 7 0 01-14 0v-2M12 19v4M8 23h8" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              )}
            </button>
          )}
        </div>

        {/* Send button */}
        <button
          onClick={() => sendMessage()}
          disabled={!canSend}
          className="flex h-9 shrink-0 items-center justify-center rounded-lg bg-ink-navy px-3 text-xs font-medium text-chalk-white transition hover:bg-ink-navy/90 disabled:opacity-40"
        >
          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>

      <div className="mt-1 text-center text-[10px] text-muted">
        Upload a photo · type instructions · use mic · Enter to send
      </div>
    </div>
  );

  // ─── Render: Composer-only (parent owns the editor) ──────────────────

  if (composerOnly) {
    return (
      <div className="rounded-xl border border-tape/40 bg-tape/5">
        {error && (
          <div className="m-3 rounded-md border border-red-200 bg-red-50 px-3 py-1.5 text-xs text-red-700">
            {error}
          </div>
        )}
        {loading && (
          <div className="m-3 flex items-center gap-2 rounded-md border border-tape/40 bg-tape/5 py-2 text-xs text-muted">
            <div className="h-3 w-3 animate-spin rounded-full border-2 border-tape border-t-transparent" />
            Refining design…
          </div>
        )}
        {renderComposer()}
        <div className="px-4 pb-3 text-center">
          <button
            onClick={handleReset}
            className="text-[10px] text-muted hover:underline"
          >
            Start over
          </button>
        </div>
      </div>
    );
  }

  // ─── Render: Pre-chat upload zone (original UI) ──────────────────────

  if (!conversationStarted) {
    return (
      <div className="rounded-xl border border-tape/40 bg-tape/5 p-4 md:p-5">
        {/* Header */}
        <div className="mb-4">
          <div className="text-xs font-medium uppercase tracking-wide text-muted">
            AI Design Prefill
          </div>
          <div className="text-sm text-muted">
            Upload a reference image — Gemini 3.6 Flash will detect design elements
            and map them to your catalog.
          </div>
        </div>

        {error && (
          <div className="mb-3 rounded-md border border-red-200 bg-red-50 px-3 py-1.5 text-xs text-red-700">
            {error}
          </div>
        )}

        <div
          onDrop={handleDrop}
          onDragOver={(e) => e.preventDefault()}
          onClick={() => fileInputRef.current?.click()}
          className="flex cursor-pointer items-center justify-center gap-4 rounded-lg border-2 border-dashed border-hairline-strong bg-chalk-white px-4 py-5 transition hover:border-tape hover:bg-tape/5"
        >
          {pendingImagePreview ? (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={pendingImagePreview}
                alt="Reference preview"
                className="max-h-40 w-auto max-w-[55%] shrink-0 rounded-lg border border-hairline object-contain"
              />
              <div className="flex flex-1 flex-col items-start gap-2">
                <div className="text-xs text-muted line-clamp-2">
                  {pendingImage?.name} — click image to change
                </div>
                {/* Actions sit beside the image so they're never pushed below
                    the fold after upload (fixes "Analyze hidden behind scroll"). */}
                <div
                  className="flex items-center gap-2"
                  onClick={(e) => e.stopPropagation()}
                >
                  <button
                    onClick={() => {
                      if (pendingImagePreview) URL.revokeObjectURL(pendingImagePreview);
                      setPendingImagePreview(null);
                      setPendingImage(null);
                      setError(null);
                    }}
                    className="rounded-lg border border-hairline-strong px-3 py-1.5 text-xs font-medium text-muted hover:bg-mist-navy"
                  >
                    Clear
                  </button>
                  <button
                    onClick={() => sendMessage()}
                    disabled={loading}
                    className="rounded-lg bg-ink-navy px-4 py-1.5 text-xs font-medium text-chalk-white transition hover:bg-ink-navy/90 disabled:opacity-50"
                  >
                    Analyze with AI
                  </button>
                </div>
              </div>
            </>
          ) : (
            <div className="flex flex-col items-center gap-2">
              <svg
                className="h-10 w-10 text-hairline-strong"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
              >
                <path
                  d="M12 16V4M12 4l-4 4M12 4l4 4"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <rect x="3" y="16" width="18" height="4" rx="1" />
              </svg>
              <div className="text-sm font-medium text-ink-navy">
                Drop a design image here
              </div>
              <div className="text-xs text-muted">
                or click to browse — JPG, PNG, WebP · max 12MB
              </div>
            </div>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            onChange={handleInputChange}
            className="hidden"
          />
        </div>

        {loading && (
          <div className="mt-3 flex items-center justify-center gap-2 rounded-lg border border-tape/40 bg-tape/5 py-3">
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-tape border-t-transparent" />
            <span className="text-xs text-muted">
              Analyzing image with Gemini 3.6 Flash…
            </span>
          </div>
        )}

        {onCancel && (
          <div className="mt-3 flex justify-start">
            <button
              onClick={onCancel}
              className="rounded-lg border border-hairline-strong px-3 py-1.5 text-xs font-medium text-muted hover:bg-mist-navy"
            >
              Cancel
            </button>
          </div>
        )}
      </div>
    );
  }

  // ─── Render: Chat UI (after first message) ───────────────────────────

  return (
    <div className="flex h-full flex-col rounded-xl border border-tape/40 bg-tape/5">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-hairline px-4 py-2.5">
        <div>
          <div className="text-xs font-medium uppercase tracking-wide text-muted">
            AI Design Assistant
          </div>
          <div className="text-[11px] text-muted">
            Upload more photos or type instructions — iterate until perfect.
          </div>
        </div>
        <button
          onClick={handleReset}
          className="rounded-md border border-hairline-strong px-2 py-1 text-[11px] text-muted hover:bg-mist-navy"
        >
          New Chat
        </button>
      </div>

      {error && (
        <div className="mx-4 mt-2 rounded-md border border-red-200 bg-red-50 px-3 py-1.5 text-xs text-red-700">
          {error}
        </div>
      )}

      {/* Messages area */}
      <div
        className="flex-1 space-y-3 overflow-y-auto px-4 py-3"
        style={{ minHeight: "200px", maxHeight: "450px" }}
      >
        {messages.map((msg) =>
          msg.role === "user" ? (
            <div key={msg.id} className="flex justify-end">
              <div className="flex max-w-[80%] flex-col items-end gap-1">
                {msg.imageUrl && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={msg.imageUrl}
                    alt="Upload"
                    className="max-h-32 rounded-lg border border-hairline object-cover"
                  />
                )}
                {msg.text && (
                  <div className="rounded-lg rounded-br-sm bg-ink-navy px-3 py-1.5 text-xs text-chalk-white">
                    {msg.text}
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div key={msg.id} className="flex justify-start">
              <div className="max-w-[90%] space-y-1.5">
                <div className="rounded-lg rounded-bl-sm border border-hairline bg-chalk-white px-3 py-2 text-xs text-ink">
                  {msg.message}
                </div>
                {/* Compact selection chips */}
                {(msg.selections.length > 0 || msg.addons.length > 0) && (
                  <div className="flex flex-wrap gap-1">
                    {msg.selections.map((sel, i) => (
                      <span
                        key={`s-${i}`}
                        className="rounded border border-green-200 bg-green-50 px-1.5 py-0.5 text-[10px] text-green-800"
                      >
                        {sel.component_label ?? sel.component_id}:{" "}
                        {sel.variation_label ?? sel.variation_id}
                        {sel.variation_type_label
                          ? ` → ${sel.variation_type_label}`
                          : ""}
                      </span>
                    ))}
                    {msg.addons.map((addon, i) => (
                      <span
                        key={`a-${i}`}
                        className="rounded border border-blue-200 bg-blue-50 px-1.5 py-0.5 text-[10px] text-blue-800"
                      >
                        {addon.addon_label ?? addon.addon_id}
                        {addon.addon_variation_label
                          ? ` → ${addon.addon_variation_label}`
                          : ""}
                      </span>
                    ))}
                  </div>
                )}
                {/* Unknown items inline */}
                {msg.unknown_items.length > 0 && (
                  <div className="space-y-1">
                    {msg.unknown_items.map((item, idx) => (
                      <span
                        key={`u-${idx}`}
                        className={`mr-1 inline-block rounded border px-1.5 py-0.5 text-[10px] ${
                          UNKNOWN_TYPE_COLORS[item.type] ??
                          "border-amber-300 bg-amber-100 text-amber-800"
                        }`}
                      >
                        ⚠ {item.name}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ),
        )}

        {loading && (
          <div className="flex justify-start">
            <div className="flex items-center gap-2 rounded-lg rounded-bl-sm border border-hairline bg-chalk-white px-3 py-2">
              <div className="h-3 w-3 animate-spin rounded-full border-2 border-tape border-t-transparent" />
              <span className="text-xs text-muted">Analyzing…</span>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Current selections summary + unknown items */}
      {hasResult && (
        <div className="border-t border-hairline px-4 py-2.5">
          {/* Selections */}
          <div className="mb-1.5 text-[10px] font-medium uppercase tracking-wide text-muted">
            Current Design ({currentSelections.length} selections ·{" "}
            {currentAddons.length} add-ons
            {currentUnknowns.length > 0 &&
              ` · ${currentUnknowns.length} unknown`}
            )
          </div>
          <div className="flex flex-wrap gap-1">
            {currentSelections.map((sel, i) => (
              <span
                key={`cs-${i}`}
                className="rounded border border-green-200 bg-green-50 px-1.5 py-0.5 text-[10px] text-green-800"
              >
                {sel.component_label ?? sel.component_id}:{" "}
                {sel.variation_label ?? sel.variation_id}
                {sel.variation_type_label
                  ? ` → ${sel.variation_type_label}`
                  : ""}
              </span>
            ))}
            {currentAddons.map((addon, i) => (
              <span
                key={`ca-${i}`}
                className="rounded border border-blue-200 bg-blue-50 px-1.5 py-0.5 text-[10px] text-blue-800"
              >
                {addon.addon_label ?? addon.addon_id}
                {addon.addon_variation_label
                  ? ` → ${addon.addon_variation_label}`
                  : ""}
              </span>
            ))}
          </div>

          {/* Unknown items (actionable) */}
          {currentUnknowns.length > 0 && (
            <div className="mt-2 space-y-1.5">
              {currentUnknowns.map((item, idx) => {
                // #2: only show unknowns whose parent resolves in the catalog.
                if (!isActionableUnknown(item)) return null;
                if (discardedUnknowns.has(idx)) return null;
                const resolved = resolvedUnknowns.has(idx);
                return (
                  <div
                    key={`unk-${idx}`}
                    className={`flex items-center gap-2 rounded-md border px-2 py-1.5 ${
                      resolved
                        ? "border-green-300 bg-green-50"
                        : "border-amber-300 bg-amber-50"
                    }`}
                  >
                    <span
                      className={`rounded-full border px-1.5 py-0.5 text-[9px] font-medium ${
                        UNKNOWN_TYPE_COLORS[item.type] ??
                        "border-amber-300 bg-amber-100 text-amber-800"
                      }`}
                    >
                      {UNKNOWN_TYPE_LABELS[item.type] ?? "Unknown"}
                    </span>
                    <span className="flex-1 text-[11px] text-ink">
                      {item.name}
                      {item.parent_label && (
                        <span className="text-muted">
                          {" "}
                          (under {item.parent_label})
                        </span>
                      )}
                    </span>
                    {resolved ? (
                      <span className="text-[10px] text-green-600">
                        ✓ Added
                      </span>
                    ) : (
                      <>
                        <button
                          onClick={() => handleAddUnknownToCatalog(idx)}
                          className="rounded bg-ink-navy px-1.5 py-0.5 text-[10px] text-chalk-white hover:bg-ink-navy/90"
                        >
                          + Add
                        </button>
                        <button
                          onClick={() => handleDiscardUnknown(idx)}
                          className="rounded border border-hairline-strong px-1.5 py-0.5 text-[10px] text-muted hover:bg-mist-navy"
                        >
                          Discard
                        </button>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* Confirm button */}
          <div className="mt-2.5 flex justify-end gap-2">
            {onCancel && (
              <button
                onClick={onCancel}
                className="rounded-lg border border-hairline-strong px-3 py-1.5 text-xs font-medium text-muted hover:bg-mist-navy"
              >
                Cancel
              </button>
            )}
            <button
              onClick={handleConfirm}
              disabled={loading}
              className="rounded-lg bg-green-600 px-4 py-1.5 text-xs font-medium text-chalk-white transition hover:bg-green-700 disabled:opacity-50"
            >
              {draftMode ? "Confirm Design" : "Apply to Order"}
            </button>
          </div>
        </div>
      )}

      {/* Composer */}
      {renderComposer()}
    </div>
  );
}
