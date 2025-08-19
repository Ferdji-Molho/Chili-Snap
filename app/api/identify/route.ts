import { NextResponse } from "next/server";
export const runtime = "nodejs";

function isAllowed(type: string) {
  return ["image/jpeg", "image/png", "image/webp"].includes(type);
}

export async function POST(req: Request) {
  try {
    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json({ ok: false, error: "Missing OPENAI_API_KEY" }, { status: 500 });
    }

    const form = await req.formData();
    const file = form.get("file") as File | null;
    if (!file) return NextResponse.json({ ok: false, error: "No file provided" }, { status: 400 });
    if (!isAllowed(file.type)) return NextResponse.json({ ok: false, error: "Unsupported file type" }, { status: 400 });
    if (file.size > 3 * 1024 * 1024) return NextResponse.json({ ok: false, error: "Max 3 MB" }, { status: 400 }); // Vercel

    const buffer = Buffer.from(await file.arrayBuffer());
    const dataUrl = `data:${file.type};base64,${buffer.toString("base64")}`;

    const body = {
      model: process.env.OPENAI_MODEL || "gpt-4o-mini",
      messages: [
        {
       role: "system",
content: `
You are an expert chili pepper taxonomist. 
Your task: identify the MOST LIKELY specific chili pepper variety (cultivar or common trade name), not just a generic description.
Examples: "Ají Charapita", "Habanero Chocolate", "Jalapeño", "Serrano", "Piquillo".
Rules:
- Always provide a primary variety name. If uncertain, pick the closest match and explain uncertainty.
- Do NOT answer with only "small yellow chili" or "generic pepper".
- If absolutely impossible, return "Unknown variety" but explain why.
Output STRICT JSON only:
{
  "primary": {
    "name": "Ají Charapita",
    "species": "Capsicum frutescens",
    "alt_names": ["Charapita"],
    "confidence": 0.78,
    "scoville_range": [30000, 50000],
    "distinguishing_features": ["very small marble-sized pods", "yellow color", "clusters on thin stems"],
    "notes": "Commonly found in Peruvian cuisine"
  },
  "alternates": [
    { "name": "Yellow Cherry Pepper", "reason": "similar round yellow fruits but usually larger", "scoville_range": [0, 5000] }
  ],
  "uncertainty": "Scale reference missing; assumed <1 cm pods so leaning toward Charapita"
},
        {
          role: "user",
          content: [
            { type: "text", text: "Identify this chili pepper from the image using only visible traits." },
            { type: "image_url", image_url: { url: dataUrl } }
          ]
        }
      ],
      temperature: 0.2,
      response_format: { type: "json_object" }
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

    let parsed: any = null;
    try {
      parsed = JSON.parse(content);
    } catch {
      return NextResponse.json({ ok: true, raw: content }, { status: 200 });
    }

    return NextResponse.json({ ok: true, result: parsed }, { status: 200 });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "Server error" }, { status: 500 });
  }
}
