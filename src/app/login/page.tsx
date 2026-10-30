"use client";

import Link from "next/link";
import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AlertCircle, ArrowRight, ArrowUpRight } from "lucide-react";
import { safeRedirect } from "@/lib/cms/access";
import { PublicationLogo } from "@/components/editorial/Sidebar";
import "@/components/editorial/editorial.css";

const LOGOS: { brand: string; height: number }[] = [{ brand: "ws", height: 13 }, { brand: "wa", height: 16 }, { brand: "ca", height: 11 }, { brand: "mw", height: 8 }];

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  async function login(event: React.FormEvent) {
    event.preventDefault(); setPending(true); setError("");
    try {
      const response = await fetch("/api/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Sign-in could not be completed.");
      setPassword(""); router.replace(safeRedirect(params.get("redirect"))); router.refresh();
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Sign-in could not be completed."); }
    finally { setPending(false); }
  }
  return <main className="ed ed-access">
    <section className="ed-card pad ed-access-card still">
      <span className="ed-wordmark"><span className="ed-wordmark-mark">MS</span><span>Editorial</span></span>
      <div className="ed-logo-row" aria-label="Publications">
        {LOGOS.map(logo => <PublicationLogo key={logo.brand} brand={logo.brand} height={logo.height} />)}
      </div>
      <h1>Sign in to the workspace</h1>
      <p>Use your editorial account. Articles, ratings, print intake and the archive for your publications are inside.</p>
      <form onSubmit={login}>
        <div className="ed-field">
          <label htmlFor="cms-email">Work email</label>
          <input id="cms-email" className="ed-input" type="email" autoComplete="username" required maxLength={320} value={email} onChange={event => setEmail(event.target.value)} placeholder="you@mshanken.com" disabled={pending} />
        </div>
        <div className="ed-field">
          <label htmlFor="cms-password">Password</label>
          <input id="cms-password" className="ed-input" type="password" autoComplete="current-password" required maxLength={4096} value={password} onChange={event => setPassword(event.target.value)} placeholder="Enter your password" disabled={pending} />
        </div>
        {error && <div className="ed-notice" data-tone="error" role="alert"><AlertCircle size={15} aria-hidden /><div>{error}</div></div>}
        <button className="ed-button primary" type="submit" disabled={pending} style={{ justifyContent: "center", marginTop: 4 }}>{pending ? "Signing in…" : "Enter workspace"}<ArrowRight size={15} aria-hidden /></button>
      </form>
      <p style={{ fontSize: 12.5 }}>Need an account or a password reset? Contact your workspace administrator.</p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 18 }}>
        <Link className="ed-button" href="/cms?demo=1&brand=wa">Explore the demo<ArrowUpRight size={14} aria-hidden /></Link>
      </div>
    </section>
  </main>;
}

export default function LoginPage() {
  return <Suspense fallback={<main className="ed ed-access" aria-busy="true" />}><LoginForm /></Suspense>;
}
