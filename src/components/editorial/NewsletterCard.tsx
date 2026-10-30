"use client";

import { useState } from "react";
import { Mail, Send } from "lucide-react";
import type { CmsDocument } from "@/lib/cms/types";
import { KIND_LABELS, NEWSLETTER_KINDS, type NewsletterKind } from "@/lib/newsletter/render";
import { formatDateTime, isoToLocalInput, localInputToIso, relativeTime } from "@/lib/editorial/helpers";
import { useEditorial } from "./EditorialProvider";
import { useAsync } from "./hooks";
import { Button, Card, Field, Pill } from "./ui";

/**
 * Mark a story as a Daily Alert (or another send) and push it to the ESP.
 * The subject defaults to the headline; the email is rendered from the saved
 * story, so unsaved edits are flagged first. Every attempt is listed below.
 */
export function NewsletterCard({ document, dirty }: { document: CmsDocument; dirty: boolean }) {
  const { data, toast, demo } = useEditorial();
  const [kind, setKind] = useState<NewsletterKind>("daily_alert");
  const [subject, setSubject] = useState(document.title);
  const [preheader, setPreheader] = useState(document.excerpt.slice(0, 140));
  const [sendAt, setSendAt] = useState("");
  const [sending, setSending] = useState(false);
  const [token, setToken] = useState(0);
  const sends = useAsync(`newsletter:${document.id}`, signal => data.newsletterSends(document.id, signal), { refreshToken: token });

  async function send() {
    if (!subject.trim() || sending) return;
    setSending(true);
    try {
      const result = await data.sendNewsletter(document.id, { kind, subject: subject.trim(), preheader: preheader.trim() || undefined, send_at: localInputToIso(sendAt) });
      toast(result.status === "simulated" ? "Rendered and logged. Connect Braze to send for real." : result.status === "scheduled" ? "Scheduled with the ESP." : "Sent to the ESP.", result.status === "failed" ? "error" : "success");
      setToken(value => value + 1);
    } catch (failure) { toast(failure instanceof Error ? failure.message : "The send could not be queued.", "error"); }
    finally { setSending(false); }
  }

  const history = sends.data?.sends ?? [];
  return <Card pad={false} className="ed-rail-card still">
    <h3>Newsletter <Mail size={14} aria-hidden /></h3>
    <Field label="Send as" htmlFor="ed-nl-kind">
      <select id="ed-nl-kind" className="ed-select" value={kind} onChange={event => setKind(event.target.value as NewsletterKind)}>
        {NEWSLETTER_KINDS.map(option => <option key={option} value={option}>{KIND_LABELS[option]}</option>)}
      </select>
    </Field>
    <Field label="Subject" htmlFor="ed-nl-subject" hint={`${subject.length}/300`}><input id="ed-nl-subject" className="ed-input" maxLength={300} value={subject} onChange={event => setSubject(event.target.value)} /></Field>
    <Field label="Preheader" htmlFor="ed-nl-preheader" hint="The preview line inboxes show after the subject."><input id="ed-nl-preheader" className="ed-input" maxLength={300} value={preheader} onChange={event => setPreheader(event.target.value)} /></Field>
    <Field label="Send time" htmlFor="ed-nl-when" hint="Leave empty to send now."><input id="ed-nl-when" type="datetime-local" className="ed-input" value={isoToLocalInput(localInputToIso(sendAt))} onChange={event => setSendAt(event.target.value)} /></Field>
    {dirty && <p style={{ marginTop: 10, fontSize: 12.5, color: "var(--warning)" }}>Save the story first: the email is rendered from the saved version.</p>}
    <div style={{ marginTop: 12, display: "flex", alignItems: "center", gap: 8 }}>
      <Button variant="primary" size="sm" icon={Send} disabled={sending || dirty || !subject.trim()} onClick={send}>{sending ? "Sending…" : sendAt ? "Schedule" : "Send to ESP"}</Button>
      {sends.data && !sends.data.configured && <span style={{ fontSize: 12, color: "var(--muted)" }}>{demo ? "Demo: sends are simulated." : "ESP not connected: sends are logged, not delivered."}</span>}
    </div>
    {history.length > 0 && <div className="ed-list" style={{ marginTop: 14 }}>
      {history.slice(0, 5).map(send => <div key={send.id} className="ed-row" style={{ padding: "8px 0" }}>
        <div className="grow"><span className="title" style={{ fontSize: 13 }}>{KIND_LABELS[send.kind]} · {send.subject}</span><span className="meta" title={formatDateTime(send.created_at)}>{relativeTime(send.created_at)}{send.send_at ? ` · for ${formatDateTime(send.send_at)}` : ""}{send.error ? ` · ${send.error}` : ""}</span></div>
        <Pill tone={send.status === "sent" ? "published" : send.status === "failed" ? "failed" : send.status === "scheduled" ? "scheduled" : send.status === "simulated" ? "draft" : "queued"}>{send.status}</Pill>
      </div>)}
    </div>}
  </Card>;
}
