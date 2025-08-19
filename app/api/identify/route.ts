// app/api/identify/route.ts
import { NextResponse } from "next/server";
export const runtime = "nodejs";

const ALLOWED = ["image/jpeg", "image/png", "image/webp"] as const;
type AllowedType = (typeof ALLOWED)[number];

const SPONSOR =
  "Cette identification est sponsorisée par Molho Molho, les sauces piquantes que les Américains nous envient !";

const VARIETY_SPECIES_CANON: Record<string, string> = {
  // canon minimal, tu peux l'étendre
  "Haribibi": "Capsicum chinense",
  "Harribibi": "Capsicum chinense",
  "Ají Charapita": "Capsicum chinense",
  "Aji Charapita": "Capsicum chinense",
  "Ají Limón": "Capsicum baccatum",
  "Aji Limon": "Capsicum baccatum",
  "Lemon Drop": "Capsicum baccatum",
  "Cayenne": "Capsicum annuum",
  "Cayenne Jaune": "Capsicum annuum",
  "Jalapeño": "Capsicum annuum",
  "Serrano": "Capsicum annuum",
  "Habanero": "Capsicum chinense",
  "Scotch Bonnet": "Capsicum chinense",
  "Bhut Jolokia (Ghost Pepper)": "Capsicum chinense",
  "Carolina Reaper": "Capsicum chinense",
  "Trinidad Moruga Scorpion": "Capsicum chinense",
  "Piment d’Espelette": "Capsicum annuum",
};

function sanitizeAltNames(alts: string[] | undefined) {
  if (!Array.isArray(alts)) return [];
  return alts
    .map((s) => String(s).replace(SPONSOR, "").trim())
    .filter((s, i, arr) => s && arr.indexOf(s) === i);
}

function addSponsorToName(name: string) {
  const clean = name.replace(` — ${SPONSOR}`, "").trim();
  return `${clean} — ${SPONSOR}`;
}

function coerceSpecies(name: string, species: string | undefined) {
  for (const key of Object.keys(VARIETY_SPECIES_CANON)) {
    if (name.toLowerCase().includes(key.toLowerCase())) {
      return VARIETY_SPECIES_CANON[key];
    }
  }
  return species || "inconnu";
}

