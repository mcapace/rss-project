import Link from "next/link";
import { ArrowRight, ArrowUpRight } from "lucide-react";
import "./editorial.css";

/** Shown when the connected workspace cannot be opened; the demo always works. */
export function AccessScreen({ reason }: { reason: "setup" | "denied" | "unavailable" }) {
  const content = {
    setup: { title: "Your editorial workspace", text: "The workspace is built and ready to connect to a content database. Until then, explore the editor with sample stories, ratings and revision history." },
    denied: { title: "Your account needs CMS access", text: "Ask a workspace administrator to assign your editorial role and publications. You can sign in with a different account or explore the editor with sample content." },
    unavailable: { title: "The workspace is temporarily unavailable", text: "We could not verify your access right now. Please try signing in again. Your stored content has not been changed." },
  }[reason];
  return <main className="ed ed-access">
    <section className="ed-card pad ed-access-card still">
      <span className="ed-wordmark"><span className="ed-wordmark-mark">MS</span><span>Editorial</span></span>
      <h1>{content.title}</h1>
      <p>{content.text}</p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 22 }}>
        <Link className="ed-button primary" href="/cms?demo=1&brand=wa">Explore the demo<ArrowRight size={15} aria-hidden /></Link>
        <Link className="ed-button" href="/login">Sign in<ArrowUpRight size={14} aria-hidden /></Link>
      </div>
    </section>
  </main>;
}
