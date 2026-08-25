import { LibraryBrowser } from "@/components/library/LibraryBrowser";

/**
 * /library — standalone full-viewport host for the design library browser.
 *
 * The gallery itself lives in LibraryBrowser (shared with the /app Explore
 * tab); this page only supplies the viewport height.
 */
export default function LibraryPage() {
  return (
    <div className="h-dvh">
      <LibraryBrowser />
    </div>
  );
}
