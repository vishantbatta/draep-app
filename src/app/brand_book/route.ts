import { readFileSync } from "node:fs";
import { join } from "node:path";

export const dynamic = "force-static";

export function GET() {
  const filePath = join(process.cwd(), "public", "brand_book.html");
  const html = readFileSync(filePath, "utf-8");

  return new Response(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    },
  });
}
