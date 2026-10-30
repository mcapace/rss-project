"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Activity, ArrowUpRight, Clock, Eye, FileText, Globe, Link2, MousePointerClick, Unplug, Users } from "lucide-react";
import type { CmsBrand } from "@/lib/cms/types";
import { AUDIENCE_PERIODS, type AudiencePeriod, type AudienceReport } from "@/lib/editorial/analytics-types";
import { BRAND_NAMES, formatDate } from "@/lib/editorial/helpers";
import { DataError } from "@/lib/editorial/data";
import { useEditorial } from "./EditorialProvider";
import { useAsync, useStoredState } from "./hooks";
import { BarList, Legend, LineChart, type Series } from "./charts";
import { Button, Card, Chips, Empty, Notice, PageHeader, SectionHead, Segmented, SkeletonRows } from "./ui";

const chartColor = (brand: CmsBrand) => `var(--chart-${brand})`;
const seconds = (value: number) => `${Math.floor(value / 60)}m ${Math.round(value % 60)}s`;
const percent = (value: number) => `${Math.round(value * 100)}%`;

function Scorecard({ label, value, previous, icon: Icon, format = (v: number) => v.toLocaleString(), lowerIsBetter }: { label: string; value: number; previous: number; icon: typeof Users; format?: (value: number) => string; lowerIsBetter?: boolean }) {
  const change = previous ? (value - previous) / previous : 0;
  const tone = Math.abs(change) < 0.005 ? "flat" : (change > 0) !== !!lowerIsBetter ? "up" : "down";
  return <div className="ed-kpi">
    <span className="ed-kpi-label">{label}<Icon size={15} strokeWidth={1.75} aria-hidden /></span>
    <strong>{format(value)}</strong>
    <small><span className="ed-delta" data-tone={tone}>{change > 0 ? "+" : ""}{(change * 100).toFixed(1)}% vs prior period</span></small>
  </div>;
}

function ConnectionCard({ onChanged }: { onChanged: () => void }) {
  const { brand, data, demo, user, toast } = useEditorial();
  const [tick, setTick] = useState(0);
  const status = useAsync(`ga-connection:${brand}:${tick}`, signal => data.analyticsConnection(brand, true, signal), { enabled: !demo && user.role === "admin" });
  const [choice, setChoice] = useState("");
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("connected")) toast("Google Analytics connected.", "success");
    if (params.get("error")) toast(params.get("error")!, "error");
    if (params.get("warning")) toast(params.get("warning")!, "default");
    if (params.has("connected") || params.has("error") || params.has("warning")) { params.delete("connected"); params.delete("error"); params.delete("warning"); window.history.replaceState(null, "", `${window.location.pathname}${params.size ? `?${params}` : ""}`); }
  }, [toast]);
  if (demo || user.role !== "admin") return null;
  const current = status.data;
  async function save(propertyId: string) {
    const property = current?.properties.find(item => item.propertyId === propertyId);
    setSaving(true);
    try { await data.setAnalyticsProperty(brand, propertyId, property?.displayName ?? null); toast("Property saved.", "success"); setTick(value => value + 1); onChanged(); }
    catch (error) { toast(error instanceof Error ? error.message : "Could not save the property.", "error"); }
    finally { setSaving(false); }
  }
  async function disconnect() {
    if (!window.confirm("Disconnect Google Analytics for this publication?")) return;
    try { await data.disconnectAnalytics(brand); toast("Disconnected.", "default"); setTick(value => value + 1); onChanged(); }
    catch (error) { toast(error instanceof Error ? error.message : "Could not disconnect.", "error"); }
  }
  return <Card flat pad="sm">
    <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 12 }}>
      <Globe size={16} aria-hidden style={{ color: "var(--muted)" }} />
      <div style={{ flex: "1 1 240px", minWidth: 0, fontSize: 13 }}>
        {status.loading && !current ? <span style={{ color: "var(--muted)" }}>Checking the Google connection…</span>
          : status.error ? <span style={{ color: "var(--negative)" }}>{status.error}</span>
          : current?.connected ? <><strong>Google connected</strong>{current.google_email ? ` as ${current.google_email}` : ""}{current.property_name || current.property_id ? ` · property ${current.property_name ?? current.property_id}` : " · choose a property"}</>
          : current?.service_account_property ? <><strong>Service account</strong> · property {current.service_account_property}</>
          : current?.oauth_available ? <>Connect the Google account that can see this publication&rsquo;s GA4 property, the same way the audience dashboard does.</>
          : <>Set <code>GOOGLE_CLIENT_ID</code>, <code>GOOGLE_CLIENT_SECRET</code> and <code>GOOGLE_REDIRECT_URI</code> (this site&rsquo;s <code>/api/cms/analytics/callback</code>) to connect with Google, or provide a service account.</>}
      </div>
      {current?.connected && current.properties.length > 0 && <select className="ed-select" style={{ width: "auto", maxWidth: 320 }} aria-label="GA4 property" value={choice || current.property_id || ""} disabled={saving} onChange={event => { setChoice(event.target.value); void save(event.target.value); }}>
        <option value="" disabled>Choose a property…</option>
        {current.properties.map(property => <option key={property.propertyId} value={property.propertyId}>{property.displayName} · {property.propertyId}</option>)}
      </select>}
      {current?.connected && current.properties_error && <span style={{ fontSize: 12, color: "var(--warning)" }}>{current.properties_error}</span>}
      {current?.oauth_available && <a className="ed-button sm" href={`/api/cms/analytics/connect?brand=${brand}`}><Link2 size={14} aria-hidden />{current.connected ? "Reconnect" : "Connect Google Analytics"}</a>}
      {current?.connected && <Button size="sm" variant="subtle" icon={Unplug} onClick={disconnect}>Disconnect</Button>}
    </div>
  </Card>;
}

