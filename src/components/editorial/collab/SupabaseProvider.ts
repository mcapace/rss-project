"use client";

import { createClient, type RealtimeChannel, type SupabaseClient } from "@supabase/supabase-js";
import * as Y from "yjs";
import { Awareness, applyAwarenessUpdate, encodeAwarenessUpdate, removeAwarenessStates } from "y-protocols/awareness";
import type { RealtimeGrant } from "@/lib/editorial/platform-types";

/**
 * A Yjs provider over Supabase Realtime. Document updates and awareness
 * (cursors, presence) travel as broadcast messages on one channel per
 * document; a newcomer asks for the full state and the first peer to answer
 * brings it up to date. The durable copy lives in cms_collab_documents and is
 * saved by the owner through the collab route, debounced.
 */
export type ProviderStatus = "connecting" | "connected" | "disconnected";
export type Peer = { clientId: number; id: string; name: string; color: string };

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}
export function fromBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export class SupabaseProvider {
  readonly doc: Y.Doc;
  readonly awareness: Awareness;
  status: ProviderStatus = "connecting";
  synced = false;
  private client: SupabaseClient;
  private channel: RealtimeChannel;
  private listeners = new Set<() => void>();
  private persistTimer: ReturnType<typeof setTimeout> | null = null;
  private destroyed = false;
  private syncTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private documentId: string, private grant: RealtimeGrant, doc: Y.Doc, private persist: (stateBase64: string) => Promise<void>) {
    this.doc = doc;
    this.awareness = new Awareness(doc);
    this.awareness.setLocalStateField("user", { id: grant.user.id, name: grant.user.name, color: grant.user.color });
    this.client = createClient(grant.url, grant.key, { auth: { persistSession: false, autoRefreshToken: false }, realtime: { params: { eventsPerSecond: 20 } } });
    this.client.realtime.setAuth(grant.token);
    this.channel = this.client.channel(`cms:doc:${documentId}`, { config: { broadcast: { self: false, ack: false }, presence: { key: `${grant.user.id}:${doc.clientID}` } } });

    this.doc.on("update", this.onDocUpdate);
    this.awareness.on("update", this.onAwarenessUpdate);
    this.channel
      .on("broadcast", { event: "update" }, ({ payload }) => { if (payload?.u) Y.applyUpdate(this.doc, fromBase64(payload.u), this); })
      .on("broadcast", { event: "awareness" }, ({ payload }) => { if (payload?.a) applyAwarenessUpdate(this.awareness, fromBase64(payload.a), this); })
      .on("broadcast", { event: "sync-request" }, ({ payload }) => {
        // Reply with what the asker is missing; every peer answers, Yjs merges are idempotent.
        if (!payload?.sv || payload.from === this.doc.clientID) return;
        const diff = Y.encodeStateAsUpdate(this.doc, fromBase64(payload.sv));
        void this.channel.send({ type: "broadcast", event: "sync-response", payload: { to: payload.from, u: toBase64(diff) } });
        void this.channel.send({ type: "broadcast", event: "awareness", payload: { a: toBase64(encodeAwarenessUpdate(this.awareness, [this.doc.clientID])) } });
      })
      .on("broadcast", { event: "sync-response" }, ({ payload }) => {
        if (payload?.to !== this.doc.clientID || !payload.u) return;
        Y.applyUpdate(this.doc, fromBase64(payload.u), this);
        this.markSynced();
      })
      .on("presence", { event: "sync" }, () => this.emit())
      .on("presence", { event: "leave" }, ({ leftPresences }) => {
        const gone = (leftPresences as { clientId?: number }[]).map(p => p.clientId).filter((id): id is number => typeof id === "number");
        if (gone.length) removeAwarenessStates(this.awareness, gone, this);
        this.emit();
      })
      .subscribe(async status => {
        if (status === "SUBSCRIBED") {
          this.status = "connected";
          await this.channel.track({ clientId: this.doc.clientID, id: grant.user.id, name: grant.user.name, color: grant.user.color });
          void this.channel.send({ type: "broadcast", event: "sync-request", payload: { from: this.doc.clientID, sv: toBase64(Y.encodeStateVector(this.doc)) } });
          // Alone in the room: nobody will answer, so the loaded state is the truth.
          this.syncTimer = setTimeout(() => this.markSynced(), 1200);
        } else if (status === "CLOSED" || status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          this.status = "disconnected";
          if (!this.synced) this.markSynced();
        }
        this.emit();
      });
  }

  private markSynced() {
    if (this.synced) return;
    this.synced = true;
    if (this.syncTimer) { clearTimeout(this.syncTimer); this.syncTimer = null; }
    this.emit();
  }

  private onDocUpdate = (update: Uint8Array, origin: unknown) => {
    if (origin === this) return;
    if (this.status === "connected") void this.channel.send({ type: "broadcast", event: "update", payload: { u: toBase64(update) } });
    this.schedulePersist();
  };

  private onAwarenessUpdate = ({ added, updated, removed }: { added: number[]; updated: number[]; removed: number[] }, origin: unknown) => {
    if (origin === this) { this.emit(); return; }
    const changed = [...added, ...updated, ...removed];
    if (this.status === "connected") void this.channel.send({ type: "broadcast", event: "awareness", payload: { a: toBase64(encodeAwarenessUpdate(this.awareness, changed)) } });
    this.emit();
  };

  private schedulePersist() {
    if (this.persistTimer) clearTimeout(this.persistTimer);
    this.persistTimer = setTimeout(() => { this.persistTimer = null; void this.persist(toBase64(Y.encodeStateAsUpdate(this.doc))).catch(() => undefined); }, 2500);
  }

  /** Flush the durable copy now (before unload or after a save). */
  async flush(): Promise<void> {
    if (this.persistTimer) { clearTimeout(this.persistTimer); this.persistTimer = null; }
    await this.persist(toBase64(Y.encodeStateAsUpdate(this.doc))).catch(() => undefined);
  }

  get peers(): Peer[] {
    const out: Peer[] = [];
    this.awareness.getStates().forEach((state, clientId) => {
      const user = (state as { user?: Peer }).user;
      if (user && clientId !== this.doc.clientID) out.push({ clientId, id: user.id, name: user.name, color: user.color });
    });
    return out;
  }

  subscribe(listener: () => void): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  private emit() { for (const listener of this.listeners) listener(); }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.doc.off("update", this.onDocUpdate);
    this.awareness.off("update", this.onAwarenessUpdate);
    removeAwarenessStates(this.awareness, [this.doc.clientID], "destroy");
    if (this.syncTimer) clearTimeout(this.syncTimer);
    if (this.persistTimer) { clearTimeout(this.persistTimer); this.persistTimer = null; void this.persist(toBase64(Y.encodeStateAsUpdate(this.doc))).catch(() => undefined); }
    void this.client.removeChannel(this.channel);
    this.listeners.clear();
  }
}
