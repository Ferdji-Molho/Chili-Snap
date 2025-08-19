"use client";
import { useState } from "react";

export default function Page() {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    if (!["image/jpeg", "image/png", "image/webp"].includes(f.type)) {
      setError("Only JPG/PNG/WebP allowed");
      return;
    }
    if (f.size > 5 * 1024 * 1024) {
      setError("Max 5 MB");
      return;
    }
    setError(null);
    setFile(f);
    const url = URL.createObjectURL(f);
    setPreview(url);
  }

  async function identify() {
    if (!file) return;
    setLoading(true);
    setError(null);
    setResult(null);
    
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/identify", { method: "POST", body: fd });
      
      if (!res.ok) {
        const errorData = await res.json();
        setError(`API error: ${errorData.error || 'Unknown error'}`);
        return;
      }
      
      const data = await res.json();
      setResult(data);
    } catch (err) {
      setError(`Network error: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setLoading(false);
    }
  }

  function reset() {
    setFile(null);
    setPreview(null);
    setResult(null);
    setError(null);
    // Reset the file input
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    if (fileInput) fileInput.value = '';
  }

  return (
    <main className="min-h-screen flex items-center justify-center p-6 bg-gradient-to-br from-red-50 to-orange-50">
      <div className="w-full max-w-2xl bg-white rounded-2xl shadow-lg p-8 space-y-6">
        <div className="text-center">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">
            🌶️ ChiliSnap
          </h1>
          <p className="text-gray-600">
            Take or upload a chili pepper photo. We'll identify the variety using AI.
          </p>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Choose or capture pepper image
            </label>
            <input
              type="file"
              accept="image/*"
              capture="environment"
              onChange={onPick}
              className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-red-50 file:text-red-700 hover:file:bg-red-100 border border-gray-300 rounded-lg cursor-pointer"
            />
          </div>

          {preview && (
            <div className="relative">
              <img 
                src={preview} 
                alt="Pepper preview" 
                className="rounded-xl w-full h-64 object-cover shadow-md"
              />
              <button
                onClick={reset}
                className="absolute top-2 right-2 bg-black bg-opacity-50 text-white rounded-full p-1 hover:bg-opacity-70 transition-all"
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
            {loading ? (
              <span className="flex items-center justify-center">
                <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                Analyzing pepper...
              </span>
            ) : (
              "🔍 Identify Pepper"
            )}
          </button>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg">
            <strong>Error:</strong> {error}
          </div>
        )}

        {result && (
          <div className="space-y-4">
            {result.primary && (
              <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                <h3 className="font-semibold text-green-800 mb-2">🎯 Primary Identification</h3>
                <div className="space-y-1 text-sm">
                  <p><strong>Name:</strong> {result.primary.name}</p>
                  <p><strong>Species:</strong> {result.primary.species}</p>
                  <p><strong>Heat Level:</strong> {result.primary.heat_level}</p>
                  <p><strong>Confidence:</strong> {result.primary.confidence}</p>
                </div>
              </div>
            )}

            {result.alternates && result.alternates.length > 0 && (
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                <h3 className="font-semibold text-blue-800 mb-2">🤔 Alternative Possibilities</h3>
                {result.alternates.map((alt: any, idx: number) => (
                  <div key={idx} className="text-sm mb-2 last:mb-0">
                    <p><strong>{alt.name}</strong> ({alt.species}) - Confidence: {alt.confidence}</p>
                  </div>
                ))}
              </div>
            )}

            {result.uncertainty && (
              <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
                <h3 className="font-semibold text-yellow-800 mb-2">⚠️ Uncertainty Notes</h3>
                <p className="text-sm text-yellow-700">{result.uncertainty}</p>
              </div>
            )}

            <details className="bg-gray-50 border border-gray-200 rounded-lg p-4">
              <summary className="cursor-pointer font-semibold text-gray-700 mb-2">
                📋 Raw AI Response
              </summary>
              <pre className="text-xs bg-white p-3 rounded-lg overflow-auto border text-gray-600">
                {JSON.stringify(result, null, 2)}
              </pre>
            </details>
          </div>
        )}

        <footer className="text-xs text-gray-500 text-center pt-4 border-t">
          Powered by AI vision models • Keep API keys secure on server side
        </footer>
      </div>
    </main>
  );
}