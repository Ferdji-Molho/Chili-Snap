"use client";
import { useRef, useState } from "react";

type PepperAlt = {
  name: string;
  reason: string;
  scoville_range: [number, number];
};

type PepperPrimary = {
  name: string;
  species?: string;
  alt_names?: string[];
  confidence: number; // 0..1
  scoville_range: [number, number];
  distinguishing_features?: string[];
  notes?: string;
};

type PepperResult = {
  primary: PepperPrimary;
  alternates?: PepperAlt[];
  uncertainty?: string;
};

const MAX_BYTES = 3 * 1024 * 1024;

// --- Helpers ----------------------------------------------------------------

// Convert a Blob to a File
function blobToFile(blob: Blob, filename: string): File {
  return new File([blob], filename, { type: blob.type, lastModified: Date.now() });
}

// Downscale & recompress image until <= MAX_BYTES (best-effort, mobile safe)
async function compressImageIfNeeded(file: File): Promise<File> {
  if (file.size <= MAX_BYTES) return file;

  // Try createImageBitmap first (faster), fallback to HTMLImageElement
  const blobUrl = URL.createObjectURL(file);
  try {
    let bitmap: ImageBitmap | null = null;
    try {
      bitmap = await createImageBitmap(file);
    } catch {
      // fallback
    }

    let width: number;
    let height: number;

    if (bitmap) {
      width = bitmap.width;
      height = bitmap.height;
    } else {
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const i = new Image();
        i.onload = () => resolve(i);
        i.onerror = reject;
        i.src = blobUrl;
      });
      width = img.naturalWidth;
      height = img.naturalHeight;
    }

    // Progressive downscale loop
    let targetW = width;
    let targetH = height;

    // choose mime: prefer webp if supported by canvas, else jpeg
    // Safari récent supporte WebP, mais par prudence on garde jpeg en fallback.
    const tryTypes = ["image/webp", "image/jpeg"];

    for (let step = 0; step < 5; step++) {
      // shrink long side to ~2000px then 1600, 1280, 1024…
      const maxSide = [2000, 1600, 1280, 1024, 900][step] ?? 900;
      const scale = Math.min(1, maxSide / Math.max(targetW, targetH));
      const w = Math.max(1, Math.round(targetW * scale));
      const h = Math.max(1, Math.round(targetH * scale));

      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) break;

      // draw
      if (bitmap) {
        ctx.drawImage(bitmap, 0, 0, w, h);
      } else {
        const img = await new Promise<HTMLImageElement>((resolve, reject) => {
          const i = new Image();
          i.onload = () => resolve(i);
          i.onerror = reject;
          i.src = blobUrl;
        });
        ctx.drawImage(img, 0, 0, w, h);
      }

      // quality ramp: 0.9 → 0.8 → 0.7 …
      const qualities = [0.9, 0.85, 0.8, 0.75, 0.7];
      for (const mime of tryTypes) {
        for (const q of qualities) {
          const blob: Blob = await new Promise((resolve) =>
            canvas.toBlob((b) => resolve(b as Blob), mime, q)
          );
          if (!blob) continue;
          if (blob.size <= MAX_BYTES) {
            URL.revokeObjectURL(blobUrl);
            const ext = mime.includes("webp") ? "webp" : "jpg";
            return blobToFile(blob, file.name.replace(/\.[^.]+$/, `.${ext}`));
          }
        }
      }

      // prepare next loop with smaller base
      targetW = w;
      targetH = h;
    }

    // if still too big, return last attempt (jpeg low quality) – but safer to just keep original and let server reject
    URL.revokeObjectURL(blobUrl);
    return file;
  } catch {
    URL.revokeObjectURL(blobUrl);
    return file;
  }
}

// Permettre plus de types qu’avant (HEIC/HEIF et type vide)
function isAcceptableImageType(f: File) {
  if (!f.type) return true; // certains Android/iOS renvoient type=""
  if (f.type.startsWith("image/")) return true;
  return false;
}

// --- Component ---------------------------------------------------------------