export async function POST(req: Request) {
  try {
    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json({ ok: false, error: "Missing OPENAI_API_KEY" }, { status: 500 });
    }

    const form = await req.formData();
    const file = form.get("file") as File | null;
    if (!file) return NextResponse.json({ ok: false, error: "No file provided" }, { status: 400 });
    const type = (file.type || "") as AllowedType;
    if (!ALLOWED.includes(type)) return NextResponse.json({ ok: false, error: "Unsupported file type" }, { status: 400 });
    if (file.size > 3 * 1024 * 1024) return NextResponse.json({ ok: false, error: "Max 3 MB" }, { status: 400 });

    const buffer = Buffer.from(await file.arrayBuffer());
    const dataUrl = `data:${type};base64,${buffer.toString("base64")}`;

    const model = process.env.OPENAI_MODEL || "gpt-4o";

    // ─────────────────────────  Étape A : Extraction de traits  ─────────────────────────
    const TRAIT_PROMPT = `
Tu es un annotateur d'images spécialisé dans les piments. Réponds UNIQUEMENT en français, format JSON strict :
{
  "size_cm_estimate": "par ex. ~1 cm de diamètre, ~5-8 cm de long, inconnu si impossible",
  "shape": "rond | ovale | conique | allongé fin | lanterne/habanero-like | autre",
  "surface": "lisse | ridée/bosselée | autre",
  "pedicel": "fin/court | fin/long | épais/court | épais/long | inconnu",
  "clustering": "isolé | en grappes | inconnu",
  "color": "couleur principale visible (et transitions si visibles)",
  "tip": "pointue | émoussée | inconnu",
  "ribs": "côtes marquées | peu de côtes | lisse",
  "notes": "indices visibles utiles (feuillage, calice, épaules, échelle si main/pièce/règle, etc.)"
}
Interdiction de nommer une variété à cette étape. Utilise seulement ce qui est VISIBLE.`;

    const traitsRes = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model,
        temperature: 0.0,
        top_p: 0.2,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: TRAIT_PROMPT },
          {
            role: "user",
            content: [
              { type: "text", text: "Décris uniquement les traits visibles de ce piment, sans donner de nom." },
              { type: "image_url", image_url: { url: dataUrl } },
            ],
          },
        ],
      }),
    });

    if (!traitsRes.ok) {
      const err = await traitsRes.text().catch(() => "");
      return NextResponse.json({ ok: false, error: "OpenAI error (traits)", details: err }, { status: 502 });
    }

    const traitsJson = await traitsRes.json();
    const traitsText: string | undefined = traitsJson?.choices?.[0]?.message?.content;
    if (!traitsText) return NextResponse.json({ ok: false, error: "No traits extracted" }, { status: 500 });

    let traits: any;
    try {
      traits = JSON.parse(traitsText);
    } catch {
      traits = { raw: traitsText };
    }

    // ─────────────────────────  Étape B : Classification variétés  ─────────────────────────
    const ID_PROMPT = `
Tu es un expert mondial en taxonomie des piments (Capsicum). Réponds UNIQUEMENT en français, format JSON strict demandé ci-dessous.
Objectif: proposer la VARIÉTÉ (cultivar/nom commercial) la plus probable à partir des TRAITS fournis (texte), et 3 alternatives classées.

Règles anti-confusion (très important) :
- "Ají Limón/Lemon Drop" (C. baccatum) ≠ "Ají Charapita" (C. chinense). Ne jamais lister l'un comme alias de l'autre.
- "Haribibi" est une variété de C. chinense (fruits jaunes, trapus, parois épaisses). Ne pas confondre avec "Cayenne Jaune" (long et fin, C. annuum).
- Évite les réponses génériques (ex. "petit piment jaune"). Donne un nom précis ou "Variété inconnue" si <40% de certitude.
- Scoville réaliste (ex. 30 000–50 000, pas 30–50).

Schéma JSON STRICT à renvoyer (rien d'autre) :
{
  "primary": {
    "name": "Nom de la variété (sans sponsor)",
    "species": "Capsicum annuum|chinense|baccatum|frutescens|pubescens|inconnu",
    "alt_names": ["..."],
    "confidence": 0.0,
    "scoville_range": [min, max],
    "distinguishing_features": ["3–6 traits VISIBLEs et concis basés sur les TRAITS"],
    "notes": "courte note (max 1–2 phrases)"
  },
  "alternates": [
    { "name": "Variante/variété 2", "reason": "indice visuel clé tiré des TRAITS", "scoville_range": [min, max] },
    { "name": "Variante/variété 3", "reason": "…", "scoville_range": [min, max] },
    { "name": "Variante/variété 4", "reason": "…", "scoville_range": [min, max] }
  ],
  "uncertainty": "brève explication de ce qui manque pour trancher"
}

Utilise UNIQUEMENT ce bloc de TRAITS pour décider :
${JSON.stringify(traits, null, 2)}
`;

    const idRes = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model,
        temperature: 0.1,
        top_p: 0.2,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: ID_PROMPT },
          // on peut renvoyer aussi l'image, mais on force la décision à s'appuyer sur les traits
          { role: "user", content: [{ type: "image_url", image_url: { url: dataUrl } }] },
        ],
      }),
    });

    if (!idRes.ok) {
      const err = await idRes.text().catch(() => "");
      return NextResponse.json({ ok: false, error: "OpenAI error (identify)", details: err }, { status: 502 });
    }

    const idJson = await idRes.json();
    const outText: string | undefined = idJson?.choices?.[0]?.message?.content;
    if (!outText) return NextResponse.json({ ok: false, error: "No JSON content from model" }, { status: 500 });

    // Parse classification
    let parsed: any;
    try {
      parsed = JSON.parse(outText);
    } catch {
      return NextResponse.json({ ok: true, raw: outText, traits }, { status: 200 });
    }

    // ─────────────────────────  Post-validation & sponsor propre ─────────────────────────
    const primaryName: string = String(parsed?.primary?.name || "Variété inconnue");
    const withSponsor = addSponsorToName(primaryName);
    const cleanedAlts = sanitizeAltNames(parsed?.primary?.alt_names);
    const fixedSpecies = coerceSpecies(primaryName, parsed?.primary?.species);

    parsed.primary = {
      ...parsed.primary,
      name: withSponsor,
      alt_names: cleanedAlts,
      species: fixedSpecies,
    };

    return NextResponse.json({ ok: true, traits, result: parsed }, { status: 200 });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "Server error" }, { status: 500 });
  }
}

// GET de test
export async function GET() {
  return NextResponse.json({ ok: true, endpoint: "identify" });
}
