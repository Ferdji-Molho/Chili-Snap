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

export default function Page() {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<PepperResult | null>(null);
  const [raw, setRaw] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [showRaw, setShowRaw] = useState(false);

  // Refs pour différencier caméra vs galerie
  const camInputRef = useRef<HTMLInputElement | null>(null);
  const libInputRef = useRef<HTMLInputElement | null>(null);

  function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;

    if (!["image/jpeg", "image/png", "image/webp"].includes(f.type)) {
      setError("Formats autorisés : JPG / PNG / WebP");
      return;
    }
    // Limite claire et unique : 3 MB
    if (f.size > 3 * 1024 * 1024) {
      setError("Image trop lourde (max 3 MB)");
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

    // Vider les deux inputs cachés
    if (camInputRef.current) camInputRef.current.value = "";
    if (libInputRef.current) libI
