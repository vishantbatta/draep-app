"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { adminLogin, setAdminToken } from "@/lib/admin-api";

export default function AdminLoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const token = await adminLogin(email, password);
      setAdminToken(token);
      router.push("/admin");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-dvh items-center justify-center bg-warm-sand px-4">
      <div className="w-full max-w-sm">
        {/* Logo strip */}
        <div className="mb-8 text-center">
          <div className="lp-tape-strip mb-6 rounded-sheet" />
          <h1 className="font-heading text-h1 font-semibold text-ink-navy">
            Draep admin
          </h1>
          <p className="mt-1 text-body text-muted">
            Sign in to the dashboard
          </p>
        </div>

        <form
          onSubmit={handleSubmit}
          className="rounded-card border border-hairline bg-chalk-white p-6 shadow-card"
        >
          <label className="mb-1 block text-caption font-medium text-ink-navy">
            Email
          </label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="admin@draep.com"
            required
            className="mb-4 w-full rounded-card border border-hairline-strong bg-chalk-white px-4 py-3 text-body text-ink outline-none"
          />

          <label className="mb-1 block text-caption font-medium text-ink-navy">
            Password
          </label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Enter password"
            required
            className="mb-4 w-full rounded-card border border-hairline-strong bg-chalk-white px-4 py-3 text-body text-ink outline-none"
          />

          {error && (
            <div className="mb-4 rounded-card border border-error-border bg-error-bg px-4 py-2 text-caption text-error-text">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="tap w-full rounded-pill bg-tape px-6 py-3 font-heading font-semibold text-chalk-white shadow-primary transition disabled:opacity-50"
          >
            {loading ? "Signing in…" : "Sign in"}
          </button>
        </form>

        <p className="mt-6 text-center text-eyebrow">
          Draep · Internal
        </p>
        <div className="lp-tape-strip mt-6 rounded-sheet" />
      </div>
    </div>
  );
}
