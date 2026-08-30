"use client";

/**
 * LibraryDetailPage — the design detail as a FULL PAGE (like the create
 * flow), replacing the old stacked bottom sheet on Explore.
 *
 * Owns everything the sheet used to: detail fetch, login gate for the
 * CTAs, the "Review your selection" order preview and the virtual try-on.
 * The host (route) renders it below its back-button header and passes the
 * library id.
 */

import { useCallback, useEffect, useState } from "react";

import { LoginGateSheet } from "@/components/auth/LoginGateSheet";
import { TryOnSheet } from "@/components/tryon/TryOnSheet";
import { LibraryOrderPreviewSheet } from "@/components/library/LibraryOrderPreviewSheet";
import {
  DetailBody,
  DetailFooter,
  DetailSkeleton,
  ListError,
} from "@/components/library/LibraryDetailParts";
import { libraryApi } from "@/lib/api";
import { useAuthHydrated, useAuthStore } from "@/lib/auth-store";
import { strings } from "@/lib/strings";
import { track } from "@/lib/analytics";
import type { LibraryDetailOut } from "@/types/api";

export function LibraryDetailPage({
  libraryId,
  onTitle,
}: {
  libraryId: string;
  /** Design display name once loaded — the host header shows it. */
  onTitle?: (name: string | null) => void;
}) {
  const sessionType = useAuthStore((s) => s.sessionType);
  const user = useAuthStore((s) => s.user);
  const authHydrated = useAuthHydrated();
  const isLoggedIn = sessionType === "user";
  // Logged in but still owing name/gender — the gate collects these too.
  const profileIncomplete = isLoggedIn && (!user?.name || !user?.gender);

  const [detail, setDetail] = useState<LibraryDetailOut | null>(null);
  const [detailLoading, setDetailLoading] = useState(true);
  const [detailError, setDetailError] = useState<string | null>(null);

  const [tryOnOpen, setTryOnOpen] = useState(false);
  const [tryOnDesignUrl, setTryOnDesignUrl] = useState<string | null>(null);
  const [tryOnDesignTitle, setTryOnDesignTitle] = useState<string | undefined>(
    undefined,
  );
  const [orderPreviewOpen, setOrderPreviewOpen] = useState(false);
  const [showLoginGate, setShowLoginGate] = useState(false);
  // The CTA that hit the login gate — re-run by the effect below on verify.
  const [actionAfterLogin, setActionAfterLogin] = useState<"order" | "tryon" | null>(
    null,
  );

  /* ── Fetch detail ─────────────────────────────────────────────────────── */
  useEffect(() => {
    if (!libraryId) return;
    let cancelled = false;
    (async () => {
      setDetailLoading(true);
      setDetailError(null);
      onTitle?.(null);
      try {
        const d = await libraryApi.getLibraryDetail(libraryId);
        if (!cancelled) {
          setDetail(d);
          onTitle?.(d.labels?.en ?? null);
        }
      } catch (err) {
        if (!cancelled) {
          setDetailError(
            err instanceof Error ? err.message : strings.style.detailError,
          );
          onTitle?.(null);
        }
      } finally {
        if (!cancelled) setDetailLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [libraryId, onTitle]);

  /* ── Login gate: both footer CTAs need a user session ─────────────────── */
  const gate = useCallback(
    (action: "order" | "tryon") => {
      if (authHydrated && (!isLoggedIn || profileIncomplete)) {
        setActionAfterLogin(action);
        setShowLoginGate(true);
        return true;
      }
      return false;
    },
    [authHydrated, isLoggedIn, profileIncomplete],
  );

  const openTryOn = useCallback(() => {
    if (gate("tryon")) return;
    if (!detail?.hero_image_url) return;
    setTryOnDesignUrl(detail.hero_image_url);
    setTryOnDesignTitle(detail.labels?.en ?? undefined);
    setTryOnOpen(true);
  }, [detail, gate]);

  const startOrderPreview = useCallback(() => {
    if (gate("order")) return;
    setOrderPreviewOpen(true);
  }, [gate]);

  // Analytics only — creation, tweak application and routing live in the
  // preview sheet.
  const handleOrderCreated = useCallback(
    (orderId: string) => {
      if (!detail) return;
      track({
        event: "library_ordered",
        library_id: detail.id,
        order_id: orderId,
      });
    },
    [detail],
  );

  // Gate continuation: the gate's verify flips sessionType in the store;
  // this effect re-runs the blocked CTA once the session is complete.
  // Dismissing the gate without verifying clears the pending action. The
  // profileIncomplete guard holds the CTA back until the gate's profile
  // form saves.
  useEffect(() => {
    if (!actionAfterLogin || !isLoggedIn || profileIncomplete) return;
    const action = actionAfterLogin;
    setActionAfterLogin(null);
    if (action === "order") startOrderPreview();
    else openTryOn();
  }, [actionAfterLogin, isLoggedIn, profileIncomplete, startOrderPreview, openTryOn]);

  return (
    <div className="flex h-full flex-col bg-warm-sand">
      {/* Scrollable detail body */}
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pt-3">
        {detailLoading ? (
          <DetailSkeleton />
        ) : detailError ? (
          <ListError
            message={detailError}
            onRetry={() => libraryId && window.location.reload()}
          />
        ) : detail ? (
          <DetailBody detail={detail} />
        ) : null}
      </div>

      {/* Sticky footer CTAs — "Try it on" secondary, "Order now" primary */}
      {detail?.hero_image_url && (
        <div className="flex-none border-t border-hairline bg-chalk-white px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3">
          <DetailFooter onTryOn={openTryOn} onOrder={startOrderPreview} />
        </div>
      )}

      {/* Order preview — "Review your selection"; apply creates the order */}
      <LibraryOrderPreviewSheet
        open={orderPreviewOpen}
        onClose={() => setOrderPreviewOpen(false)}
        libraryId={detail?.id ?? libraryId}
        initialDetail={detail}
        onCreated={handleOrderCreated}
      />

      {/* Virtual try-on */}
      {tryOnDesignUrl && (
        <TryOnSheet
          open={tryOnOpen}
          onClose={() => {
            setTryOnOpen(false);
            setTimeout(() => {
              setTryOnDesignUrl(null);
              setTryOnDesignTitle(undefined);
            }, 250);
          }}
          designImageUrl={tryOnDesignUrl}
          designTitle={tryOnDesignTitle}
          garmentId={detail?.garment_id ?? undefined}
          libraryId={detail?.id ?? undefined}
        />
      )}

      {/* Login gate — verify success re-runs the blocked CTA via the effect */}
      <LoginGateSheet
        open={showLoginGate}
        onClose={() => {
          setShowLoginGate(false);
          setActionAfterLogin(null);
        }}
        onSuccess={() => setShowLoginGate(false)}
        title={
          actionAfterLogin === "order"
            ? strings.libraryOrder.orderGateTitle
            : strings.libraryOrder.tryOnGateTitle
        }
      />

    </div>
  );
}
