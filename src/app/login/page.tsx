"use client";

import Link from "next/link";
import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowRight, ArrowUpRight, AlertCircle } from "lucide-react";
import { safeRedirect } from "@/lib/cms/access";
import "@/components/cms/cms.css";

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
  return <main className="cms-login">
    <section className="cms-login-story">
      <div className="cms-wordmark"><span className="cms-monogram">M</span><span>SHANKEN<small>EDITORIAL WORKSPACE</small></span></div>
      <div className="cms-login-intro"><div className="cms-eyebrow">The next chapter</div><h1>Great stories.<br />Your own <em>workspace.</em></h1><p>A home for the people, ideas, and expertise behind our publications. From the printed page to the next edition of the web.</p></div>
      <div className="cms-login-foot">M. Shanken Communications</div>
    </section>
    <section className="cms-login-form-wrap"><div className="cms-login-form">
      <div className="cms-eyebrow">Editorial access</div><h2>Welcome to your workspace.</h2><p>Sign in with your assigned editorial account.</p>
      <form onSubmit={login}>
        <label htmlFor="cms-email">Work email<input id="cms-email" type="email" autoComplete="username" required maxLength={320} value={email} onChange={event => setEmail(event.target.value)} placeholder="you@mshanken.com" disabled={pending} /></label>
        <label htmlFor="cms-password">Password<input id="cms-password" type="password" autoComplete="current-password" required maxLength={4096} value={password} onChange={event => setPassword(event.target.value)} placeholder="Enter your password" disabled={pending} /></label>
        {error && <div className="cms-alert" role="alert"><AlertCircle size={17} /><span>{error}</span></div>}
        <button className="cms-button" type="submit" disabled={pending}>{pending ? "Signing in…" : "Enter workspace"}<ArrowRight size={15} /></button>
      </form>
      <p className="cms-login-help">Need an account or a password reset? Contact your workspace administrator.</p>
      <Link href="/cms/demo" className="cms-login-demo"><span>Explore the editor with sample content</span><ArrowUpRight size={15} /></Link>
    </div></section>
  </main>;
}

export default function LoginPage() {
  return <Suspense fallback={<main className="cms-access"><p>Loading sign-in…</p></main>}><LoginForm /></Suspense>;
}
