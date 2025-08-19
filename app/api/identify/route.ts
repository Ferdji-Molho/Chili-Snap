import OpenAI from "openai";

export const runtime = "nodejs"; // évite certains pièges Edge avec fichiers/Buffer

// Facultatif: limite "logique" côté serveur
const MAX_BYTES = 3 * 1024 * 1024;
const ALLOWED = new Set(["image/jpeg", "image/png", "image/webp"]);

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

export async function POST(req: Request) {
  try {
    const form = await req.formData();
    const file = form.get("file");

    if (!(file instanceof File)) {
      return json({ ok: false, error: "Aucun fichier reçu (champ 'file' manquant)" }, 400);
    }
    if (!ALLOWED.has(file.type)) {
      return json({ ok: false, error: `Type non autorisé: ${file.type}` }, 400);
    }
    if (file.size > MAX_BYTES) {
      return json({ ok: false, error: `Fichier trop lourd: ${file.size}o (max 3MB)` }, 400);
    }

    // Lis le binaire
    const arrBuf = await file.arrayBuffer();
    const base64 = Buffer.from(arrBuf).toString("base64");
    const dataUrl = `data:${file.type};base64,${base64}`;

    // --- Appel OpenAI (vision) ------------------------------------------------
    // Si tu veux juste tester le flux sans OpenAI, commente ce bloc et garde le "fallback de test" plus bas.
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });
    const model = process.env.OPENAI_MODEL || "gpt-5-mini";

    // Prompt minimal: on demande un JSON structuré strict
    const sys =
      "Tu es un classificateur de piments. Réponds UNIQUEMENT en JSON valide avec la structure: " +
      "{ primary:{ name:string, species?:string, alt_names?:string[], confidence:number, scoville_range:[number,number], distinguishing_features?:string[], notes?:string }, alternates?:[{ name:string, reason:string, scoville_range:[number,number] }], uncertainty?:string }";

    const user =
      "Identifie ce piment à partir de l'image. " +
      "Donne une estimation de l'échelle Scoville et des traits distinctifs visibles. " +
      "Si incertitude, liste 2-3 alternatives pertinentes.";

    // NB: API chat avec image
    const completion = await client.chat.completions.create({
      model,
      temperature: 0.2,
      messages: [
        { role: "system", content: sys },
        {
          role: "user",
          content: [
            { type: "text", text: user },
            { type: "image_url", image_url: { url: dataUrl } },
          ],
        } as any,
      ],
    });

    const rawText = completion.choices?.[0]?.message?.content?.trim() || "";
    if (!rawText) {
      // On renvoie quand même du JSON explicite, jamais vide
      return json({ ok: false, error: "Modèle sans contenu (texte vide)" }, 502);
    }

    // Essaye de parser le JSON renvoyé par le modèle
    let parsed: any = null;
    try {
      parsed = JSON.parse(rawText);
    } catch (e) {
      // Si le modèle a renvoyé du texte non-json, on encapsule
      return json({
        ok: false,
        error: "Réponse non-JSON du modèle",
        details: rawText.slice(0, 5000),
      }, 502);
    }

    // Sanity check minimal
    if (!parsed?.primary?.name) {
      return json({
        ok: false,
        error: "Réponse AI incomplète (pas de primary.name)",
        raw: parsed,
      }, 502);
    }

    return json({ ok: true, result: parsed, raw: { model, usage: completion.usage } }, 200);

    // --- Fallback de test (si tu veux bypasser OpenAI) -----------------------
    // return json({
    //   ok: true,
    //   result: {
    //     primary: {
    //       name: "Jalapeño",
    //       species: "Capsicum annuum",
    //       alt_names: ["Cuaresmeño"],
    //       confidence: 0.82,
    //       scoville_range: [2500, 8000],
    //       distinguishing_features: ["Forme conique", "Peau lisse verte", "Taille 5–9 cm"],
    //       notes: "Couleur verte (non mûr) ; devient rouge à maturité.",
    //     },
    //     alternates: [
    //       { name: "Serrano", reason: "Taille proche, vert lisse", scoville_range: [10000, 23000] },
    //       { name: "Fresno", reason: "Forme similaire, plus fruité", scoville_range: [2500, 10000] },
    //     ],
    //     uncertainty: "Angle et lumière limitent la vue du pédoncule.",
    //   },
    // }, 200);

  } catch (err: any) {
    console.error("[/api/identify] error:", err);
    return json({ ok: false, error: err?.message || "Erreur serveur" }, 500);
  }
}

// Optionnel: bloque les GET pour éviter 200 vides
export async function GET() {
  return json({ ok: false, error: "Use POST with form-data {file}" }, 405);
}
