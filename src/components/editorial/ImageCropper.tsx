"use client";

import { useCallback, useMemo, useState } from "react";
import { Crosshair, Download, RotateCcw } from "lucide-react";
import { ASPECT_PRESETS, fitCrop, normalizeCrop, renderCrop, type CropRect, type FocalPoint } from "@/lib/editorial/image-tools";
import { Button, Dialog, Segmented } from "./ui";

export type CropSet = Record<string, CropRect>;

type Props = {
  open: boolean;
  onClose: () => void;
  src: string | null;
  title: string;
  crops: CropSet;
  focal: FocalPoint | null;
  onSave: (crops: CropSet, focal: FocalPoint) => void;
};

function StageImage({ src, onAspect }: { src: string; onAspect: (aspect: number) => void }) {
  // eslint-disable-next-line @next/next/no-img-element -- Presigned S3 and data URLs cannot go through the image optimizer.
  return <img src={src} alt="" draggable={false} onLoad={event => onAspect(event.currentTarget.naturalWidth / Math.max(1, event.currentTarget.naturalHeight))} />;
}

class DragHolder {
  current: Drag | null = null;
  set(next: Drag | null) { this.current = next; }
}

type Drag = { kind: "move" | "nw" | "ne" | "sw" | "se" | "focal"; startX: number; startY: number; start: CropRect };

/**
 * A crop tool that stores geometry, not pixels. Each aspect preset keeps its own
 * crop; the focal point seeds new crops and tells renderers what to keep when
 * they cut a size we did not plan for.
 */
