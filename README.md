# draep booking — V0

Customer-facing mobile-web booking flow for [Draep](https://draep.com):
Landing → blouse design (5 critical choices + fit + add-ons) → review →
contact → pay → confirmed home-visit slot.

Built per **Frontend Spec V0** with the **Draep Brand Book** as the normative
source for every visual, copy, and motion decision.

## Quickstart

Requires Node 22 (nvm use) and pnpm (corepack).

```bash
nvm use 22
pnpm install
pnpm dev      # http://localhost:3000
```

Open Chrome DevTools → mobile viewport (390×844 recommended) to test.

## Scripts

| Command          | Description                              |
| ---------------- | ---------------------------------------- |
| `pnpm dev`       | Start Next.js dev server                 |
| `pnpm build`     | Production build                         |
| `pnpm start`     | Serve the production build               |
| `pnpm lint`      | ESLint (next/core-web-vitals)            |
| `pnpm typecheck` | TypeScript strict typecheck              |

## Architecture at a glance

- **Next.js 14** App Router, TypeScript, mobile-first.
- **Tailwind CSS** extends colors *only* from CSS vars in
  `src/styles/tokens.css` — no ad-hoc hex values anywhere else.
- **Zustand + persist** holds the `BookingDraft`; a lightweight `draep_draft`
  cookie (exists+not-expired flag) is read by `src/middleware.ts` to gate
  protected routes without a one-frame flash.
- **`lib/pricing.ts`** is the single source of truth for every ₹ amount.
- **`lib/catalog.ts`** is a verbatim port of spec §7 — components never
  hard-code options.
- **`components/preview/BlousePreview.tsx`** is a layered SVG with a
  `pendingLayer` slot for 50% ghost-preview and Curl In on apply.
- **Framer Motion** drives the four brand motion patterns (Tape Unroll, Tick,
  Curl In, Rivet Pulse). `prefers-reduced-motion` is respected automatically.

## Mocked integrations (V0)

- **Payments** (`/pay`): 1.5s simulated gateway round-trip. Real Razorpay
  drops in behind `pay()` without touching call sites.
- **Maps** (`MapPinPicker`): browser geolocation + static SVG map. Real Google
  Maps SDK slots in unchanged.
- **Pricing values** (`lib/pricing-config.ts`): placeholders per spec §13 —
  swap to real rate card before launch.

## Open items from spec §13 still flagged

- Pricing sheet (real numbers)
- Defaults for Tying / Shoulder / Sleeve / Neck side (pending product)
- Confirm CSV "Button Button" = Back button
- Moti-work options/placements/pricing
- OTP verification in V0
- Final 3-hour slot windows
- Service-area polygon source
- Full visualization asset kit (V0 uses simplified brand-styled SVG layers)
