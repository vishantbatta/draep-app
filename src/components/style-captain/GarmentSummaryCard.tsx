"use client";

import { useEffect, useState } from "react";
import type {
  SCEntityBrief,
  SCGarmentOrder,
  SCSelection,
} from "@/lib/style-captain-api";
import { SpeakButton } from "./SpeakButton";

/**
 * GarmentSummaryCard — the per-garment gist card used on the measure-flow
 * start screens: reference images (hidden entirely when the garment order
 * carries none), a one-line description of every style selection, the
 * multilingual tab, and a speak-out-loud button.
 *
 * Assembled from the flow's existing design pieces (rounded-card/hairline,
 * mist-navy language chips) so it reads as part of the same screen family.
 */

const LANG_ORDER = ["en", "hi", "kn", "ta", "te"];
const LANG_TAGS: Record<string, string> = {
  en: "EN",
  hi: "हि",
  kn: "ಕನ",
  ta: "த",
  te: "తె",
};

/** Label for a catalog brief in `lang`, falling back en → any → slug. */
export function briefLabel(
  brief: SCEntityBrief | null,
  lang: string,
): string {
  if (!brief) return "";
  const labels = brief.labels ?? {};
  return (
    labels[lang] ??
    labels.en ??
    Object.values(labels).find((v) => v) ??
    brief.slug ??
    ""
  );
}

/** Sentence scaffolding per language for the gist. English is SVO ("X is
 *  Y"); hi/kn/ta/te are SOV — the copula follows the value — so the phrases
 *  split into a pre-copula ("is", "" for SOV) and post-copula ("है", "" for
 *  English). Unknown languages fall back to English. */
const GIST_PHRASES: Record<
  string,
  {
    /** "The {g} design is as follows: " */
    design: string;
    /** Copula placed before the value ("" for SOV languages). */
    pre: string;
    /** Copula placed after the value ("" for English). */
    post: string;
    /** Sentence terminator ("." / "।"). */
    period: string;
    /** "Additionally, " */
    additionally: string;
    /** List joiner for the final pair (" and "). */
    and: string;
    /** " is added" */
    addedOne: string;
    /** " are added" */
    addedMany: string;
  }
> = {
  en: {
    design: "The {g} design is as follows: ",
    pre: "is",
    post: "",
    period: ".",
    additionally: "Additionally, ",
    and: " and ",
    addedOne: " is added",
    addedMany: " are added",
  },
  hi: {
    design: "{g} का डिज़ाइन इस प्रकार है: ",
    pre: "",
    post: "है",
    period: "।",
    additionally: "इसके अलावा, ",
    and: " और ",
    addedOne: " जोड़ा गया है",
    addedMany: " जोड़े गए हैं",
  },
  kn: {
    design: "{g} ವಿನ್ಯಾಸ ಹೀಗಿದೆ: ",
    pre: "",
    post: "ಆಗಿದೆ",
    period: ".",
    additionally: "ಜೊತೆಗೆ, ",
    and: " ಮತ್ತು ",
    addedOne: " ಸೇರಿಸಲಾಗಿದೆ",
    addedMany: " ಸೇರಿಸಲಾಗಿದೆ",
  },
  ta: {
    design: "{g} வடிவமைப்பு பின்வருமாறு: ",
    pre: "",
    post: "ஆகும்",
    period: ".",
    additionally: "மேலும், ",
    and: " மற்றும் ",
    addedOne: " சேர்க்கப்பட்டுள்ளது",
    addedMany: " சேர்க்கப்பட்டுள்ளன",
  },
  te: {
    design: "{g} రూపకల్పన ఇలా ఉంది: ",
    pre: "",
    post: "ఉంది",
    period: ".",
    additionally: "అదనంగా, ",
    and: " మరియు ",
    addedOne: " జోడించబడింది",
    addedMany: " జోడించబడ్డాయి",
  },
};

/** Sentence-style selection gist, e.g. "The Blouse design is as follows:
 *  Blouse cut is Simple cut. … Additionally, Lining / Astar and Key Hole
 *  are added." Each variation item renders "{component} is {type}
 *  {variation}." and add-ons collect into one trailing sentence. Built in
 *  the active language. */
