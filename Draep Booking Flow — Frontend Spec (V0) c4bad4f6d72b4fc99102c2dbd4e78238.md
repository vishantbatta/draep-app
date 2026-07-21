# Draep Booking Flow — Frontend Spec (V0)

<aside>
🧵

**Frontend implementation spec for the V0 booking flow.** Audience: frontend engineer. Sources: [Booking Flow](https://app.notion.com/p/Booking-Flow-3a0eb798c452801fa607d2e9eb63eb9d?pvs=21) (user journey) and [Draep Brand Book](https://app.notion.com/p/Draep-Brand-Book-39feb798c45280ba8c96f545eb290417?pvs=21) (all visual tokens). **The Brand Book is normative** — no visual, copy, or motion decision may deviate from it; where this spec is silent, follow the Brand Book; where they conflict, the Brand Book wins (flag it, don't improvise). Every PR must pass the brand compliance checklist in §14. Status: Draft v1.1 · Owner: Vishant Batta · July 17, 2026

</aside>

## 1. Scope & goals

- Build the **customer-facing booking web app** for Draep V0: Landing → Style selection → Review → Contact → Pay → Confirmation.
- **Core product principle: zero-decision default path.** Every field arrives prefilled with a default. A user must be able to complete the entire flow by only tapping *Next* on every screen. Editing is always possible, never required.
- Out of scope for V0: login/accounts, order tracking, tailor/captain apps, catalogue photos beyond option illustrations.
- Mobile-first (target 360–430px viewports); must be usable on desktop with a centered max-width 480px column.

## 2. Tech assumptions

- SPA or SSR web app (React recommended); single-page checkout wizard with client-side routing between steps.
- State kept in a single `bookingDraft` object (see §8), persisted to `localStorage` so a refresh never loses progress.
- Payments via UPI intent through the payment gateway (Razorpay or similar — confirm with backend). Frontend only needs: create order → open checkout → handle success/failure callbacks.
- Map pin via Google Maps JS SDK (place autocomplete + draggable pin).
- No backend contract is final yet — build against the typed catalog in §7 as a local config file so options/prices are data-driven, not hard-coded in components.

## 3. Design tokens — from the Brand Book

All values below are canonical, taken from [Draep Brand Book](https://app.notion.com/p/Draep-Brand-Book-39feb798c45280ba8c96f545eb290417?pvs=21). Implement as CSS variables / theme tokens.

### 3.1 Colors

| Token | Hex | Usage in this flow |
| --- | --- | --- |
| `ink-navy` | #083068 | Headlines, body text, secondary button outline |
| `draep-orange` | #F89010 | Selected states, brand accents, active ticks |
| `ember` | #D06010 | Hover/pressed states |
| `tape-silver` | #D8D8D8 | Dividers, inactive strokes |
| `chalk-white` | #FFFFFF | Backgrounds, text on gradient |
| `navy-interactive` | #3A5C8F | Links, tappable secondary text |
| `navy-disabled` | #9FB3CF | Disabled states |
| `navy-bg` | #EAF0F8 | Navy-tinted backgrounds |
| `orange-highlight` | #FBB95E | Highlights |
| `orange-fill` | #FDE3BF | Subtle selected fills (e.g. selected card background) |
| `warm-bg` | #FFF6EA | Warm section backgrounds (e.g. add-on sections) |
| `success` | #16A34A | Payment confirmed, booking confirmed |
| `warning` | #EAB308 | Action needed |
| `error` | #DC2626 | Validation errors, payment failure |
| `info` | #2563EB | Tips, status notes |
- **Tape Gradient** (hero surfaces, primary buttons, progress fill): `linear-gradient(135deg, #F89010, #E87810, #D06010, #A85010)`. Never on body text.
- **Usage ratio 60/30/10:** white + warm neutrals 60%, navy 30%, orange 10%. Orange is the spice, not the base.
- Body text is always Ink Navy on white. Never set small text in orange on white. On orange/gradient surfaces use white text ≥16px bold, or Ink Navy.
- Every key screen should contain both navy and orange ("the brand handshake").

### 3.2 Typography

| Role | Font | Sizes |
| --- | --- | --- |
| Headings | Poppins SemiBold/Bold, sentence case only | Display 32/38 · H1 24/30 · H2 20/26 · H3 17/24 |
| Body | Inter Regular/Medium | Body 15/22 · Caption 13/18 |
| Prices, sizes, order IDs, phone | IBM Plex Mono, **tabular numerals always** | Data 14/20 |
- Headings in Ink Navy; **max one orange highlight word per headline**.
- All ₹ amounts anywhere in the flow render in IBM Plex Mono.

### 3.3 Shape, elevation, components

- **Radius:** 12px cards · fully-pill buttons. No sharp corners anywhere.
- **Primary button:** Tape Gradient fill, white bold label, pill; pressed state shifts toward Ember.
- **Secondary button:** 1.5px Ink Navy outline, navy label, transparent fill, pill.
- **Shadow:** single elevation level — navy @ 8% opacity, soft and warm.
- **Dividers:** 1px Tape Silver, optionally with the tick pattern.
- **Form fields with measurements/numbers** (cup size, phone): mono numerals + unit labels.

### 3.4 Motion

| Name | Spec | Use here |
| --- | --- | --- |
| Tape Unroll | 600ms ease-out | Progress bar fill on step change; panels extending |
| Tick | 200ms stepped (not smooth) | Price bar amount changes; counters |
| Curl In | 500ms ease-in-out, subtle arc | Option cards & screens entering |
| Rivet Pulse | 2s gentle pulse | Current step dot in the progress tape |
- Budget: 200ms micro-interactions · 400–600ms transitions · **never exceed 800ms**. Respect `prefers-reduced-motion` (disable Curl In/Unroll, keep instant state changes).

### 3.5 Logo usage (mandatory)

- **Lockups:** primary (symbol + wordmark) in the Landing header · **symbol only** for favicon and app icon (white curl on a Tape Gradient tile) · **reversed** (white wordmark + full-color symbol) on Ink Navy surfaces. The wordmark is always lowercase "draep".
- **Clearspace:** margin equal to the height of the wordmark's "d" bowl on all sides. **Minimum sizes:** symbol ≥24px tall on screen; primary lockup ≥96px wide — enforce as CSS min-widths.
- **Hard don'ts (review fails):** never recolor the tape or flatten its gradient to a single orange · never set the wordmark in another typeface or uppercase · no rotation, outlines, shadows, or stretching · never place the full-color logo on orange or busy photographic backgrounds (use reversed on navy, or a white holding shape) · ticks never appear detached from the tape.

### 3.6 Voice & tone — applies to every UI string

- **Confident, not boastful:** exact promises with real numbers — "Your Style Captain will arrive Saturday, 6–9 PM", never "soon!" or "super-fast!".
- **Warm, not cutesy:** no emojis in flow/transactional copy, no mascot voice.
- **Precise, not jargon-heavy:** dates, sizes, and prices over vague claims — "Measured once, remembered forever." not "AI-powered measurement cloud solution."
- Tailors are **"master tailors"** and partners — never "vendors" or "labor".
- Sentence case everywhere, including headings and buttons. Keep all copy in a single `strings.ts` module so tone can be reviewed in one place.

### 3.7 Iconography & graphic motifs

- **Icons:** 2px rounded strokes, Ink Navy by default, Draep Orange for the active state; corners rounded to match the tape's curve. No off-the-shelf icon set that breaks this style.
- **Tick marks** (from the tape) are the core motif — list bullets, section dividers, progress steps.
- **The rivet dot** terminates lines and timelines — e.g. the last step of "how it works" and the slot-confirmation timeline.
- **The curl:** circular crops and curled frames for imagery and stat highlights on Landing.
- **Photography** (Landing only): warm natural light, real homes and real hands — tape, chalk, fabric textures; never sterile studio mannequins.

## 4. Routes & flow map

| # | Route | Screen |
| --- | --- | --- |
| 0 | `/` | Landing |
| 1 | `/design/cut` | Blouse cut (critical 1/5) |
| 2 | `/design/length` | Blouse length (critical 2/5) |
| 3 | `/design/front-neck` | Front neck cut (critical 3/5) |
| 4 | `/design/back` | Back cut (critical 4/5) |
| 5 | `/design/tying` | Tying mechanism (critical 5/5) |
| 6 | `/design/fit` | Fit & structure (single screen: shoulder, sleeve, neck side) |
| 7 | `/design/add-ons` | Material add-ons (single screen) |
| 8 | `/review` | Review + price breakdown |
| 9 | `/contact` | Phone → name, address, map pin |
| 10 | `/pay` | UPI payment |
| 11 | `/confirmed` | Confirmation + 3-hour home-visit slot picker |
- Back navigation (browser back and header back arrow) must preserve all selections.
- Deep-linking from Review: `/design/back?from=review` — after saving, return to `/review`, scrolled to the edited row.
- Direct URL entry to a later step with an empty draft redirects to `/`.

## 5. Global UI patterns

### 5.1 The tape progress header (all `/design/*`, `/review`)

- A horizontal **measuring-tape progress bar**: tick marks for the 7 design steps, a **rivet dot** on the current step (Rivet Pulse), gradient fill behind completed ticks (Tape Unroll on advance).
- Left: back chevron (navy). Right: step counter in mono, e.g. `3/7`.

### 5.2 Prefilled defaults

- Every category renders with its default already selected and marked with a small **"Default" chip** (`orange-fill` background, navy caption text).
- The primary CTA is **always enabled** — there is no state where the user is blocked on a design screen.
- Changing a selection replaces it (radio behavior within a category).

### 5.3 Sticky price bar (all `/design/*` screens + `/review`)

- Fixed bottom bar, white, top divider in Tape Silver, single shadow.
- Left: `Total ₹1,240` in IBM Plex Mono (Tick animation on change) + caption "incl. add-ons". Tapping the amount opens a bottom-sheet price breakdown (same component as Review's breakdown).
- Right: primary pill button — `Next` on design screens, `Continue` on Review.
- **Pricing values are not final** — read every price from the catalog config (§7); render `Included` for zero-price options.

### 5.4 Option selection components — every option is visual

<aside>
👁

**Hard rule: nothing is selectable as plain text.** Every option, sub-option, placement, size, and add-on must show a visualization of what it does to the blouse at the moment the user is trying to add it — via its own illustration **and** a live ghost-preview on the `BlousePreview` (§5.5).

</aside>

- **OptionCard** (critical screens): illustration (mandatory — never label-only) + label, 12px radius, 2-column grid. States: default (white, silver 1px border) / selected (1.5px orange border, `orange-fill` bg, orange tick badge) / pressed (Ember border). Selection is instant — no confirm.
- **VisualChip** (all chips — sub-options, fit categories, placements, sizes): pill with a 24px thumbnail glyph + label. Silver outline default; orange fill + white text/glyph when selected. E.g. the U-shape, V-shape, Round, and Square chips each draw their own neckline shape.
- **SubOptionChips**: when a selected option has sub-options (e.g. Deep → U-shape), a VisualChip row slides in below the card (Tape Unroll, 400ms). **A sub-option is required whenever its parent option is selected** — auto-select the first chip so the zero-decision rule holds, user can change it.
- **AddOnRow** (opt-in add-ons): thumbnail + name, caption, price in mono (`+ ₹120`), and a toggle or chip set. Default state: **off / none selected**. While the row is expanded and the user is choosing, the add-on is ghost-rendered on the BlousePreview at 50% opacity; on confirm it renders solid.

### 5.5 Live blouse preview — `BlousePreview` (all `/design/*` + `/review`)

- A **layered SVG blouse** pinned above the selectors (≈35vh, collapsing to a 64px strip on scroll) that always renders the current draft: cut, length, front neck, back, tying, shoulder, sleeves, plus every applied add-on at its placement.
- **Front/back views** with a flip control; screens auto-flip to the relevant view (back cut, back keyhole, tying → back view; front neck → front view).
- **Try-on behavior:** pressing/hovering any option, chip, or add-on ghost-previews that layer at 50% opacity *before* it is applied; confirming swaps the layer in with Curl In (500ms). Deselecting removes it.
- Style per Brand Book iconography: Ink Navy 2px rounded line-art on `warm-bg`; the element currently being edited highlights in Draep Orange; never photographic in V0.
- `/review` renders front + back previews side by side above the summary list.

### 5.6 Visualization asset kit (blocker for build — request from design)

- **Preview layers (SVG):** base blouse front + back · one layer per option and sub-option (3 cuts · 3 lengths · 8 front-neck variants · 7 back variants · 7 tying variants · 8 shoulder variants incl. strap sub-types · 6 sleeves) · one layer per add-on placement (keyhole ×4 shapes ×2 sides · tassels ×4 · latkan ×4 placements ×3 sizes · net work ×4 · piping · lining · button decor · boning · border-lace · breast cups · moti-work).
- **Thumbnails:** derived crops of the same SVGs for OptionCards, VisualChips, and AddOnRows — one per selectable item, no exceptions.
- All assets: navy line style, 2px rounded strokes, orange active variant (per Brand Book iconography). No mixed styles.

## 6. Screen-by-screen spec

All `/design/*` screens share one layout, top to bottom: `TapeProgress` header → `BlousePreview` (§5.5) → H1 → selectors → contextual `Style it up` card → sticky `PriceBar`.

### 6.0 Landing — `/`

- **Hero:** Tape Gradient background, symbol-only logo top-left, Display heading (white, one highlighted word), sub-line with the three USPs: *perfect fit · at-home Style Captain · transparent pricing*.
- **Primary CTA:** `Design your blouse` — white pill on gradient (inverted primary), sticky at bottom on mobile.
- Below the fold (white): 3-step "how it works" (design → home visit → delivery & trials) using tick-mark bullets; rate-list teaser; service-area note (Harlur, HSR Layout, Sarjapur, Kasavanahalli).
- CTA starts the flow at `/design/cut` with a fresh or resumed draft. If a draft exists, show `Resume your design` as primary and `Start over` as secondary text link.

### 6.1 Blouse cut — `/design/cut`

- H1 `Blouse cut`. OptionCards: **Simple cut (default)** · Princess cut · Katori cut. No sub-options, no contextual add-ons.

### 6.2 Blouse length — `/design/length`

- OptionCards: **Regular (default)** · Short choli · Long waist-length.
- **Contextual style add-ons section** (see §6.8-pattern below): `Tassels — bottom`.

### 6.3 Front neck cut — `/design/front-neck`

- OptionCards: **Round (default)** · Deep · Sweetheart · Boat · High neck.
    - Deep → chips: U-shape · V-shape · Round · Square.
    - High neck → chips: Band collar · Full collar · Full high neck.
- Contextual add-ons: `Key hole — front-side` (shape chips: Round · Drop · Triangle · Bow) · `Tassels — front neck`.

### 6.4 Back cut — `/design/back`

- OptionCards: **Regular (default)** · Deep · Backless.
    - Deep → chips: U-shape · V-shape · Round · Square.
    - Backless → chips: Strings straight · Strings cross · Strap.
- Contextual add-ons: `Key hole — back-side` (Round · Drop · Triangle · Bow) · `Tassels — back neck`.

### 6.5 Tying mechanism — `/design/tying`

- OptionCards: Hook · Chain · Button. **Default: Hook → Back hook** *(pending product confirmation)*.
    - Hook → chips: Front hook · Back hook.
    - Chain → chips: Left chain · Right chain · Back chain.
    - Button → chips: Front button · Back button *(CSV says "Button Button" — confirm)*.
- Contextual add-on: `Button decor` (Yes/No toggle — material add-on surfaced here; state is shared with the same row on `/design/add-ons`).

### 6.6 Fit & structure — `/design/fit` (single screen, nothing collapsed)

All three categories visible on one scrollable screen, each prefilled:

1. **Shoulder** — chips: **Regular (default, pending)** · Off-shoulder · One-shoulder · Strappy · Halter · Cold shoulder.
    - Strappy → sub-chips: Broad · Thin-round (spaghetti). Halter → same sub-chips.
2. **Sleeve style** — chips: Sleeveless · Cap sleeve · **Regular short (default, pending)** · Elbow length · Three-quarter · Full-sleeve.
    - Regular short, Elbow, Three-quarter and Full-sleeve are **priced add-ons per the CSV** — show `+ ₹—` beside those chips and add to price bar when selected.
    - Contextual add-on under this group: `Tassels — sleeves`.
3. **Neck (keyhole side)** — chips: Front-side · **Back-side (default, pending)**.
- Section headers are H3 with a tick-mark divider between groups.

### 6.7 Material add-ons — `/design/add-ons`

Single screen of AddOnRows on `warm-bg` section cards. Default = none selected. Style add-ons (Key hole, Tassels) already surfaced contextually; **do not repeat them here**, but they remain editable from Review.

| Add-on | Control | Behavior |
| --- | --- | --- |
| Piping | Toggle Yes/No | — |
| Lining / Astar | Toggle → chips Full · Half | Caption: "Depends on your cloth — our Style Captain will confirm at the visit" |
| Button decor | Toggle Yes/No | Two-way bound with the same row on `/design/tying` |
| Boning | Toggle Yes/No | — |
| Border | Toggle → chip Lace | Single option today; keep chip UI so more borders can ship without redesign |
| Latkan | Toggle → placement multi-select: Front neck · Back neck · Sleeves · Bottom | Each selected placement reveals a size chip row: Small · Medium · Large (size required per placement, default Medium) |
| Breast cups | Toggle Yes/No | On Yes, reveal **cup size input** (mono numerals + unit) — validate non-empty |
| Moti-work | Toggle Yes/No | Placements/pricing TBD — build the row, flag as config-driven |
| Net work | Toggle → placement multi-select: Front neck · Back neck · Sleeves · Bottom | — |
- Each row shows its price in mono when priced; price bar Ticks on every change.
- Toggling or expanding any row ghost-previews the add-on on the `BlousePreview` before it's applied (§5.5) — the user always sees the visualization while trying to add it.

### 6.8 Contextual style add-on pattern (used on 6.2–6.6)

- Rendered below the option grid under an H3: `Style it up` on a `warm-bg` card.
- Each add-on is an AddOnRow (off by default). Selecting reveals its sub-chips (e.g. keyhole shape). Removing the parent selection clears its sub-choices.
- These write to the same `addOns` state as §6.7 — one source of truth, surfaced in two places.

### 6.9 Review — `/review`

- H1 `Review your blouse`.
- **Grouped summary list** in journey order: Structure (cut, length, front neck, back, tying) → Fit (shoulder, sleeve, neck side) → Add-ons (only the ones switched on; show "None" row if empty).
- Each ReviewRow: label (caption, navy-interactive), value incl. sub-option (body, Ink Navy), price (mono, right-aligned), chevron. Tap → deep-link to that screen with `?from=review`.
- **Price breakdown card** pinned below the list: base stitching price, one line per priced selection/add-on, total row in orange on white (per invoice guidance: navy table, orange total). All numerals mono.
- Sticky CTA: `Continue`.

### 6.10 Contact details — `/contact`

Order per the journey: **phone first**, then name + address, then map pin.

1. **Phone number** — `+91` fixed prefix, 10-digit input, mono, numeric keyboard, validate `^[6-9]\d{9}$`. (OTP verification: not specced — confirm if V0 needs it.)
2. **Name** — text, required, max 60 chars.
3. **Address** — line 1 (required), line 2 (optional), pincode (6 digits, mono).
4. **Map pin** — map card (12px radius) with draggable pin + place search; reverse-geocode to prefill address when pin moves; "use my location" button.
5. **Serviceability check:** on pin set, validate the point against the V0 service area (Harlur, HSR Layout, Sarjapur, Kasavanahalli — polygon/radius from backend config). Out of area → error banner (`error` red): "We're not in your area yet" + option to leave phone number for the waitlist. **Block progression when out of area.**
- CTA `Continue to payment` — enabled only when all validations pass (this screen is the exception to the always-enabled rule).

### 6.11 Payment — `/pay`

- Compact order summary (total + item count, expandable) + `Pay ₹—— via UPI` primary CTA → opens gateway UPI flow.
- States: processing (button spinner, disabled), **failure** (error banner + `Try again`, draft untouched), success → `/confirmed`.
- Never double-charge: disable CTA while a payment attempt is pending; verify order status on return before retrying.

### 6.12 Confirmation — `/confirmed`

- Success state: green tick, `Booking confirmed` H1, order ID in mono.
- **3-hour home-visit slot picker**: date chips (next 7 days) + slot chips (e.g. 9–12, 12–3, 3–6, 6–9 — final windows from ops config). Confirm slot → summary card: slot, address, what happens next (Style Captain visit explained in one line each, tick bullets).
- Voice & tone per brand book: exact promises — "Your Style Captain will arrive Saturday, 6–9 PM", never "soon!".

## 7. Style catalog — data model & full config

Single config file drives every design screen. Do not hard-code options in components.

```tsx
type Group = "critical" | "fit" | "addon_material" | "addon_style";

interface SubOption { id: string; label: string }
interface StyleOption {
	id: string;
	label: string;
	priceKey?: string;            // lookup into pricing config; undefined = included
	subOptions?: SubOption[];     // required choice when this option selected (auto-select first)
}
interface Category {
	id: string;
	label: string;
	group: Group;
	route: string;                // screen that renders it
	defaultOptionId: string | null; // null = default pending product decision
	options: StyleOption[];
}

const CATALOG: Category[] = [
	{ id: "blouse_cut", label: "Blouse cut", group: "critical", route: "/design/cut", defaultOptionId: "simple",
		options: [ { id: "simple", label: "Simple cut" }, { id: "princess", label: "Princess cut" }, { id: "katori", label: "Katori cut" } ] },
	{ id: "blouse_length", label: "Blouse length", group: "critical", route: "/design/length", defaultOptionId: "regular",
		options: [ { id: "regular", label: "Regular" }, { id: "short_choli", label: "Short choli" }, { id: "long_waist", label: "Long waist-length" } ] },
	{ id: "front_neck", label: "Front neck cut", group: "critical", route: "/design/front-neck", defaultOptionId: "round",
		options: [
			{ id: "round", label: "Round" },
			{ id: "deep", label: "Deep", subOptions: [ { id: "u", label: "U-shape" }, { id: "v", label: "V-shape" }, { id: "round", label: "Round" }, { id: "square", label: "Square" } ] },
			{ id: "sweetheart", label: "Sweetheart" },
			{ id: "boat", label: "Boat" },
			{ id: "high_neck", label: "High neck", subOptions: [ { id: "band_collar", label: "Band collar" }, { id: "full_collar", label: "Full collar" }, { id: "full_high", label: "Full high neck" } ] },
		] },
	{ id: "back_cut", label: "Back cut", group: "critical", route: "/design/back", defaultOptionId: "regular",
		options: [
			{ id: "regular", label: "Regular" },
			{ id: "deep", label: "Deep", subOptions: [ { id: "u", label: "U-shape" }, { id: "v", label: "V-shape" }, { id: "round", label: "Round" }, { id: "square", label: "Square" } ] },
			{ id: "backless", label: "Backless", subOptions: [ { id: "strings_straight", label: "Strings straight" }, { id: "strings_cross", label: "Strings cross" }, { id: "strap", label: "Strap" } ] },
		] },
	{ id: "tying", label: "Tying mechanism", group: "critical", route: "/design/tying", defaultOptionId: null, // suggested: hook/back — confirm
		options: [
			{ id: "hook", label: "Hook", subOptions: [ { id: "front", label: "Front hook" }, { id: "back", label: "Back hook" } ] },
			{ id: "chain", label: "Chain", subOptions: [ { id: "left", label: "Left chain" }, { id: "right", label: "Right chain" }, { id: "back", label: "Back chain" } ] },
			{ id: "button", label: "Button", subOptions: [ { id: "front", label: "Front button" }, { id: "back", label: "Back button" /* CSV: "Button Button" — confirm */ } ] },
		] },
	{ id: "shoulder", label: "Shoulder", group: "fit", route: "/design/fit", defaultOptionId: null, // suggested: regular — confirm
		options: [
			{ id: "regular", label: "Regular" },
			{ id: "off_shoulder", label: "Off-shoulder" },
			{ id: "one_shoulder", label: "One-shoulder" },
			{ id: "strappy", label: "Strappy", subOptions: [ { id: "broad", label: "Broad" }, { id: "spaghetti", label: "Thin-round (spaghetti)" } ] },
			{ id: "halter", label: "Halter", subOptions: [ { id: "broad", label: "Broad" }, { id: "spaghetti", label: "Thin-round (spaghetti)" } ] },
			{ id: "cold_shoulder", label: "Cold shoulder" },
		] },
	{ id: "sleeve", label: "Sleeve style", group: "fit", route: "/design/fit", defaultOptionId: null, // suggested: regular_short — confirm
		options: [
			{ id: "sleeveless", label: "Sleeveless" },
			{ id: "cap", label: "Cap sleeve" },
			{ id: "regular_short", label: "Regular short", priceKey: "sleeve_regular_short" },
			{ id: "elbow", label: "Elbow length", priceKey: "sleeve_elbow" },
			{ id: "three_quarter", label: "Three-quarter", priceKey: "sleeve_three_quarter" },
			{ id: "full", label: "Full-sleeve", priceKey: "sleeve_full" },
		] },
	{ id: "neck_side", label: "Neck (keyhole side)", group: "fit", route: "/design/fit", defaultOptionId: null, // suggested: back — confirm
		options: [ { id: "back", label: "Back-side" }, { id: "front", label: "Front-side" } ] },
];

// Add-ons: opt-in, default off. `contextRoutes` = design screens that also render the row.
interface AddOn {
	id: string;
	label: string;
	kind: "toggle" | "choice" | "placements";
	group: "addon_material" | "addon_style";
	priceKey?: string;
	choices?: SubOption[];                    // for kind: "choice" (e.g. lining full/half)
	placements?: SubOption[];                 // for kind: "placements"
	perPlacementSizes?: SubOption[];          // e.g. latkan S/M/L per placement
	extraInput?: { id: string; label: string; type: "text" };
	contextRoutes?: string[];
}

const ADD_ONS: AddOn[] = [
	{ id: "piping", label: "Piping", kind: "toggle", group: "addon_material", priceKey: "piping" },
	{ id: "lining", label: "Lining / Astar", kind: "choice", group: "addon_material", priceKey: "lining",
		choices: [ { id: "full", label: "Full" }, { id: "half", label: "Half" } ] }, // depends on cloth — captain confirms at visit
	{ id: "button_decor", label: "Button decor", kind: "toggle", group: "addon_material", priceKey: "button_decor", contextRoutes: ["/design/tying"] },
	{ id: "boning", label: "Boning", kind: "toggle", group: "addon_material", priceKey: "boning" },
	{ id: "border", label: "Border", kind: "choice", group: "addon_material", priceKey: "border", choices: [ { id: "lace", label: "Lace" } ] },
	{ id: "latkan", label: "Latkan", kind: "placements", group: "addon_material", priceKey: "latkan",
		placements: [ { id: "front_neck", label: "Front neck" }, { id: "back_neck", label: "Back neck" }, { id: "sleeves", label: "Sleeves" }, { id: "bottom", label: "Bottom" } ],
		perPlacementSizes: [ { id: "s", label: "Small" }, { id: "m", label: "Medium" }, { id: "l", label: "Large" } ] },
	{ id: "breast_cups", label: "Breast cups", kind: "toggle", group: "addon_material", priceKey: "breast_cups",
		extraInput: { id: "cup_size", label: "Cup size", type: "text" } },
	{ id: "moti_work", label: "Moti-work", kind: "toggle", group: "addon_material", priceKey: "moti_work" }, // placements TBD
	{ id: "net_work", label: "Net work", kind: "placements", group: "addon_material", priceKey: "net_work",
		placements: [ { id: "front_neck", label: "Front neck" }, { id: "back_neck", label: "Back neck" }, { id: "sleeves", label: "Sleeves" }, { id: "bottom", label: "Bottom" } ] },
	{ id: "keyhole_front", label: "Key hole — front-side", kind: "choice", group: "addon_style", priceKey: "keyhole",
		choices: [ { id: "round", label: "Round" }, { id: "drop", label: "Drop" }, { id: "triangle", label: "Triangle" }, { id: "bow", label: "Bow" } ], contextRoutes: ["/design/front-neck"] },
	{ id: "keyhole_back", label: "Key hole — back-side", kind: "choice", group: "addon_style", priceKey: "keyhole",
		choices: [ { id: "round", label: "Round" }, { id: "drop", label: "Drop" }, { id: "triangle", label: "Triangle" }, { id: "bow", label: "Bow" } ], contextRoutes: ["/design/back"] },
	{ id: "tassels", label: "Tassels", kind: "placements", group: "addon_style", priceKey: "tassels",
		placements: [ { id: "front_neck", label: "Front neck" }, { id: "back_neck", label: "Back neck" }, { id: "sleeves", label: "Sleeves" }, { id: "bottom", label: "Bottom" } ],
		contextRoutes: ["/design/front-neck", "/design/back", "/design/fit", "/design/length"] },
];
```

- Note the placement-scoped rendering for contextual rows: on `/design/length` the Tassels row only exposes the **Bottom** placement; on `/design/back` only **Back neck**; on `/design/fit` only **Sleeves**; on `/design/front-neck` only **Front neck**. The add-ons/Review screens expose all placements.

## 8. Booking state & persistence

```tsx
interface BookingDraft {
	version: 1;
	selections: Record<string, { optionId: string; subOptionId?: string }>; // keyed by Category.id
	addOns: Record<string, {
		enabled: boolean;
		choiceId?: string;
		placements?: Record<string, { sizeId?: string }>;
		extraInputs?: Record<string, string>;   // e.g. cup_size
	}>;
	contact?: { phone: string; name: string; address1: string; address2?: string; pincode: string; lat?: number; lng?: number };
	payment?: { orderId?: string; status: "pending" | "paid" | "failed" };
	slot?: { date: string; window: string };
	updatedAt: string; // ISO
}
```

- Initialize `selections` from `CATALOG` defaults on first load (zero-decision rule).
- Persist to `localStorage` on every change (debounced 300ms). Resume silently on return; expire drafts older than 7 days.
- Price = base + Σ resolved `priceKey`s. Single `computePrice(draft)` util; the price bar, Review breakdown, and payment amount must all call it (one source of truth).

## 9. Component inventory

| Component | Used on | Notes |
| --- | --- | --- |
| `BlousePreview` | all design screens + review | Layered SVG, front/back flip, 50%-opacity ghost preview on hover/press, Curl In on apply |
| `VisualChip` | everywhere chips appear | 24px thumbnail + label; no text-only chips allowed |
| `TapeProgress` | design screens, review | Ticks + rivet dot + gradient fill; Unroll/Pulse motion |
| `OptionCard`  • grid | critical screens | Radio semantics, illustration, Default chip |
| `SubOptionChips` | critical + fit + add-ons | Auto-selects first chip when revealed; built from VisualChips |
| `ChipGroup` | fit screen | Same VisualChip treatment (thumbnail + label), inline (no cards) |
| `AddOnRow` | add-ons + contextual sections | Toggle/choice/placements variants, price in mono |
| `PlacementSizePicker` | Latkan | Size chips per selected placement |
| `PriceBar` | design + review | Sticky; Tick animation; opens breakdown sheet |
| `PriceBreakdown` | review + sheet | Navy table, orange total row, mono numerals |
| `ReviewRow` | review | Deep-links with `?from=review` |
| `PhoneField` / `TextField` / `PincodeField` | contact | Mono numerals where numeric |
| `MapPinPicker` | contact | Autocomplete, draggable pin, serviceability state |
| `SlotPicker` | confirmed | Date chips + 3-hour window chips |
| `Banner` | contact, pay | success / warning / error / info variants |

## 10. Validation & edge cases

- Design screens: never blocking; sub-option auto-selected so state is always complete.
- Two-way sync: Button decor edited on `/design/tying` and `/design/add-ons` is the same state; same for all contextual style add-ons.
- Deselecting a parent option/add-on clears its sub-choices and placements (and removes their price lines).
- Review with zero add-ons is valid — show "No add-ons" row.
- Contact: block only for invalid phone/pincode/missing pin/out-of-area (see §6.10).
- Payment failure/cancel: return to `/pay` with draft intact and an error banner; confirm gateway order status before allowing retry.
- Refresh anywhere: restore from `localStorage` to the same route.
- Empty/expired draft on protected routes → redirect `/`.

## 11. Accessibility

- Option grids: `role="radiogroup"` / `role="radio"` with full keyboard support; chips as toggle buttons with `aria-pressed`.
- All interactive targets ≥44×44px. Focus rings: 2px `navy-interactive` offset 2px.
- Contrast: body text navy-on-white (13.9:1) ✓; verify white-on-gradient CTA ≥ 4.5:1 at the light end — use bold ≥16px per brand rule.
- Price changes announced via `aria-live="polite"` on the price bar.
- `prefers-reduced-motion`: disable Unroll/Curl In/Pulse and ghost-preview animation (apply instantly).
- `BlousePreview` and every thumbnail carry a meaningful `aria-label` describing the style (e.g. "Deep V-shape back with cross strings"); preview updates announced via `aria-live="polite"`.

## 12. Analytics events

| Event | Payload |
| --- | --- |
| `landing_cta_tapped` | resumed: boolean |
| `design_step_viewed` | step id |
| `option_changed` | categoryId, from, to, subOptionId |
| `addon_toggled` | addOnId, enabled, source: "context" or "addons_screen" |
| `design_completed_default_count` | # of categories left on default (measures the zero-decision hypothesis) |
| `review_viewed` / `review_row_edited` | rowId |
| `contact_submitted` / `serviceability_failed` | area result |
| `payment_initiated` / `payment_succeeded` / `payment_failed` | orderId, amount |
| `slot_selected` | date, window |

## 13. Open items (blockers & decisions)

- [ ]  **Pricing sheet**: base price + every `priceKey` value (sleeves, all add-ons). Frontend is config-driven and unblocked structurally, but Review/price bar need real numbers before launch.
- [ ]  **Defaults pending**: Tying mechanism (suggest Back hook), Shoulder (suggest Regular), Sleeve style (suggest Regular short), Neck side (suggest Back-side).
- [ ]  Confirm CSV "Button Button" = Back button.
- [ ]  Moti-work options/placements/pricing.
- [ ]  OTP verification on phone — in or out for V0?
- [ ]  Final 3-hour slot windows + how many days ahead ops can serve.
- [ ]  Service-area polygon source (hardcoded V0 polygon vs. backend config).
- [ ]  **Visualization asset kit** — layered preview SVGs + one thumbnail per selectable item (§5.6). Hard blocker: no design screen ships without its visuals.

## 14. Brand compliance checklist — gates every PR

- [ ]  Colors come only from §3.1 tokens — zero ad-hoc hex values. Tape Gradient only on hero, primary buttons, and progress fill; never on text.
- [ ]  60/30/10 ratio holds on every screen — orange stays the 10% accent, not the base.
- [ ]  Poppins headings in sentence case · Inter body · IBM Plex Mono with tabular numerals for **every** number: prices, sizes, order IDs, phone, slots.
- [ ]  Max one orange word per headline; body text is Ink Navy on white; no small orange-on-white text; white text on orange ≥16px bold.
- [ ]  12px card radius, pill buttons, single navy-8% shadow, 1px Tape Silver dividers — no sharp corners anywhere.
- [ ]  Logo per §3.5: correct lockup per context, clearspace, minimum sizes, zero don'ts violations.
- [ ]  Motion uses only the four brand patterns (§3.4), nothing over 800ms, `prefers-reduced-motion` respected.
- [ ]  All copy passes §3.6: exact promises with real numbers, sentence case, no emojis, "master tailors" never "vendors".
- [ ]  Every selectable element has its visualization (§5.4) and ghost-previews on the BlousePreview (§5.5) — no text-only selectors anywhere.
- [ ]  Navy + orange are both present on every key screen (the "brand handshake").