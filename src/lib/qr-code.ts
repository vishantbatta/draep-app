import QRCode from "qrcode";

/**
 * In-house styled QR generator replicating the house QR (be/qr-code.svg):
 * full-cell diamond bodies, rounded-square finder rings with circle eyeballs,
 * a single vertical #F89010 → #A85010 gradient masked over every shape
 * (eyes included), #FFF6EA background, and the Draep logo centered at ~38%
 * of the content width with a clean zone (no modules behind it). Only the
 * module matrix comes from the `qrcode` package; all rendering is ours.
 */

// Reference geometry (2277-unit SVG for a v3 code): module 69px, margin 2 modules.
const MODULE = 69;
const MARGIN_MODULES = 2;
const LOGO_WIDTH_FRAC = 759 / 2001; // logo width ÷ content width in the reference
const LOGO_ASPECT = 2302 / 3745; // fe/public/logo.png natural h/w
// frame13 outer corner radius ≈ 34% and inner hole at 15..85 with r ≈ 19.5%,
// captured from the reference path so the eye shape is pixel-identical.
const EYE_RING_PATH =
  "M65.859,0.008H34.141h0C18.683,0.008,5.587,10.221,1.4,24.18c-0.433,1.444-0.771,2.928-1.006,4.445C0.135,30.299,0,32.013,0,33.758v32.471c0,18.619,15.32,33.76,34.141,33.76L50,99.992l15.859-0.004c18.82,0,34.141-15.141,34.141-33.76V33.758C100,15.148,84.68,0.008,65.859,0.008z M85,66.229c0,10.344-8.586,18.76-19.145,18.76L50,84.992l-15.855-0.004C23.586,84.988,15,76.572,15,66.229V33.758c0-3.231,0.838-6.273,2.313-8.931c1.42-2.557,3.429-4.756,5.848-6.421c3.11-2.141,6.897-3.398,10.979-3.398h31.719C76.414,15.008,85,23.419,85,33.758V66.229z";

const round2 = (n: number) => Math.round(n * 100) / 100;

let uid = 0;

/** Builds the house-styled QR SVG for `url`, embedding `logoDataUrl`. */
export function buildShortLinkQrSvg(url: string, logoDataUrl: string): string {
  // H error correction leaves ~30% headroom; the logo covers <10% of the code.
  const qr = QRCode.create(url, { errorCorrectionLevel: "H" });
  const n = qr.modules.size;
  const margin = MARGIN_MODULES * MODULE;
  const content = n * MODULE;
  const total = content + 2 * margin;

  const inFinder = (r: number, c: number): boolean =>
    (r < 7 && c < 7) || (r < 7 && c >= n - 7) || (r >= n - 7 && c < 7);

  const shapes: string[] = [];

  // Finder rings (7×7 modules) + circle eyeballs (Ø ≈ 2.94 modules) at the
  // three finder corners.
  const corners: Array<[number, number]> = [
    [0, 0],
    [0, n - 7],
    [n - 7, 0],
  ];
  const ringScale = (7 * MODULE) / 100;
  const ballScale = (2.9412 * MODULE) / 100;
  for (const [row, col] of corners) {
    const x = col * MODULE;
    const y = row * MODULE;
    shapes.push(
      `<g transform="translate(${x},${y}) scale(${round2(ringScale)})"><path d="${EYE_RING_PATH}"/></g>`,
    );
    const cx = x + 3.5 * MODULE;
    const cy = y + 3.5 * MODULE;
    shapes.push(
      `<g transform="translate(${round2(cx - 50 * ballScale)},${round2(cy - 50 * ballScale)}) scale(${round2(ballScale)})"><circle cx="50" cy="50" r="50"/></g>`,
    );
  }

  // Logo centered in the content area at the reference's relative width.
  const logoW = LOGO_WIDTH_FRAC * content;
  const logoH = logoW * LOGO_ASPECT;
  const logoX = (content - logoW) / 2;
  const logoY = (content - logoH) / 2;

  // Body: one full-cell diamond per dark module outside the finder zones.
  // Modules intersecting the logo box are dropped — the reference keeps the
  // area behind the (transparent) logo empty.
  for (let r = 0; r < n; r += 1) {
    for (let c = 0; c < n; c += 1) {
      if (inFinder(r, c) || !qr.modules.get(r, c)) continue;
      const x = c * MODULE;
      const y = r * MODULE;
      if (x < logoX + logoW && x + MODULE > logoX && y < logoY + logoH && y + MODULE > logoY) continue;
      shapes.push(
        `<g transform="translate(${x},${y}) scale(0.69,0.69)"><polygon points="0,50 50,100 100,50 50,0"/></g>`,
      );
    }
  }

  uid += 1;
  const gradId = `grad-${uid}`;
  const maskId = `gmask-${uid}`;

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" ` +
    `width="${total}" height="${total}" viewBox="0 0 ${total} ${total}">` +
    `<rect x="0" y="0" width="${total}" height="${total}" fill="rgb(255,246,234)"/>` +
    `<g transform="translate(${margin},${margin})"><defs>` +
    `<linearGradient gradientTransform="rotate(90)" id="${gradId}">` +
    `<stop offset="5%" stop-color="rgb(248,144,16)"/>` +
    `<stop offset="95%" stop-color="rgb(168,80,16)"/>` +
    `</linearGradient>` +
    // White shapes in the mask → everything (diamonds, rings, eyeballs)
    // receives the gradient, exactly like the reference.
    `<mask id="${maskId}"><g fill="rgb(255,255,255)">${shapes.join("")}</g></mask>` +
    `</defs>` +
    `<rect x="0" y="0" width="${content}" height="${content}" fill="url(#${gradId})" mask="url(#${maskId})"/>` +
    `<image transform="translate(${round2(logoX)},${round2(logoY)})" width="${round2(logoW)}" height="${round2(logoH)}" href="${logoDataUrl}" xlink:href="${logoDataUrl}"/>` +
    `</g></svg>`
  );
}

/** Loads /logo.png once and returns it as a data URL (needed for rasterizing). */
let logoPromise: Promise<string> | null = null;
export function loadLogoDataUrl(): Promise<string> {
  if (!logoPromise) {
    logoPromise = fetch("/logo.png")
      .then((res) => {
        if (!res.ok) throw new Error(`logo.png HTTP ${res.status}`);
        return res.blob();
      })
      .then(
        (blob) =>
          new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result));
            reader.onerror = () => reject(reader.error ?? new Error("logo read failed"));
            reader.readAsDataURL(blob);
          }),
      )
      .catch((err) => {
        logoPromise = null; // retry on next use
        throw err;
      });
  }
  return logoPromise;
}

/** Rasterizes an SVG string to a PNG blob via an offscreen canvas. */
export async function svgToPngBlob(svg: string, size = 1024): Promise<Blob> {
  const svgUrl = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml;charset=utf-8" }));
  try {
    const img = new Image();
    img.decoding = "async";
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("QR image failed to load"));
      img.src = svgUrl;
    });
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    canvas.getContext("2d")?.drawImage(img, 0, 0, size, size);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
    if (!blob) throw new Error("QR PNG encoding failed");
    return blob;
  } finally {
    URL.revokeObjectURL(svgUrl);
  }
}

/** Full pipeline: short URL → house-styled QR as a PNG blob. */
export async function shortLinkQrPng(url: string): Promise<Blob> {
  const logo = await loadLogoDataUrl();
  const svg = buildShortLinkQrSvg(url, logo);
  return svgToPngBlob(svg);
}