export function garmentGist(
  garmentOrder: Pick<SCGarmentOrder, "garment_labels" | "selections">,
  lang: string,
): string {
  const garmentLabel =
    (garmentOrder.garment_labels ?? {})[lang] ??
    (garmentOrder.garment_labels ?? {}).en ??
    Object.values(garmentOrder.garment_labels ?? {})[0] ??
    "Garment";

  const ph = GIST_PHRASES[lang] ?? GIST_PHRASES.en;
  const sentences: string[] = [];
  const addons: string[] = [];
  for (const sel of garmentOrder.selections ?? []) {
    if (sel.type === "variation") {
      const compLabel = briefLabel(sel.component, lang);
      const varLabel = briefLabel(sel.variation, lang);
      const typeLabel = briefLabel(sel.variation_type, lang);
      const value = [typeLabel, varLabel].filter(Boolean).join(" ");
      if (!value) continue;
      sentences.push(
        [compLabel, ph.pre, value, ph.post].filter(Boolean).join(" ") +
          ph.period,
      );
    } else if (sel.type === "add_on") {
      const label =
        briefLabel(sel.addon, lang) || briefLabel(sel.addon_variation, lang);
      if (label) addons.push(label);
    }
  }

  const parts: string[] = [];
  if (sentences.length > 0) {
    parts.push(ph.design.replace("{g}", garmentLabel) + sentences.join(" "));
  }
  if (addons.length > 0) {
    const list =
      addons.length === 1
        ? addons[0]
        : addons.slice(0, -1).join(", ") + ph.and + addons[addons.length - 1];
    parts.push(
      ph.additionally +
        list +
        (addons.length === 1 ? ph.addedOne : ph.addedMany) +
        ph.period,
    );
  }
  return parts.length > 0 ? parts.join(" ") : garmentLabel;
}

export function GarmentSummaryCard({
  label,
  garmentOrder,
}: {
  /** Display label with instance numbering ("Blouse 1"). */
  label: string;
  garmentOrder: SCGarmentOrder;
}) {
  const [activeLang, setActiveLang] = useState("en");
  const [zoomedUrl, setZoomedUrl] = useState<string | null>(null);

  // Languages available across the garment label + every selection label.
  const availableLangs = LANG_ORDER.filter((lang) => {
    const has = (b: SCEntityBrief | null) => Boolean(b?.labels?.[lang]);
    if ((garmentOrder.garment_labels ?? {})[lang]) return true;
    for (const sel of garmentOrder.selections ?? []) {
      if (
        has(sel.component) ||
        has(sel.variation) ||
        has(sel.variation_type) ||
        has(sel.addon) ||
        has(sel.addon_variation)
      ) {
        return true;
      }
    }
    return false;
  });
  useEffect(() => {
    if (availableLangs.length > 0 && !availableLangs.includes(activeLang)) {
      setActiveLang(availableLangs[0]);
    }
  }, [availableLangs, activeLang]);

  const gist = garmentGist(garmentOrder, activeLang);
  const assetUrls = (garmentOrder.asset_urls ?? []).filter(Boolean);

  return (
    <section className="overflow-hidden rounded-card border border-hairline bg-chalk-white shadow-card">
      {assetUrls.length > 0 && (
        <div className="flex gap-2 overflow-x-auto border-b border-hairline bg-mist-navy/30 p-2">
          {assetUrls.map((url) => (
            <button
              key={url}
              onClick={() => setZoomedUrl(url)}
              className="tap h-28 w-28 shrink-0 overflow-hidden rounded-card border border-hairline bg-mist-navy"
              aria-label="View image"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={url}
                alt={label}
                className="h-full w-full object-cover"
                loading="lazy"
              />
            </button>
          ))}
        </div>
      )}

      <div className="space-y-2.5 px-4 py-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-eyebrow uppercase tracking-wider text-accent-text">
              {label}
            </p>
            <p className="text-body font-medium text-ink-navy">{gist}</p>
          </div>
          <SpeakButton text={gist} lang={activeLang} />
        </div>

        {availableLangs.length > 1 && (
          <div className="flex gap-1 rounded-pill bg-mist-navy p-0.5">
            {availableLangs.map((lang) => {
              const isActive = lang === activeLang;
              return (
                <button
                  key={lang}
                  onClick={() => setActiveLang(lang)}
                  className={`tap flex-1 rounded-pill px-3 py-1 text-caption font-semibold uppercase tracking-wide transition ${
                    isActive
                      ? "bg-chalk-white text-ink-navy shadow-card"
                      : "text-muted"
                  }`}
                >
                  {LANG_TAGS[lang] ?? lang}
                </button>
              );
            })}
          </div>
        )}

        {garmentOrder.user_note && (
          <p className="text-caption italic text-muted">
            “{garmentOrder.user_note}”
          </p>
        )}
      </div>

      {zoomedUrl && (
        <button
          aria-label="Close image"
          onClick={() => setZoomedUrl(null)}
          className="fixed inset-0 z-[60] flex items-center justify-center bg-ink-navy/80 p-4 backdrop-blur-sm"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={zoomedUrl}
            alt={label}
            className="max-h-[85vh] max-w-full rounded-card object-contain shadow-2xl"
          />
        </button>
      )}
    </section>
  );
}
