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
      model: process.env.OPENAI_MODEL || "gpt-5-mini",
      temperature: 0.4,
      top_p: 0.9,
      messages: [
        {
          role: "system",
          content: `
Tu es un expert mondial en taxonomie des piments (Capsicum).
Réponds UNIQUEMENT en JSON strict (pas de texte autour).
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

    let raw = response.choices[0].message?.content || "{}";

    // ⚡ Nettoyage AGRESSIF
    raw = raw
      .trim()
      .replace(/^[^\{]+/, "") // tout ce qui précède la première accolade
      .replace(/^[\-\s]+/, "") // tirets / espaces parasites
      .replace(/```json|```/g, ""); // si jamais il y a des balises de code

    if (!raw.startsWith("{")) {
      throw new Error("JSON mal formé reçu: " + raw.slice(0, 50));
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