export default function Page() {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<PepperResult | null>(null);
  const [raw, setRaw] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [showRaw, setShowRaw] = useState(false);

  const camInputRef = useRef<HTMLInputElement | null>(null);
  const libInputRef = useRef<HTMLInputElement | null>(null);

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const f0 = e.target.files?.[0];
    if (!f0) return;

    // Type check assoupli
    if (!isAcceptableImageType(f0)) {
      setError("Fichier non pris en charge. Choisis une image (HEIC/JPG/PNG/WebP…).");
      setFile(null);
      return;
    }

    // Compression si nécessaire
    const f = await compressImageIfNeeded(f0);

    if (f.size > MAX_BYTES) {
      setError("Image trop lourde après compression (max 3 MB). Réessaie avec une photo plus légère.");
      setFile(null);
      return;
    }

    setError(null);
    setFile(f);
    setPreview(URL.createObjectURL(f));
    setResult(null);
    setRaw(null);
    setShowRaw(false);
  }

  function reset() {
    setFile(null);
    setPreview(null);
    setResult(null);
    setRaw(null);
    setError(null);
    setShowRaw(false);
    if (camInputRef.current) camInputRef.current.value = "";
    if (libInputRef.current) libInputRef.current.value = "";
  }

  async function identify() {
    if (!file) {
      setError("Aucune image sélectionnée.");
      return;
    }

    setLoading(true);
    setError(null);
    setResult(null);
    setRaw(null);

    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/identify", { method: "POST", body: fd });

      const text = await res.text();
      if (!text) throw new Error("Réponse vide de l’API");

      let data: any;
      try {
        data = JSON.parse(text);
      } catch {
        throw new Error("Réponse non-JSON de l’API");
      }

      if (!res.ok || data?.ok === false) {
        const msg = [data?.error, data?.details].filter(Boolean).join(" — ");
        throw new Error(msg || `Erreur API (status ${res.status})`);
      }

      const payload = (data.result ?? data.raw ?? data) as Partial<PepperResult>;
      if (!payload || !payload.primary || !payload.primary.name) {
        setRaw(data);
        throw new Error("Réponse AI incomplète");
      }

      setResult(payload as PepperResult);
      setRaw(data);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Erreur réseau";
      setError(msg);
    } finally {
      setLoading(false);
    }
  }

  // --- UI helpers ------------------------------------------------------------

  function heatBadge([min, max]: [number, number]) {
    const fmt = (n: number) => (n >= 1000 ? `${Math.round(n / 1000)}k` : `${n}`);
    const label =
      max >= 1_000_000
        ? "Extrême"
        : max >= 100_000
        ? "Très fort"
        : max >= 30_000
        ? "Fort"
        : max >= 5_000
        ? "Moyen"
        : "Doux";
    return (
      <div className="inline-flex items-center gap-2 text-xs">
        <span className="rounded-full px-2 py-1 bg-gray-100">{label}</span>
        <span className="rounded-full px-2 py-1 bg-gray-100">
          {fmt(min)}–{fmt(max)} SHU
        </span>
      </div>
    );
  }

  function confidenceBar(c: number) {
    const pct = Math.max(0, Math.min(100, Math.round(c * 100)));
    return (
      <div className="w-full">
        <div className="flex justify-between text-xs text-gray-500 mb-1">
          <span>Confiance</span>
          <span>{pct}%</span>
        </div>
        <div className="h-2 w-full rounded bg-gray-200 overflow-hidden">
          <div className="h-2 bg-black" style={{ width: `${pct}%` }} />
        </div>
      </div>
    );
  }

  function ResultCard({ data }: { data: PepperResult }) {
    const p = data.primary;
    return (
      <div className="space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-xl font-semibold">{p.name}</h2>
            <p className="text-sm text-gray-600 italic">{p.species || "Capsicum sp."}</p>
            {p.alt_names?.length ? (
              <p className="text-sm text-gray-700">
                Aussi connu sous : <span className="text-gray-900">{p.alt_names.join(", ")}</span>
              </p>
            ) : null}
          </div>
          {heatBadge(p.scoville_range)}
        </div>

        {/* Sponsor placé tôt */}
        <p className="text-xs text-gray-500">
          Cette identification est sponsorisée par <span className="font-semibold">Molho Molho</span> —
          les sauces piquantes que les Américains nous envient !
        </p>

        {confidenceBar(p.confidence)}

        {p.distinguishing_features?.length ? (
          <div>
            <p className="text-sm font-medium mb-1">Caractéristiques visibles</p>
            <ul className="list-disc pl-5 text-sm text-gray-800">
              {p.distinguishing_features.map((f, i) => (
                <li key={i}>{f}</li>
              ))}
            </ul>
          </div>
        ) : null}

        {p.notes ? <p className="text-sm text-gray-700">{p.notes}</p> : null}

        {data.alternates?.length ? (
          <div className="rounded-xl border p-3">
            <p className="text-sm font-medium mb-2">Ressemblances possibles</p>
            <ul className="space-y-1">
              {data.alternates.map((a, i) => (
                <li key={i} className="text-sm text-gray-800">
                  <span className="font-medium">{a.name}</span>{" "}
                  <span className="text-gray-600">— {a.reason}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {data.uncertainty ? (
          <p className="text-xs text-gray-500">Incertitude : {data.uncertainty}</p>
        ) : null}

        <div className="pt-2">
          <button
            onClick={() => setShowRaw((s) => !s)}
            className="text-xs underline text-gray-500 hover:text-gray-800"
          >
            {showRaw ? "Masquer le JSON brut" : "Afficher le JSON brut"}
          </button>
          {showRaw && (
            <pre className="mt-2 text-xs bg-gray-100 p-3 rounded-xl overflow-auto max-h-64">
              {JSON.stringify(raw, null, 2)}
            </pre>
          )}
        </div>
      </div>
    );
  }

  // --- Render ---------------------------------------------------------------

  return (
    <main className="min-h-screen flex items-center justify-center p-6 bg-gray-50">
      <div className="w-full max-w-2xl bg-white rounded-2xl shadow p-6 space-y-5">
        <header className="flex flex-col items-center gap-2">
          <img
            src="https://cdn.shopify.com/s/files/1/0939/1403/8610/files/Molho.png?v=1748012258"
            alt="Molho Molho Logo"
            className="h-16 w-auto"
          />
          <h1 className="text-2xl font-semibold">🌶️ ChiliSnap</h1>
          <span className="text-xs text-gray-500">
            Identification de piments par IA • vos clés restent côté serveur
          </span>
        </header>

        <div className="grid gap-4">
          <label className="text-sm font-medium">
            Choisissez ou capturez une photo de votre piment
          </label>
          <p className="text-xs text-gray-600">
            JPG/PNG/WebP/HEIC, max 3&nbsp;MB. Utilisez l’un des boutons ci-dessous.
          </p>

          {/* Inputs cachés */}
          <input
            ref={camInputRef}
            type="file"
            accept="image/*"
            capture="environment" // force l’appareil photo sur mobile
            onChange={onPick}
            className="hidden"
          />
          <input
            ref={libInputRef}
            type="file"
            accept="image/*" // galerie (et parfois caméra proposée)
            onChange={onPick}
            className="hidden"
          />

          {/* Boutons */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => camInputRef.current?.click()}
              className="w-full rounded-xl px-6 py-3 border font-semibold hover:bg-gray-50 transition"
            >
              📷 Prendre une photo
            </button>
            <button
              type="button"
              onClick={() => libInputRef.current?.click()}
              className="w-full rounded-xl px-6 py-3 border font-semibold hover:bg-gray-50 transition"
            >
              🖼️ Choisir dans la galerie
            </button>
          </div>

          {preview && (
            <div className="relative">
              <img
                src={preview}
                alt="Aperçu du piment"
                className="rounded-xl w-full h-64 object-cover shadow-md"
              />
              <button
                onClick={reset}
                className="absolute top-2 right-2 bg-black bg-opacity-50 text-white rounded-full p-1 hover:bg-opacity-70 transition-all"
                aria-label="Réinitialiser"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          )}

          <button
            onClick={identify}
            disabled={!file || loading}
            className="w-full rounded-xl px-6 py-3 bg-gradient-to-r from-red-600 to-orange-600 text-white font-semibold disabled:opacity-50 disabled:cursor-not-allowed hover:from-red-700 hover:to-orange-700 transition-all shadow-md"
          >
            {loading ? "Analyse en cours…" : "🔍 Identifier le piment"}
          </button>
        </div>

        {/* Footer retiré */}
        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg mt-4">
            <strong>Erreur :</strong> {error}
          </div>
        )}

        {result && (
          <section className="rounded-2xl border p-4 mt-4">
            <ResultCard data={result} />
          </section>
        )}
      </div>
    </main>
  );
}
