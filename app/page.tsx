"use client";
import { useState } from "react";

type PepperAlt = { name: string; reason: string; scoville_range: [number, number] };
type PepperPrimary = {
  name: string;
  species: string;
  alt_names: string[];
  confidence: number;           // 0..1
  scoville_range: [number, number];
  distinguishing_features: string[];
  notes: string;
};
type PepperResult = { primary: PepperPrimary; alternates?: PepperAlt[]; uncertainty?: string };

export default function Page() {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<PepperResult | null>(null);
  const [raw, setRaw] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [showRaw, setShowRaw] = useState(false);

  function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    if (!["image/jpeg", "image/png", "image/webp"].includes(f.type)) {
      setError("Formats autorisés : JPG/PNG/WebP");
      return;
    }
    if (f.size > 3 * 1024 * 1024) {
      setError("Image trop lourde (max 3 MB)");
      return;
    }
    setError(null);
    setFile(f);
    setPreview(URL.createObjectURL(f));
    setResult(null);
    setRaw(null);
  }

  async function identify() {
    if (!file) return;
    setLoading(true);
    setError(null);
    setResult(null);
    setRaw(null);

    try {
      const fd = new FormData();
      fd.append("file", file);

      const res = await fetch("/api/identify", { method: "POST", body: fd });
      const text = await res.text();
      if (!text) {
        setLoading(false);
        setError("Réponse vide de l’API");
        return;
      }
      let data: any = null;
      try {
        data = JSON.parse(text);
      } catch {
        setLoading(false);
        setError("Réponse non-JSON de l’API");
        return;
      }

      setLoading(false);

      if (!res.ok || data?.ok === false) {
        const msg = [data?.error, data?.details].filter(Boolean).join(" — ");
        setError(msg || `Erreur API (status ${res.status})`);
        return;
      }

      const payload = (data.result ?? data.raw ?? data) as PepperResult;
      setRaw(data);
      if ((payload as any)?.primary?.name) setResult(payload);
      else setError("Réponse AI incomplète");
    } catch (err: any) {
      setLoading(false);
      setError(err?.message || "Erreur réseau");
    }
  }

  function heatBadge([min, max]: [number, number]) {
    const fmt = (n: number) =>
      n >= 1000 ? `${Math.round(n / 1000)}k` : `${n}`;
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
        <span className="rounded-full px-2 py-1 bg-gray-100">{fmt(min)}–{fmt(max)} SHU</span>
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
          </div>
          {heatBadge(p.scoville_range)}
        </div>

        {confidenceBar(p.confidence)}

        {p.alt_names?.length > 0 && (
          <p className="text-sm text-gray-700">
            Aussi connu sous : <span className="text-gray-900">{p.alt_names.join(", ")}</span>
          </p>
        )}

        {p.distinguishing_features?.length > 0 && (
          <div>
            <p className="text-sm font-medium mb-1">Caractéristiques visibles</p>
            <ul className="list-disc pl-5 text-sm text-gray-800">
              {p.distinguishing_features.map((f, i) => (
                <li key={i}>{f}</li>
              ))}
            </ul>
          </div>
        )}

        {p.notes && <p className="text-sm text-gray-700">{p.notes}</p>}

        {(data.alternates?.length ?? 0) > 0 && (
          <div className="rounded-xl border p-3">
            <p className="text-sm font-medium mb-2">Ressemblances possibles</p>
            <ul className="space-y-1">
              {data.alternates!.map((a, i) => (
                <li key={i} className="text-sm text-gray-800">
                  <span className="font-medium">{a.name}</span>{" "}
                  <span className="text-gray-600">— {a.reason}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {data.uncertainty && (
          <p className="text-xs text-gray-500">Incertitude : {data.uncertainty}</p>
        )}

        <p className="text-xs text-gray-500 pt-2">
          Cette identification est sponsorisée par <span className="font-semibold">Molho Molho</span>,  
          les sauces piquantes que les Américains nous envient !
        </p>

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

  return (
    <main className="min-h-screen flex items-center justify-center p-6 bg-gray-50">
      <div className="w-full max-w-2xl bg-white rounded-2xl shadow p-6 space-y-5">
        <header className="flex flex-col items-center gap-2">
          <img src="https://cdn.shopify.com/s/files/1/0939/1403/8610/files/MOLHO_MOLHO_NOIR.png?v=1737379351" alt="Molho Molho Logo" className="h-16 w-auto" />
          <h1 className="text-2xl font-semibold">🌶️ ChiliSnap</h1>
         <img src="https://cdn.shopify.com/s/files/1/0939/1403/8610/files/Molho.png?v=1748012258" alt="Molho Molho Clodo" className="h-16 w-auto" />
        </header>

        <div className="grid gap-4">
          <label className="text-sm font-medium">Choisissez ou capturez une photo de votre piment</label>
          <p className="text-xs text-gray-600">Téléversez ou prenez une photo claire de votre piment pour l’identifier automatiquement.</p>
          <input
            type="file"
            accept="image/*"
            capture="environment"
            onChange={onPick}
            className="block w-full border rounded-xl p-3"
          />
          {preview && (
            <div className="rounded-xl overflow-hidden border">
              <img src={preview} alt="Aperçu du piment" className="w-full object-cover" />
            </div>
          )}
          <button
            onClick={identify}
            disabled={!file || loading}
            className="w-full rounded-xl px-4 py-3 bg-black text-white disabled:opacity-50"
          >
            {loading ? "Analyse en cours…" : "🔍 Identifier le piment"}
          </button>

          {error && <div className="text-red-600 text-sm">{error}</div>}

          {result && (
            <section className="rounded-2xl border p-4">
              <ResultCard data={result} />
            </section>
          )}
        </div>
      </div>
    </main>
  );
}
