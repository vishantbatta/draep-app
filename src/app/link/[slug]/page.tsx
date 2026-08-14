// Public short-link redirect: draep.com/link/<slug> → destination.
//
// Server component on purpose — the visitor never loads app JS, and the
// backend resolves + counts the click before we redirect. force-dynamic +
// no-store are essential: Next 14 caches fetches by default, which would
// freeze destinations at first click and skip click counting.

import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

const REASON_COPY: Record<string, { title: string; body: string }> = {
  link_not_found: {
    title: "This link doesn't exist",
    body: "The short link you followed was never created, or it has been deleted.",
  },
  link_inactive: {
    title: "This link is turned off",
    body: "The owner of this link has paused it. Please check back later.",
  },
  link_expired: {
    title: "This link has expired",
    body: "This short link was time-limited and is no longer active.",
  },
  link_exhausted: {
    title: "This link has reached its usage limit",
    body: "This short link allowed a limited number of visits and is now closed.",
  },
  link_error: {
    title: "Something went wrong",
    body: "We couldn't check this link just now. Please try again in a moment.",
  },
};

/** Absolute backend base — NEXT_PUBLIC_API_URL is absolute in dev (.env.local)
 * and in production (the next.config.mjs rewrites depend on it too). */
function backendBase(): string {
  const url = process.env.NEXT_PUBLIC_API_URL;
  if (url && /^https?:\/\//.test(url)) return url;
  return "http://localhost:8000/api/v1";
}

type ResolveResult = { destination: string } | { reason: keyof typeof REASON_COPY };

async function resolveSlug(slug: string): Promise<ResolveResult> {
  try {
    const res = await fetch(`${backendBase()}/link/${encodeURIComponent(slug)}`, {
      cache: "no-store",
    });
    if (res.ok) {
      const body = (await res.json()) as { destination?: string };
      if (body.destination) return { destination: body.destination };
    }
    const body = (await res.json().catch(() => null)) as
      | { error?: { code?: string } }
      | null;
    const code = body?.error?.code;
    return { reason: code && code in REASON_COPY ? code : "link_not_found" };
  } catch {
    return { reason: "link_error" };
  }
}

export default async function ShortLinkRedirectPage({
  params,
}: {
  params: { slug: string };
}) {
  const result = await resolveSlug(params.slug);

  // redirect() throws internally — never wrapped in try/catch above.
  if ("destination" in result) {
    redirect(result.destination);
  }

  const copy = REASON_COPY[result.reason];
  return (
    <main className="flex min-h-screen items-center justify-center bg-mist-navy/40 px-4">
      <div className="w-full max-w-md rounded-card border border-hairline bg-chalk-white p-8 text-center shadow-card">
        <p className="mb-2 font-mono text-eyebrow text-muted">draep.com</p>
        <h1 className="mb-3 font-heading text-h3 font-semibold text-ink-navy">
          {copy.title}
        </h1>
        <p className="mb-6 text-caption text-muted">{copy.body}</p>
        <a
          href="/"
          className="tap inline-block rounded-pill bg-ink-navy px-6 py-2.5 text-caption font-medium text-chalk-white transition hover:bg-ink-navy/90"
        >
          Go to draep.com
        </a>
      </div>
    </main>
  );
}