export function Audience() {
  const { brand, brands, data, demo, href, mutationVersion, refresh } = useEditorial();
  const [days, setDays] = useStoredState<AudiencePeriod>("editorial-audience-days", 28, (value): value is AudiencePeriod => (AUDIENCE_PERIODS as readonly unknown[]).includes(value));
  const [compare, setCompare] = useState<CmsBrand[]>([]);
  const report = useAsync(`audience:${brand}:${days}:${mutationVersion}`, signal => data.audience(brand, days, signal));
  const others = useAsync(`audience-compare:${compare.join(",")}:${days}`, async signal => {
    const entries = await Promise.all(compare.map(async other => [other, await data.audience(other, days, signal)] as const));
    return Object.fromEntries(entries) as Partial<Record<CmsBrand, AudienceReport>>;
  }, { enabled: compare.length > 0 });
  const current = report.data;
  const setupNeeded = report.error && /connected|not been connected|setup/i.test(report.error);

  const series: Series[] = current ? [
    { id: brand, label: `${BRAND_NAMES[brand]} sessions`, color: chartColor(brand), values: current.daily.map(day => day.sessions) },
    ...(compare.length ? [] : [{ id: "prior", label: "Prior period", color: "var(--chart-prior)", values: current.previousDaily.map(day => day.sessions), dashed: true }]),
    ...compare.flatMap(other => others.data?.[other] ? [{ id: other, label: `${BRAND_NAMES[other]} sessions`, color: chartColor(other), values: others.data[other]!.daily.map(day => day.sessions) }] : []),
  ] : [];

  return <>
    <PageHeader icon={Activity} title="Audience" lede="Google Analytics for this publication: readers, engagement, the pages they open and where they come from."
      actions={<Segmented label="Period" value={String(days)} onChange={value => setDays(Number(value) as AudiencePeriod)} options={AUDIENCE_PERIODS.map(period => ({ id: String(period), label: `${period} days` }))} />}>
      <div className="ed-toolbar">
        <span style={{ fontSize: 12.5, color: "var(--muted)" }}>Compare</span>
        <Chips label="Compare publications" options={brands.filter(other => other !== brand).map(other => ({ id: other, label: BRAND_NAMES[other], dot: chartColor(other) }))} selected={compare} onToggle={other => setCompare(current => current.includes(other) ? current.filter(item => item !== other) : [...current, other])} />
        <span className="spacer" />
        {current && <span style={{ fontSize: 12.5, color: "var(--muted)" }}>{formatDate(current.start, { month: "short", day: "numeric" })} – {formatDate(current.end, { month: "short", day: "numeric" })}{current.source === "sample" ? " · sample data" : " · GA4"}</span>}
      </div>
    </PageHeader>

    <div style={{ marginBottom: 16 }}><ConnectionCard onChanged={refresh} /></div>
    {report.error && !current && (setupNeeded ? <Card><Empty icon={Globe} title="Connect Google Analytics" text={report.error} /></Card> : <Notice tone="error">{report.error}</Notice>)}
    {(demo || current?.source === "sample") && <div style={{ marginBottom: 16 }}><Notice>These are sample figures with the shape of a GA4 report. Connect a property to see real readers.</Notice></div>}

    {report.loading && !current ? <Card><SkeletonRows rows={6} /></Card> : current && <div className="ed-stack">
      <Card pad={false} className="still">
        <div className="ed-kpi-strip" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))" }}>
          <Scorecard label="Sessions" value={current.totals.sessions} previous={current.previous.sessions} icon={MousePointerClick} />
          <Scorecard label="Readers" value={current.totals.users} previous={current.previous.users} icon={Users} />
          <Scorecard label="New readers" value={current.totals.newUsers} previous={current.previous.newUsers} icon={ArrowUpRight} />
          <Scorecard label="Page views" value={current.totals.pageViews} previous={current.previous.pageViews} icon={Eye} />
          <Scorecard label="Engagement rate" value={current.totals.engagementRate} previous={current.previous.engagementRate} icon={Activity} format={percent} />
          <Scorecard label="Avg. engagement" value={current.totals.avgEngagementSeconds} previous={current.previous.avgEngagementSeconds} icon={Clock} format={seconds} />
        </div>
      </Card>

      <Card>
        <SectionHead title="Sessions by day" detail={compare.length ? "Publications compared on the same scale" : "Solid is this period; dashed is the period before"} />
        <LineChart ariaLabel="Daily sessions" labels={current.daily.map(day => day.date)} series={series} formatLabel={label => formatDate(label, { month: "short", day: "numeric" })} />
        <Legend series={series} />
      </Card>

      <div style={{ display: "grid", gap: 16, gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 380px), 1fr))" }}>
        <Card>
          <SectionHead title="Top pages" detail="By page views this period" />
          <div className="ed-list">
            {current.topPages.slice(0, 8).map((page, index) => <div key={page.path} className="ed-row">
              <span className="rank">{index + 1}</span>
              <div className="grow"><span className="title">{page.title || page.path}</span><span className="meta">{page.path} · {percent(page.engagementRate)} engaged</span></div>
              <span className="tabular" style={{ fontSize: 13, fontWeight: 600 }}>{page.pageViews.toLocaleString()}</span>
            </div>)}
          </div>
        </Card>
        <div style={{ display: "grid", gap: 16 }}>
          <Card>
            <SectionHead title="Where readers come from" detail="Share of sessions by channel" />
            <BarList rows={current.channels.map(channel => ({ label: channel.name, value: channel.sessions, detail: percent(channel.share) }))} color={chartColor(brand)} format={value => `${value.toLocaleString()} · ${percent(value / Math.max(1, current.totals.sessions))}`} />
          </Card>
          <Card>
            <SectionHead title="Devices" />
            <BarList rows={current.devices.map(device => ({ label: device.name, value: device.sessions }))} color={chartColor(brand)} format={value => percent(value / Math.max(1, current.totals.sessions))} />
          </Card>
        </div>
      </div>

      <Card flat pad="sm">
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10, fontSize: 12.5, color: "var(--muted)" }}>
          <FileText size={14} aria-hidden />Published stories show their own readership in the editor&rsquo;s Performance panel.
          <Link className="ed-link" href={href("/cms/library", { state: "published" })} style={{ marginLeft: "auto" }}>Open published stories</Link>
        </div>
      </Card>
    </div>}
  </>;
}

export function isAnalyticsSetupError(error: unknown): boolean {
  return error instanceof DataError && error.code === "setup_required";
}
