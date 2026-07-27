import { chromium } from "playwright";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
const errors = [];
const failedImages = [];

page.on("console", (m) => {
  if (m.type() === "error") errors.push(m.text());
});
page.on("requestfailed", (r) => {
  const u = r.url();
  if (u.includes("replicate") || u.includes("picsum")) {
    failedImages.push(`FAIL ${u}`);
  }
});
page.on("response", (r) => {
  const u = r.url();
  if ((u.includes("replicate") || u.includes("picsum")) && r.status() >= 400) {
    failedImages.push(`HTTP ${r.status()} ${u}`);
  }
});

await page.goto("http://localhost:3000/style", {
  waitUntil: "networkidle",
  timeout: 30000,
});
await page.waitForTimeout(3000);

const imgs = await page.$$eval("img", (els) =>
  els
    .filter((e) => {
      const r = e.getBoundingClientRect();
      return r.width > 50 && r.height > 50;
    })
    .map((e) => ({
      src: e.src.slice(0, 80),
      natW: e.naturalWidth,
      natH: e.naturalHeight,
      complete: e.complete,
    }))
);

console.log("Visible images:", imgs.length);
console.log("First 3:", JSON.stringify(imgs.slice(0, 3), null, 2));
console.log("Images with 0 natural width:", imgs.filter((i) => i.natW === 0).length);
console.log("Console errors:", errors.length);
errors.slice(0, 5).forEach((e) => console.log("  -", e));
console.log("Failed image requests:", failedImages.length);
failedImages.slice(0, 5).forEach((e) => console.log("  -", e));

await page.screenshot({ path: "/tmp/style-diag.png", fullPage: false });
console.log("Screenshot: /tmp/style-diag.png");
await browser.close();
