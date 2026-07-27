import { chromium } from "playwright";

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
const consoleErrors = [];
page.on("console", (m) => consoleErrors.push(`[${m.type()}] ${m.text()}`));
page.on("pageerror", (e) => consoleErrors.push(`[pageerror] ${e.message}`));

await page.goto("http://localhost:3000/style", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(3000);

console.log("=== Console ===");
console.log(consoleErrors.join("\n"));

console.log("\n=== Body innerHTML (first 3000 chars) ===");
const body = await page.evaluate(() => document.body.innerHTML);
console.log(body.slice(0, 3000));

console.log("\n=== Body text (first 500 chars) ===");
console.log((await page.evaluate(() => document.body.innerText)).slice(0, 500));

await page.screenshot({ path: "/tmp/style.png", fullPage: true });
await browser.close();
