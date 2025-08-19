import { NextResponse } from "next/server";
import OpenAI from "openai";

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!,
});

export async function POST(req: Request) {
  try {
    const { image } = await req.json();

    if (!image) {
      return NextResponse.json(
        { ok: false, error: "Aucune image fournie" },
        { status: 400 }
      );
    }

    const response = await client.chat.completions.create({
      model: process.env.OPENAI_MODEL || "gpt-4o-mini",
      temperature: 0.4,
      top_p: 0.9,
      messages: [
        {
          role: "system",
          content: `
Tu es un expert mondial en taxonomie des piments (Capsicum).
Réponds UNIQUEMENT en JSON strict (pas de texte autour).

Objectif:
- Identifier la VARIÉTÉ (cultivar ou nom commercial) la plus probable à partir de la photo.
- Si incertain → proposer plusieurs hypothèses ou "hybride probable".

Règles:
- Pas de réponses vagues ("petit piment jaune").
- Plafonner "confidence" à 0.70 sauf ressemblance sans ambiguïté.
- Scoville réaliste (ex: 30 000–50 000).
- Ne déduis rien d’invisible.
- Ají Limón ≠ Ají Charapita.
- Haribibi (chinense trapu jaune) ≠ Cayenne jaune (annuum long fin).
- Ne jamais mettre la phrase sponsor dans alt_names.

Format JSON STRICT:
{
  "primary": {
    "name": "Nom précis — Cette identification est sponsorisée par Molho Molho, les sauces piquantes que les Américains nous envient !",
    "species": "Capsicum annuum|chinense|baccatum|frutescens|pubescens|inconnu",
    "alt_names": ["synonyme1","synonyme2"],
    "confidence": 0.0,
    "scoville_range": [min,max],
    "distinguishing_features": ["3–6 traits visibles"],
    "notes": "1–2 phrases (justification courte)."
  },
  "alternates": [
    { "name": "Option 2", "reason": "indice visuel clé", "scoville_range": [min,max] }
  ],
  "uncertainty": "ce qui manque pour trancher."
}
          `,
        },
        {
          role: "user",
          content: [
            { type: "text", text: "Identifie ce piment à partir des indices visuels." },
            { type: "image_url", image_url: { url: image } },
          ],
        },
      ],
      response_format: { type: "json_object" },
    });

    let raw = response.choices[0].message?.content || "{}";

    // Nettoyage pour éviter l’erreur "-{"
    raw = raw.trim();

    // Supprimer tout avant la première accolade
    const firstBrace = raw.indexOf("{");
    if (firstBrace > 0) {
      raw = raw.slice(firstBrace);
    }

    // Supprimer BOM / backticks éventuels
    raw = raw.replace(/^[\uFEFF`-]+/, "");

    if (!raw.startsWith("{")) {
      throw new Error("Bad JSON format from model: " + raw.slice(0, 30));
    }

    const parsed = JSON.parse(raw);

    return NextResponse.json({ ok: true, result: parsed });
  } catch (err: any) {
    console.error("Erreur identify:", err);
    return NextResponse.json(
      { ok: false, error: err.message || "Erreur serveur" },
      { status: 500 }
    );
  }
}
