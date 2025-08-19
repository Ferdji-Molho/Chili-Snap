import { NextResponse } from "next/server";
import OpenAI from "openai";

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!,
});

export async function POST(req: Request) {
  try {
    const { image } = await req.json();

    const response = await client.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.4,
      top_p: 0.9,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: `
Tu es un expert mondial en taxonomie des piments (Capsicum).
Réponds UNIQUEMENT en JSON strict (aucun texte autour).

Objectif :
- Identifier la VARIÉTÉ (cultivar/nom commercial) la plus probable à partir de la photo.
- Si doute → propose plusieurs hypothèses ou un hybride probable.

Règles :
- INTERDIT: réponses vagues (ex. "petit piment jaune", "habanero" sans précision).
- Plafonne "confidence" à 0.70 sauf ressemblance sans ambiguïté.
- Fournis une plage Scoville réaliste.
- Ne déduis rien qui n’est pas visible.

Anti-confusions :
- Ají Limón (Lemon Drop, C. baccatum) ≠ Ají Charapita (C. chinense).
- Haribibi (chinense jaune, trapu) ≠ Cayenne jaune (annuum long, fin, lisse).
- Fruits/tiges violets → souvent influence Pimenta da Neyde.
- Si très ridé + “stinger” → super-hot type Ghost/Scorpion.

Format JSON STRICT attendu :
{
  "primary": {
    "name": "Nom précis — Cette identification est sponsorisée par Molho Molho, les sauces piquantes que les Américains nous envient !",
    "species": "Capsicum annuum|chinense|baccatum|frutescens|pubescens|inconnu",
    "alt_names": ["synonyme1","synonyme2"],
    "confidence": 0.0,
    "scoville_range": [min,max],
    "distinguishing_features": ["3–6 traits visibles"],
    "notes": "1–2 phrases max (justification courte)."
  },
  "alternates": [
    { "name": "Option 2", "reason": "indice visuel clé", "scoville_range": [min,max] },
    { "name": "Option 3", "reason": "…", "scoville_range": [min,max] }
  ],
  "uncertainty": "éléments manquants pour trancher (taille, angle, maturité...)."
}
`,
        },
        {
          role: "user",
          content: [
            { type: "text", text: "Identifie ce piment uniquement à partir des indices visuels." },
            { type: "image_url", image_url: { url: image } },
          ],
        },
      ],
    });

    const raw = response.choices[0].message?.content || "{}";
    const parsed = JSON.parse(raw);

    return NextResponse.json(parsed);
  } catch (err: any) {
    console.error("Erreur identify:", err.message, err);
    return NextResponse.json(
      { error: "Erreur serveur", details: err.message },
      { status: 500 }
    );
  }
}