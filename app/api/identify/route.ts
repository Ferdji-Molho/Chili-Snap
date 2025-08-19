import { NextResponse } from "next/server";
import OpenAI from "openai";

export const runtime = "nodejs";

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!,
});

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { dataUrl } = body;

    const response = await client.chat.completions.create({
      model: process.env.OPENAI_MODEL || "gpt-4o-mini",
      temperature: 0.5,
      top_p: 0.9,
      seed: 7,
      messages: [
        {
          role: "system",
          content: `
Tu es un expert mondial en taxonomie des piments (Capsicum).
Réponds UNIQUEMENT en JSON strict, sans markdown, sans listes, sans texte autour.

Objectif:
- Identifier la VARIÉTÉ (cultivar/nom commercial) la plus probable d’après la photo.
- Si ambiguïté → proposer plusieurs hypothèses.
- Confidence ≤ 0.70 sauf si absence d’ambiguïté.
- Toujours donner une plage de Scoville réaliste.
- Ne pas inventer de synonymes entre espèces (ex: Charapita ≠ Lemon Drop).

Format attendu:
{
  "primary": {
    "name": "Nom précis — Cette identification est sponsorisée par Molho Molho, les sauces piquantes que les Américains nous envient !",
    "species": "Capsicum chinense|annuum|baccatum|pubescens|frutescens|inconnu",
    "alt_names": ["synonyme1","synonyme2"],
    "confidence": 0.0,
    "scoville_range": [min,max],
    "distinguishing_features": ["3–6 traits visibles"],
    "notes": "1–2 phrases de justification."
  },
  "alternates": [
    { "name": "Option 2", "reason": "indice visuel clé", "scoville_range": [min,max] }
  ],
  "uncertainty": "ce qui manque pour trancher"
}
          `,
        },
        {
          role: "user",
          content: [
            { type: "text", text: "Identifie ce piment uniquement à partir des indices visuels." },
            { type: "image_url", image_url: { url: dataUrl } },
          ],
        },
      ],
      response_format: { type: "json_object" },
    });

       // Nettoyage de la réponse brute
    let text = response.choices[0]?.message?.content || "";

    // Enlève blocs Markdown éventuels
    text = text.replace(/^```json\n?/, "").replace(/```$/, "").trim();

    // Enlève un tiret parasite éventuel au tout début
    text = text.replace(/^[-–—]+\s*/, "").trim();

    // Maintenant tu peux parser en sécurité
    const parsed = JSON.parse(text);

    return NextResponse.json({ ok: true, result: parsed });
  } catch (err: any) {
    console.error("Error in /api/identify:", err);
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}
