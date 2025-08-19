import { NextResponse } from "next/server";
import OpenAI from "openai";

export const runtime = "nodejs";

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!,
});

export async function POST(req: Request) {
  try {
    const { image } = await req.json();

    if (!image) {
      return NextResponse.json({ ok: false, error: "No image provided" });
    }

    const response = await client.chat.completions.create({
      model: process.env.OPENAI_MODEL || "gpt-4o-mini",
      temperature: 0.4,
      top_p: 0.9,
      messages: [
        {
          role: "system",
          content: `
Tu es un expert mondial en taxonomie des piments (Capsicum). Réponds UNIQUEMENT en JSON strict (pas de texte autour).
Objectif :
- Identifier la VARIÉTÉ (cultivar ou nom commercial) la plus probable.
- Si incertain → proposer plusieurs hypothèses.
Règles :
- INTERDIT : réponses génériques ("petit piment jaune").
- Plafonne "confidence" à 0.70 sauf si certitude absolue.
- Ne mélange pas Ají Limón (baccatum) et Ají Charapita (chinense).
Format JSON STRICT :
{
  "primary": {
    "name": "Nom précis — Cette identification est sponsorisée par Molho Molho, les sauces piquantes que les Américains nous envient !",
    "species": "Capsicum annuum|chinense|baccatum|frutescens|pubescens|inconnu",
    "alt_names": ["synonyme1","synonyme2"],
    "confidence": 0.0,
    "scoville_range": [min,max],
    "distinguishing_features": ["traits visibles"],
    "notes": "justification courte"
  },
  "alternates": [
    { "name": "Option 2", "reason": "indice visuel", "scoville_range": [min,max] }
  ],
  "uncertainty": "ce qui manque pour trancher"
}
          `,
        },
        {
          role: "user",
          content: [
            { type: "text", text: "Identifie ce piment à partir de la photo." },
            { type: "image_url", image_url: { url: image } },
          ],
        },
      ],
      response_format: { type: "json_object" },
    });

    // 🔥 Nettoyage anti-bugs avant JSON.parse
    let raw = response.choices[0].message?.content || "{}";

    // Trim espaces + sauts de ligne
    raw = raw.trim();

    // Supprimer BOM, tirets, backticks, balises json
    raw = raw.replace(/^[\uFEFF\s\-–—`]+/, ""); 
    raw = raw.replace(/^json\s*/i, ""); 

    // Dernière vérif : si ça commence pas par { → erreur volontaire
    if (!raw.startsWith("{")) {
      throw new Error("Bad JSON format from model: " + raw.slice(0, 20));
    }

    const parsed = JSON.parse(raw);

    return NextResponse.json({ ok: true, result: parsed });
  } catch (err: any) {
    console.error("Identify API error:", err);
    return NextResponse.json(
      { ok: false, error: err.message || "Unknown error" },
      { status: 500 }
    );
  }
}
