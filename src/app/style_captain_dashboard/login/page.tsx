"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { scLogin } from "@/lib/style-captain-api";
import { Eye, EyeOff } from "@/components/ui/icons";

export default function StyleCaptainLoginPage() {
  const router = useRouter();
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      await scLogin(phone, password);
      router.push("/style_captain_dashboard");
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
            Style Captain
          </h1>
          <p className="mt-1 text-body text-muted">
            Sign in to capture measurements
          </p>
        </div>

        <form
          onSubmit={handleSubmit}
          className="rounded-card border border-hairline bg-chalk-white p-6 shadow-card"
        >
          <label className="mb-1 block text-caption font-medium text-ink-navy">
            Phone number
          </label>
          <input
            type="tel"
            inputMode="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="e.g. 9876543210"
            required
            className="mb-4 w-full rounded-card border border-hairline-strong bg-chalk-white px-4 py-3 text-body text-ink outline-none focus:border-accent-text focus:ring-2 focus:ring-accent-text/30"
          />

          <label className="mb-1 block text-caption font-medium text-ink-navy">
            Password
          </label>
          <div className="relative mb-4">
            <input
              type={showPassword ? "text" : "password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter password"
              required
              className="w-full rounded-card border border-hairline-strong bg-chalk-white px-4 py-3 pr-12 text-body text-ink outline-none focus:border-accent-text focus:ring-2 focus:ring-accent-text/30"
            />
            <button
              type="button"
              onClick={() => setShowPassword((s) => !s)}
              aria-label={showPassword ? "Hide password" : "Show password"}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted transition hover:text-ink-navy"
            >
              {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
            </button>
          </div>

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

        <p className="mt-6 text-center text-eyebrow">Draep · Style Captains</p>
        <div className="lp-tape-strip mt-6 rounded-sheet" />
      </div>
    </div>
  );
}