export function ImageCropper({ open, onClose, src, title, crops, focal, onSave }: Props) {
  const [preset, setPreset] = useState<string>("16:9");
  const [working, setWorking] = useState<CropSet>(crops);
  const [point, setPoint] = useState<FocalPoint>(focal ?? { x: 0.5, y: 0.5 });
  const [aspect, setAspect] = useState(1.5);
  const [mode, setMode] = useState<"crop" | "focal">("crop");
  const [exporting, setExporting] = useState(false);
  const [note, setNote] = useState("");
  // A mutable holder for the in-progress drag; it never drives rendering.
  const [drag] = useState(() => new DragHolder());

  const ratio = ASPECT_PRESETS.find(item => item.id === preset)?.ratio ?? null;
  const crop = useMemo<CropRect>(() => working[preset] ?? fitCrop(aspect, ratio, point), [working, preset, aspect, ratio, point]);
  const update = useCallback((next: CropRect) => setWorking(current => ({ ...current, [preset]: normalizeCrop(next, aspect, ratio) })), [preset, aspect, ratio]);

  const toImage = (event: React.PointerEvent): { x: number; y: number } => {
    const rect = (event.currentTarget.closest(".ed-crop-stage") as HTMLElement).getBoundingClientRect();
    return { x: (event.clientX - rect.left) / rect.width, y: (event.clientY - rect.top) / rect.height };
  };
  const onPointerDown = (kind: Drag["kind"]) => (event: React.PointerEvent) => {
    event.preventDefault(); event.stopPropagation();
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    const position = toImage(event);
    if (kind === "focal" || mode === "focal") { setPoint({ x: position.x, y: position.y }); drag.set({ kind: "focal", startX: position.x, startY: position.y, start: crop }); return; }
    drag.set({ kind, startX: position.x, startY: position.y, start: crop });
  };
  const onPointerMove = (event: React.PointerEvent) => {
    const current = drag.current;
    if (!current) return;
    const position = toImage(event);
    if (current.kind === "focal") { setPoint({ x: Math.min(1, Math.max(0, position.x)), y: Math.min(1, Math.max(0, position.y)) }); return; }
    const dx = position.x - current.startX, dy = position.y - current.startY;
    const start = current.start;
    if (current.kind === "move") { update({ ...start, x: start.x + dx, y: start.y + dy }); return; }
    let { x, y, w, h } = start;
    if (current.kind.includes("e")) w = start.w + dx; else { x = start.x + dx; w = start.w - dx; }
    if (current.kind.includes("s")) h = start.h + dy; else { y = start.y + dy; h = start.h - dy; }
    if (ratio) {
      const wForH = h * (ratio / aspect);
      if (current.kind.includes("w")) x = start.x + start.w - wForH;
      w = wForH;
    }
    update({ x, y, w: Math.max(0.05, w), h: Math.max(0.05, h) });
  };
  const onPointerUp = () => { drag.set(null); };

  async function download() {
    if (!src) return;
    setExporting(true); setNote("");
    const blob = await renderCrop(src, crop);
    setExporting(false);
    if (!blob) { setNote("This image cannot be exported from the browser (it is served from another origin). The crop geometry is still saved and applied at delivery."); return; }
    const url = URL.createObjectURL(blob);
    const anchor = Object.assign(document.createElement("a"), { href: url, download: `${title.replace(/[^a-z0-9]+/gi, "-").toLowerCase() || "image"}-${preset.replace(":", "x")}.jpg` });
    anchor.click();
    URL.revokeObjectURL(url);
  }

  const handles: Drag["kind"][] = ["nw", "ne", "sw", "se"];
  return <Dialog open={open} onClose={onClose} title="Crop image" description="Each size keeps its own crop. The focal point tells layouts what to keep when they cut a size you did not plan."
    footer={<>
      <Button variant="subtle" icon={RotateCcw} onClick={() => setWorking(current => { const next = { ...current }; delete next[preset]; return next; })}>Reset this size</Button>
      <Button icon={Download} disabled={exporting || !src} onClick={download}>{exporting ? "Exporting…" : "Download crop"}</Button>
      <Button variant="primary" onClick={() => { onSave({ ...working, [preset]: crop }, point); onClose(); }}>Save crops</Button>
    </>}>
    <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center", justifyContent: "space-between" }}>
      <Segmented label="Aspect" size="sm" value={preset} onChange={setPreset} options={ASPECT_PRESETS.map(item => ({ id: item.id, label: item.label }))} />
      <Segmented label="Tool" size="sm" value={mode} onChange={setMode} options={[{ id: "crop", label: "Crop" }, { id: "focal", label: "Focal point" }]} />
    </div>
    <p style={{ fontSize: 12.5, color: "var(--muted)" }}>{ASPECT_PRESETS.find(item => item.id === preset)?.hint}{working[preset] ? " · custom crop saved" : " · default from the focal point"}</p>
    <div className="ed-crop-stage" onPointerDown={onPointerDown("focal")} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp} style={{ aspectRatio: aspect }}>
      {src ? <StageImage src={src} onAspect={setAspect} /> : <div className="ed-crop-missing">Preview unavailable</div>}
      <div className="ed-crop-shade" style={{ clipPath: `polygon(0 0, 100% 0, 100% 100%, 0 100%, 0 ${crop.y * 100}%, ${crop.x * 100}% ${crop.y * 100}%, ${crop.x * 100}% ${(crop.y + crop.h) * 100}%, ${(crop.x + crop.w) * 100}% ${(crop.y + crop.h) * 100}%, ${(crop.x + crop.w) * 100}% ${crop.y * 100}%, 0 ${crop.y * 100}%)` }} />
      <div className="ed-crop-box" role="group" aria-label="Crop area" style={{ left: `${crop.x * 100}%`, top: `${crop.y * 100}%`, width: `${crop.w * 100}%`, height: `${crop.h * 100}%` }} onPointerDown={onPointerDown("move")}>
        <span className="ed-crop-grid" aria-hidden />
        {handles.map(handle => <button key={handle} type="button" className={`ed-crop-handle ${handle}`} aria-label={`Resize from ${handle}`} onPointerDown={onPointerDown(handle)} />)}
      </div>
      <button type="button" className="ed-crop-focal" aria-label="Focal point" title="Focal point" style={{ left: `${point.x * 100}%`, top: `${point.y * 100}%` }} onPointerDown={onPointerDown("focal")}><Crosshair size={14} aria-hidden /></button>
    </div>
    <div style={{ display: "flex", flexWrap: "wrap", gap: 12, fontSize: 12, color: "var(--muted)" }}>
      <span>Crop {Math.round(crop.w * 100)}% × {Math.round(crop.h * 100)}% at {Math.round(crop.x * 100)}%, {Math.round(crop.y * 100)}%</span>
      <span>Focal point {Math.round(point.x * 100)}%, {Math.round(point.y * 100)}%</span>
      <span>{Object.keys(working).length} saved {Object.keys(working).length === 1 ? "size" : "sizes"}</span>
    </div>
    {note && <p role="status" style={{ fontSize: 12.5, color: "var(--warning)" }}>{note}</p>}
  </Dialog>;
}
