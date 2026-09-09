"use client";

import { ChangeEvent, useEffect, useMemo, useRef, useState } from "react";

import { CloudinaryPlayerPhotoStorage } from "../../lib/media/cloudinaryPlayerPhotoStorage";
import { removePlayerPhoto, replacePlayerPhoto, validatePlayerPhotoCandidate } from "../../lib/media/playerPhoto";
import { resolveMasterPlayerPhoto } from "../../lib/rosterDomain";
import { ManagedPlayerPhoto, MasterPlayer } from "../../types";
import { PlayerImage } from "./PlayerImage";

export function PlayerPhotoUploader({ clubId, player, onPersist }: {
  clubId: string;
  player: MasterPlayer;
  onPersist: (photo: ManagedPlayerPhoto | null) => boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const storage = useMemo(() => new CloudinaryPlayerPhotoStorage(), []);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "OK" | "ERROR" | "INFO"; text: string } | null>(null);

  useEffect(() => {
    if (!file) { setPreview(null); return; }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  function choose(event: ChangeEvent<HTMLInputElement>) {
    const selected = event.target.files?.[0] ?? null;
    event.target.value = "";
    if (!selected) return;
    try {
      validatePlayerPhotoCandidate(selected);
      setFile(selected);
      setMessage({ tone: "INFO", text: "Vista previa lista. La subida requiere conexión." });
    } catch (error) {
      setFile(null);
      setMessage({ tone: "ERROR", text: error instanceof Error ? error.message : "La imagen no es válida." });
    }
  }

  async function upload() {
    if (!file || busy) return;
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      setMessage({ tone: "ERROR", text: "Necesitas conexión para subir la foto. La foto actual no se ha modificado." });
      return;
    }
    setBusy(true);
    setMessage({ tone: "INFO", text: "Subiendo foto…" });
    try {
      const result = await replacePlayerPhoto({
        clubId,
        player,
        file,
        storage,
        persist: (photo) => {
          if (!onPersist(photo)) throw new Error("La foto se subió, pero no pudo guardarse en el jugador.");
        },
      });
      setFile(null);
      setMessage({ tone: "OK", text: result.cleanupPending ? "Foto actualizada. La limpieza de la versión anterior queda pendiente." : "Foto actualizada." });
    } catch (error) {
      setMessage({ tone: "ERROR", text: error instanceof Error ? error.message : "No se pudo subir la foto." });
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!player.managedPhoto || busy) return;
    setBusy(true);
    setMessage({ tone: "INFO", text: "Quitando foto…" });
    try {
      const result = await removePlayerPhoto({
        player,
        storage,
        persist: (photo) => {
          if (!onPersist(photo)) throw new Error("No se pudo actualizar el jugador.");
        },
      });
      setFile(null);
      setMessage({ tone: "OK", text: result.cleanupPending ? "Foto quitada. El archivo antiguo queda pendiente de limpieza." : player.photoUrl ? "Foto quitada. Se vuelve a usar la URL anterior." : "Foto quitada." });
    } catch (error) {
      setMessage({ tone: "ERROR", text: error instanceof Error ? error.message : "No se pudo quitar la foto." });
    } finally {
      setBusy(false);
    }
  }

  const current = resolveMasterPlayerPhoto(player);
  const fallback = <span className="grid h-full w-full place-items-center bg-slate-800 text-2xl font-black text-slate-500">#{player.number}</span>;
  return <section className="rounded-2xl border border-slate-700 bg-slate-950/60 p-3" aria-label="Fotografía del jugador">
    <div className="flex items-center gap-3">
      <span className="relative h-20 w-16 shrink-0 overflow-hidden rounded-xl border border-slate-600">
        <PlayerImage src={preview ?? current} alt={`Foto de ${player.displayName}`} className="h-full w-full object-cover object-top" fallback={fallback} />
      </span>
      <div className="min-w-0 flex-1">
        <strong className="block text-xs text-slate-200">FOTO DEL JUGADOR</strong>
        <p className="mt-1 text-[11px] text-slate-500">JPEG, PNG o WebP · máximo 12 MB · salida WebP optimizada.</p>
        <div className="mt-2 flex flex-wrap gap-2">
          <input ref={inputRef} className="sr-only" type="file" accept="image/jpeg,image/png,image/webp" onChange={choose} disabled={busy} />
          <button type="button" disabled={busy} onClick={() => inputRef.current?.click()} className="min-h-11 rounded-xl border border-cyan-700 bg-cyan-950 px-4 text-xs font-black text-cyan-100 disabled:opacity-50">{player.managedPhoto || player.photoUrl ? "CAMBIAR FOTO" : "SUBIR FOTO"}</button>
          {file && <button type="button" disabled={busy} onClick={upload} className="min-h-11 rounded-xl bg-cyan-400 px-4 text-xs font-black text-slate-950 disabled:opacity-50">{busy ? "SUBIENDO…" : "CONFIRMAR"}</button>}
          {file && !busy && <button type="button" onClick={() => { setFile(null); setMessage(null); }} className="min-h-11 rounded-xl px-3 text-xs font-bold text-slate-400">CANCELAR</button>}
          {player.managedPhoto && !file && <button type="button" disabled={busy} onClick={remove} className="min-h-11 rounded-xl border border-slate-700 px-3 text-xs font-bold text-slate-300 disabled:opacity-50">QUITAR FOTO</button>}
        </div>
      </div>
    </div>
    {message && <p role={message.tone === "ERROR" ? "alert" : "status"} className={`mt-2 text-xs ${message.tone === "ERROR" ? "text-red-300" : message.tone === "OK" ? "text-emerald-300" : "text-slate-400"}`}>{message.text}</p>}
  </section>;
}
