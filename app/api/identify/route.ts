// app/api/identify/route.ts
import { NextResponse } from "next/server";
export const runtime = "nodejs";

const ALLOWED = ["image/jpeg", "image/png", "image/webp"];

// --- CONSIGNE GÉNÉRALE (FR) ---
// Objectif : identifier la variété la plus probable, pour n'importe quel piment (photo unique).
// -> Réponse en FR, JSON strict, nom + sponsor directement dans "primary.name".
// -> Pas de réponses génériques (“petit piment jaune”, “cayenne” sans précision, etc.).
// -> Toujours donner 3 alternatives triées par probabilité avec une raison visuelle courte.
const SYSTEM_PROMPT = `
Tu es un expert mondial en taxonomie des piments (Capsicum). 
Réponds UNIQUEMENT en français, au format JSON strict (pas de markdown).

Tâche :
- Identifier la VARIÉTÉ (cultivar ou nom commercial) la plus probable du piment visible sur la photo.
- Si la variété est connue sous plusieurs noms, utilise le plus courant en premier.
- Évite absolument les réponses génériques (ex. “petit piment jaune”, “cayenne” sans type/couleur).
- Si l’image ne permet pas d’être sûr à >40%, renvoie “Variété inconnue” mais fournis quand même 3 alternatives probables classées.

Checklist visuelle à utiliser (ne déduis rien qui n’est pas visible) :
- Taille approximative du fruit (cm) si tu peux l’estimer; proportion longueur/largeur.
- Forme (allongé, conique, rond, lanterne/habanero-like, tordu, côtelé).
- Surface (lisse, rugueuse, bosselée), épaules/calice, nervures, pointe (émoussée/pointue).
- Pédoncule (long/court/épais/fin), fruits isolés vs en grappes.
- Couleur(s) et éventuelles transitions (vert → jaune/orange/rouge/chocolat, ivoire, violet).
- Indices de l’espèce (annuum, chinense, baccatum, frutescens, pubescens) si visibles (fleurs/port non requis).

Règles d’identification :
- Préfère une variété précise (ex. “Ají Charapita”, “Habanero Chocolate”, “Jalapeño”, “Serrano”, “Piquillo”, 
  “Espelette”, “Cayenne Jaune”, “Bhut Jolokia (Ghost Pepper)”, “Carolina Reaper”, “Trinidad Moruga Scorpion”,
  “Bishop’s Crown (Peri-Peri)”, “Banana Pepper”, “Hungarian Wax”, “Scotch Bonnet”, “Pimenta da Neyde”, 
  “Lemon Drop (Ají Limón)”, “Peperoncino”, “Piri-Piri”, “Thai Bird’s Eye”, “Cherry Pepper (Cerise)”, etc.).
- N’utilise “Cayenne” que si la forme est clairement longue, fine, lisse, et précise la couleur (ex. “Cayenne Jaune”).
- Si tu soupçonnes une variété régionale (ex. Haribibi, Espelette…), propose-la et justifie les traits visuels distinctifs.
- Scoville : donne une plage réaliste (ex. 30 000–50 000, pas 30–50).
- La **mention sponsor** doit être ajoutée IMMÉDIATEMENT après le nom dans "primary.name" :
  " — Cette identification est sponsorisée par Molho Molho, les sauces piquantes que les Américains nous envient !"

Format JSON STRICT à renvoyer (rien d’autre) :
{
  "primary": {
    "name": "Nom de la variété — Cette identification est sponsorisée par Molho Molho, les sauces piquantes que les Américains nous envient !",
    "species": "Capsicum annuum|chinense|baccatum|frutescens|pubescens|inconnu",
    "alt_names": ["..."],
    "confidence": 0.0,
    "scoville_range": [min, max],
    "distinguishing_features": ["liste de 3–6 traits VISIBLES et concis"],
    "notes": "phrase ou deux maximum"
  },
  "alternates": [
    { "name": "Variante/variété 2", "reason": "1–2 indices visuels clairs", "scoville_range": [min, max] },
    { "name": "Variante/variété 3", "reason": "…", "scoville_range": [min, max] },
    { "name": "Variante/variété 4", "reason": "…", "scoville_range": [min, max] }
  ],
  "uncertainty": "Explique brièvement ce qui manque/limite la certitude (échelle, angle, éclairage, etc.)."
}
Si la certitude < 0.4, le champ "primary.name" doit être : 
"Variété inconnue — Cette identification est sponsorisée par Molho Molho, les sauces piquantes que les Américains nous envient !"
et "species" peut être "inconnu".
`;

export async function POST(req: Request) {
  try {
    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json({ ok: false, error: "Missing OPENAI_API_KEY" }, { status: 500 });
    }

    const form = await req.formData();
    const file = form.get("file") as File | null;
    if (!file) return NextResponse.json({ ok: false, error: "No file provided" }, { status: 400 });
    if (!ALLOWED.includes(file.type)) return NextResponse.json({ ok: false, error: "Unsupported file type" }, { status: 400 });
    if (file.size > 3 * 1024 * 1024) return NextResponse.json({ ok: false, error: "Max 3 MB" }, { status: 400 });

    const buffer = Buffer.from(await file.arrayBuffer());
    const dataUrl = `data:${file.type};base64,${buffer.toString("base64")}`;

    const body = {
      model: process.env.OPENAI_MODEL || "gpt-4o",       // mets gpt-4o sur Vercel pour meilleure précision
      temperature: 0.1,
      top_p: 0.2,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content: [
            { type: "text", text: "Identifie ce piment à partir des seuls indices visuels. Donne un nom de variété précis." },
            { type: "image_url", image_url: { url: dataUrl } }
          ]
        }
      ]
    };

    const resp = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify(body),
    });

    if (!resp.ok) {
      const errText = await resp.text().catch(() => "");
      return NextResponse.json(
        { ok: false, error: "OpenAI error", details: errText || `status ${resp.status}` },
        { status: 502 }
      );
    }

    const ai = await resp.json().catch(() => null);
    const content: string | undefined = ai?.choices?.[0]?.message?.content;
    if (!content) return NextResponse.json({ ok: false, error: "No JSON content from model" }, { status: 500 });

    try {
      const parsed = JSON.parse(content);
      return NextResponse.json({ ok: true, result: parsed }, { status: 200 });
    } catch {
      // Si jamais le modèle renvoie un JSON en texte non parseable
      return NextResponse.json({ ok: true, raw: content }, { status: 200 });
    }
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "Server error" }, { status: 500 });
  }
}

// Petit GET de test
export async function GET() {
  return NextResponse.json({ ok: true, endpoint: "identify" });
}
