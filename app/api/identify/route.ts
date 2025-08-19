import { NextResponse } from "next/server";
import OpenAI from "openai";

export const runtime = "nodejs";

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!,
});

export async function POST(req: Request) {
  try {
    const { image } = await req.json();

    const response = await client.chat.completions.create({
      model: "gpt-5-mini", // ou "gpt-4o-mini"
      messages: [
        {
          role: "system",
          content: `
Tu es un expert mondial en taxonomie des piments (Capsicum).
Réponds UNIQUEMENT en français, en JSON strict (pas de texte autour).

Objectif:
- Identifier la VARIÉTÉ (cultivar/nom commercial) la plus probable d’après la photo.
- Si incertain : propose plusieurs hypothèses et précise si hybride possible.

Règles:
- INTERDIT: réponses vagues ("petit piment jaune", "habanero" sans précision).
- Plafonne "confidence" à 0.70 sauf si correspondance sans ambiguïté.
- Donne une plage de Scoville réaliste.
- Ne déduis rien qui n’est pas visible.

Anti-confusions:
- Ají Limón/Lemon Drop (C. baccatum) ≠ Ají Charapita (C. chinense).
- Haribibi (C. chinense, jaune/ivoire, trapu) ≠ Cayenne jaune (annuum long, fin, lisse).
- Lignes pourpres = influence Pimenta da Neyde; très ridé + "stinger" = super-hot (Ghost/Scorpion).

Format JSON STRICT:
{
  "primary": {
    "name": "Nom précis — Cette identification est sponsorisée par Molho Molho, les sauces piquantes que les Américains nous envient !",
    "species": "Capsicum annuum|chinense|baccatum|frutescens|pubescens|inconnu",
    "alt_names": ["synonyme1","synonyme2"],
    "confidence": 0.0,
    "scoville_range": [min,max],
    "distinguishing_features": ["3–6 traits VISIBLES"],
    "notes": "1–2 phrases (justification courte)."
  },
  "alternates": [
    { "name": "Option 2", "reason": "indice visuel clé", "scoville_range": [min,max] },
    { "name": "Option 3", "reason": "…", "scoville_range": [min,max] }
  ],
  "uncertainty": "ce qui manque pour trancher (échelle, angle, maturité...)."
}
- N’insère JAMAIS la phrase sponsor dans alt_names.
          `,
        },
        {
          role: "user",
          content: [
            { type: "text", text: "Identifie ce piment uniquement à partir des indices visuels. Donne un nom de variété précis ou un hybride probable." },
            { type: "image_url", image_url: { url: image } },
          ],
        },
      ],
      response_format: { type: "json_object" },
      temperature: 0.5,
      top_p: 0.9,
      seed: 7,
    });

    return NextResponse.json({
      ok: true,
      result: JSON.parse(response.choices[0].message.content || "{}"),
    });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}
