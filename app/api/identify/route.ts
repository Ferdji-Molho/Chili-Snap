import { NextResponse } from "next/server";

export const runtime = "nodejs"; // pas d'edge (évite des streams/limitations)

function isAllowed(type: string) {
  return ["image/jpeg", "image/png", "image/webp"].includes(type);
}

export async function POST(req: Request) {
  try {
    // 1) Vérifs basiques
    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json({ ok: false, error: "Missing OPENAI_API_KEY" }, { status: 500 });
    }

    const form = await req.formData();
    const file = form.get("file") as File | null;
    if (!file) return NextResponse.json({ ok: false, error: "No file provided" }, { status: 400 });
    if (!isAllowed(file.type)) return NextResponse.json({ ok: false, error: "Unsupported file type" }, { status: 400 });
    if (file.size > 5 * 1024 * 1024) return NextResponse.json({ ok: false, error: "Max 5 MB" }, { status: 400 });

    // 2) Buffer → data URL
    const buffer = Buffer.from(await file.arrayBuffer());
    const base64 = buffer.toString("base64");
    const dataUrl = `data:${file.type};base64,${base64}`;

    // 3) Appel OpenAI (Chat Completions vision) avec réponse JSON stricte
    const body = {
      model: process.env.OPENAI_MODEL || "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content:
            'You are a botanist specialized in Capsicum image identification. Return STRICT JSON only. Schema: {"primary":{"name":"string","species":"string","alt_names":["string"],"confidence":0.0,"scoville_range":[min,max],"distinguishing_features":["string"],"notes":"string"},"alternates":[{"name":"string","reason":"string","scoville_range":[min,max]}],"uncertainty":"string"}. If confidence < 0.4, return {"primary":{"name":"Unknown","species":"","alt_names":[],"confidence":0.0,"scoville_range":[0,0],"distinguishing_features":[],"notes":""},"alternates":[],"uncertainty":"Short reason"}.'
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

    // 4) Si OpenAI renvoie une erreur → toujours JSON
    if (!resp.ok) {
      const errText = await resp.text().catch(() => "");
      return NextResponse.json(
        { ok: false, error: "OpenAI error", details: errText || `status ${resp.status}` },
        { status: 502 }
      );
    }

    // 5) On lit la réponse OpenAI (qui doit contenir du JSON en texte)
    const ai = await resp.json().catch(() => null);
    const content: string | undefined = ai?.choices?.[0]?.message?.content;

    if (!content || typeof content !== "string") {
      return NextResponse.json({ ok: false, error: "No JSON content from model" }, { status: 500 });
    }

    // 6) On parse le JSON renvoyé par le modèle
    let parsed: any = null;
    try {
      parsed = JSON.parse(content);
    } catch {
      // filet de sécurité : renvoyer le brut, mais en JSON
      return NextResponse.json({ ok: true, raw: content }, { status: 200 });
    }

    // 7) Succès
    return NextResponse.json({ ok: true, result: parsed }, { status: 200 });
  } catch (e: any) {
    // 8) Filet global : TOUJOURS JSON
    return NextResponse.json({ ok: false, error: e?.message || "Server error" }, { status: 500 });
  }
}
