// app/api/identify/route.ts
import { NextResponse } from "next/server";
export const runtime = "nodejs";

const ALLOWED = ["image/jpeg", "image/png", "image/webp"];

const systemContent = `You are an expert chili pepper taxonomist.
Identify the MOST LIKELY specific chili pepper variety (cultivar or common trade name), not a generic description.
Examples: "Ají Charapita", "Habanero Chocolate", "Jalapeño", "Serrano", "Piquillo".

Rules:
- Always provide a primary variety name. If uncertain, pick the closest match and explain uncertainty.
- Do NOT answer with only "small yellow chili" or other generic labels.
- If absolutely impossible, return "Unknown variety" but explain why.
- Base your guess only on visible traits: approximate pod size (in cm if possible), shape, surface (smooth/wrinkled), calyx/shoulders, pedicel length/thickness, clustering vs solitary fruiting, color, ribbing, tip (blunt/pointed), any visible leaves/stems.

Return STRICT JSON only with this schema (no markdown):
{
  "primary": {
    "name": "string",
    "species": "string",
    "alt_names": ["string"],
    "confidence": 0.0,
    "scoville_range": [min, max],
    "distinguishing_features": ["string"],
    "notes": "string"
  },
  "alternates": [
    { "name": "string", "reason": "string", "scoville_range": [min, max] }
  ],
  "uncertainty": "string"
}
`;

export async function POST(req: Request) {
  try {
    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json({ ok: false, error: "Missing OPENAI_API_KEY" }, { status: 500 });
    }

    const form = await req.formData();
    const file = form.get("file") as File | null;
    if (!file) return NextResponse.json({ ok: false, error: "No file provided" }, { status: 400 });
    if (!ALLOWED.includes(file.type)) return NextResponse.json({ ok: false, error: "Unsupported file type" }, { status: 400 });
    if (file.size > 3 * 1024 * 1024) return NextResponse.json({ ok: false, error: "Max 3 MB" }, { status: 400 });

    const buffer = Buffer.from(await file.arrayBuffer());
    const dataUrl = `data:${file.type};base64,${buffer.toString("base64")}`;

    const body = {
      model: process.env.OPENAI_MODEL || "gpt-4o-mini",
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: systemContent },
        {
          role: "user",
          content: [
            { type: "text", text: "Identify this chili pepper variety from the image using only visible traits. Include an approximate size in cm if possible." },
            { type: "image_url", image_url: { url: dataUrl } }
          ]
        }
      ]
    };

    const resp = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify(body),
    });

    if (!resp.ok) {
      const errText = await resp.text().catch(() => "");
      return NextResponse.json(
        { ok: false, error: "OpenAI error", details: errText || `status ${resp.status}` },
        { status: 502 }
      );
    }

    const ai = await resp.json().catch(() => null);
    const content: string | undefined = ai?.choices?.[0]?.message?.content;
    if (!content) {
      return NextResponse.json({ ok: false, error: "No JSON content from model" }, { status: 500 });
    }

    try {
      const parsed = JSON.parse(content);
      return NextResponse.json({ ok: true, result: parsed }, { status: 200 });
    } catch {
      return NextResponse.json({ ok: true, raw: content }, { status: 200 });
    }
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "Server error" }, { status: 500 });
  }
}

// test GET
export async function GET() {
  return NextResponse.json({ ok: true, endpoint: "identify" });
}
