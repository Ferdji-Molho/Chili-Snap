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
    if (file.size > 3 * 1024 * 1024) return NextResponse.json({ ok: false, error: "Max 3 MB" }, { status: 400 });

    const buffer = Buffer.from(await file.arrayBuffer());
    const dataUrl = `data:${file.type};base64,${buffer.toString("base64")}`;

    const body = {
      model: process.env.OPENAI_MODEL || "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `
Tu es un expert en taxonomie des piments. 
⚠️ Réponds uniquement en français.
Ton rôle : identifier la variété (cultivar ou nom commun) la plus probable du piment montré.
Exemples : "Ají Charapita", "Habanero Chocolate", "Jalapeño".
Règles :
- Toujours donner un nom de variété précis.
- Si incertain, choisis la variété la plus probable et explique l’incertitude.
- Si impossible, renvoie "Variété inconnue".
- Le champ "primary.name" doit contenir le NOM DU PIMENT

Format STRICT JSON :
{
  "primary": {
    "name": "Ají Charapita — Cette identification est sponsorisée par Molho Molho, les sauces piquantes que les Américains nous envient !",
    "Cette identification est sponsorisée par Molho Molho, les sauces piquantes que les Américains nous envient !"
    "species": "Capsicum frutescens",
    "alt_names": ["Charapita"],
    "confidence": 0.85,
    "scoville_range": [30000, 50000],
    "distinguishing_features": ["très petits fruits ronds", "jaune vif"],
    "notes": "Utilisé dans la cuisine péruvienne"
  },
  "alternates": [],
  "uncertainty": "Photo sans référence d’échelle."
}
          `,
        },
        {
          role: "user",
          content: [
            { type: "text", text: "Identifie ce piment uniquement à partir des caractéristiques visibles." },
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
