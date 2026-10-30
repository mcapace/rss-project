import Link from "next/link";
import { ArrowLeft, Search } from "lucide-react";
import "@/components/editorial/editorial.css";

export default function NotFound() {
  return <main className="ed ed-access">
    <section className="ed-card pad ed-access-card still">
      <span className="ed-wordmark"><span className="ed-wordmark-mark">MS</span><span>Editorial</span></span>
      <h1>This page does not exist</h1>
      <p>The story, issue or page you followed may have moved. The content library and search can find it by title or keyword.</p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 22 }}>
        <Link className="ed-button primary" href="/cms"><ArrowLeft size={15} aria-hidden />Back to the workspace</Link>
        <Link className="ed-button" href="/cms/search"><Search size={15} aria-hidden />Search</Link>
      </div>
    </section>
  </main>;
}
