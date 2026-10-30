import Link from "next/link";
import { ArrowRight, ArrowUpRight } from "lucide-react";
import "./cms.css";

export function CmsAccessScreen({ reason }: { reason: "setup" | "denied" | "unavailable" }) {
  const content = {
    setup: { title: "Your new editorial workspace.", text: "The workspace is built and ready to connect to a development content database. Explore the editor now with sample stories, ratings, and revision history.", action: "Explore the interactive demo" },
    denied: { title: "Your account needs CMS access.", text: "Ask your workspace administrator to assign your editorial role and publications. You can sign in with a different account or explore the editor with sample content.", action: "Explore the demo" },
    unavailable: { title: "The workspace is temporarily unavailable.", text: "We could not verify your access right now. Please try signing in again. Your stored content has not been changed.", action: "Explore the demo" },
  }[reason];
  return <main className="cms-access"><section className="cms-access-card">
    <div className="cms-wordmark"><span className="cms-monogram">M</span><span>SHANKEN<small>EDITORIAL WORKSPACE</small></span></div>
    <div className="cms-eyebrow">In-house publishing</div><h1>{content.title}</h1><p>{content.text}</p>
    <div className="cms-access-actions"><Link className="cms-button" href="/cms/demo">{content.action}<ArrowRight size={15} /></Link><Link className="cms-button secondary" href="/login">Sign in<ArrowUpRight size={14} /></Link></div>
  </section></main>;
}
