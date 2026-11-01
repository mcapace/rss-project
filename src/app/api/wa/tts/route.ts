import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Read a story aloud with ElevenLabs. The browser sends one paragraph at a
 * time and plays them in order; this route returns MP3 for each.
 *
 * Environment: ELEVENLABS_API_KEY; WA_TTS_VOICE (default: the voice chosen for
 * the site) and WA_TTS_MODEL (default eleven_multilingual_v2) to change them.
 * Without a key the route answers 503 and the page falls back to the
 * browser's own voice.
 */
const VOICE = process.env.WA_TTS_VOICE || "QZoQyUsVm65Zakb1JZjn";
const MODEL = process.env.WA_TTS_MODEL || "eleven_multilingual_v2";
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type" };
const bucket = new Map<string, { count: number; at: number }>();

function limited(ip: string) {
  const now = Date.now(); const hit = bucket.get(ip);
  if (!hit || now - hit.at > 60_000) { bucket.set(ip, { count: 1, at: now }); return false; }
  hit.count += 1; return hit.count > 60;
}

export function OPTIONS() { return new NextResponse(null, { status: 204, headers: CORS }); }

export async function POST(request: Request) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  if (limited(ip)) return NextResponse.json({ error: "Too many requests from this connection." }, { status: 429, headers: CORS });
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) return NextResponse.json({ error: "Recorded narration is unavailable. You can use your browser’s voice when supported." }, { status: 503, headers: CORS });
  let body: { text?: string };
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Send JSON." }, { status: 400, headers: CORS }); }
  const text = String(body.text ?? "").replace(/\s+/g, " ").trim().slice(0, 2500);
  if (text.length < 2) return NextResponse.json({ error: "Nothing to read." }, { status: 400, headers: CORS });
  try {
    const upstream = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${VOICE}?output_format=mp3_44100_96`, {
      method: "POST",
      headers: { "xi-api-key": key, "Content-Type": "application/json", Accept: "audio/mpeg" },
      body: JSON.stringify({ text, model_id: MODEL, voice_settings: { stability: 0.45, similarity_boost: 0.8, style: 0.15, use_speaker_boost: true } }),
      signal: AbortSignal.timeout(50_000),
    });
    if (!upstream.ok || !upstream.body) {
      const detail = await upstream.text().catch(() => "");
      console.error("[wa/tts]", upstream.status, detail.slice(0, 200));
      return NextResponse.json({ error: "The voice is unavailable right now." }, { status: 502, headers: CORS });
    }
    return new NextResponse(upstream.body, { headers: { ...CORS, "Content-Type": "audio/mpeg", "Cache-Control": "private, max-age=3600" } });
  } catch (error) {
    console.error("[wa/tts]", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "The voice is unavailable right now." }, { status: 502, headers: CORS });
  }
}
