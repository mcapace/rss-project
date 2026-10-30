"use client";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import * as Y from "yjs";
import type { EditorialData } from "@/lib/editorial/data";
import { fromBase64, SupabaseProvider, type Peer, type ProviderStatus } from "./SupabaseProvider";

export type Collaboration = {
  doc: Y.Doc;
  provider: SupabaseProvider | null;
  /** True once the durable state is loaded and peers have had a chance to answer. */
  ready: boolean;
  status: ProviderStatus | "off";
  peers: Peer[];
  user: { id: string; name: string; color: string } | null;
  /** Nothing in the shared document yet: the first editor seeds it from body_html. */
  empty: boolean;
};

/**
 * Real-time collaboration for one document. Loads the durable Yjs state,
 * joins the Realtime channel and exposes presence. When the workspace has
 * no Realtime grant (demo, or Realtime not configured) it reports `off` and
 * the editor works exactly as before.
 */
export function useCollaboration(documentId: string | null, data: EditorialData, enabled: boolean): Collaboration {
  const doc = useMemo(() => new Y.Doc(), [documentId]); // eslint-disable-line react-hooks/exhaustive-deps -- one shared document per CMS document
  const [provider, setProvider] = useState<SupabaseProvider | null>(null);
  const [state, setState] = useState<{ ready: boolean; status: Collaboration["status"]; user: Collaboration["user"] }>({ ready: false, status: "connecting", user: null });
  const off = !documentId || !enabled;

  useEffect(() => {
    if (!documentId || !enabled) return;
    let cancelled = false;
    let created: SupabaseProvider | null = null;
    (async () => {
      try {
        const [grant, stored] = await Promise.all([data.realtimeGrant(), data.collabState(documentId)]);
        if (cancelled) return;
        if (stored?.state_base64) Y.applyUpdate(doc, fromBase64(stored.state_base64), "load");
        created = new SupabaseProvider(documentId, grant, doc, stateBase64 => data.saveCollabState(documentId, stateBase64));
        setProvider(created);
        setState({ ready: created.synced, status: created.status, user: grant.user });
        created.subscribe(() => { if (!cancelled && created) setState({ ready: created.synced, status: created.status, user: grant.user }); });
      } catch {
        if (!cancelled) setState({ ready: true, status: "off", user: null });
      }
    })();
    return () => { cancelled = true; created?.destroy(); setProvider(null); };
  }, [documentId, enabled, data, doc]);

  const peers = useSyncExternalStore(
    listener => provider ? provider.subscribe(listener) : () => {},
    () => provider ? JSON.stringify(provider.peers) : "[]",
    () => "[]",
  );

  useEffect(() => {
    if (!provider) return;
    const flush = () => { void provider.flush(); };
    window.addEventListener("pagehide", flush);
    return () => window.removeEventListener("pagehide", flush);
  }, [provider]);

  return {
    doc, provider, ready: off || state.ready, status: off ? "off" : state.status, peers: JSON.parse(peers) as Peer[], user: off ? null : state.user,
    empty: doc.getXmlFragment("default").length === 0,
  };
}
