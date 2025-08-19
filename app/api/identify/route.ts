import { NextResponse } from "next/server";
import OpenAI from "openai";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export async function POST(req: Request) {
  const body = await req.json();
  const { dataUrl } = body;

  const completion = await client.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      {
        role: "system",
        content: `Tu es un expert mondial en taxonomie des piments (Capsicum).
Réponds UNIQUEMENT en français, au format JSON strict (pas de texte autour).

Format attendu :
{
  "name": "Nom précis du piment",
  "species": "Capsicum annuum|chinense|baccatum|frutescens|pubescens|inconnu",
  "alt_names": ["synonyme1","synonyme2"],
  "confidence": 0.0,
  "scoville_range": [min,max],
  "distinguishing_features": ["3–6 traits visibles"],
  "notes": "1–2 phrases max d'explication"
}`
      },
      {
        role: "user",
        content: [
          { type: "text", text: "Identifie ce piment uniquement à partir des indices visuels." },
          { type: "image_url", image_url: { url: dataUrl } }
        ]
      }
    ],
    temperature: 0.7,
  });

  const raw = completion.choices[0].message.content;
  return NextResponse.json(JSON.parse(raw!));
}