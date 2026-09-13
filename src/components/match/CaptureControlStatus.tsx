"use client";

import Link from "next/link";
import { useState } from "react";
import { CaptureControlView } from "../../hooks/useCaptureLease";

export function CaptureControlStatus({ control, matchId }: { control: CaptureControlView; matchId: string }) {
  const [confirmTakeover, setConfirmTakeover] = useState(false);
  const [busy, setBusy] = useState(false);
  if (control.status === "LOCAL_ONLY") return null;
  if (["OWNED", "OFFLINE_PREVIOUS", "OFFLINE_UNVERIFIED", "RELEASED"].includes(control.status)) {
    const label = control.status === "OWNED" ? "● CONTROL ADQUIRIDO"
      : control.status === "OFFLINE_PREVIOUS" ? "● OFFLINE · CONTROL PREVIO"
        : control.status === "OFFLINE_UNVERIFIED" ? "⚠ OFFLINE · SESIÓN NO VERIFICADA"
          : "○ CONTROL LIBERADO";
    return <div className={`fixed left-1/2 top-2 z-[115] -translate-x-1/2 rounded-full border px-3 py-1.5 text-[10px] font-black shadow-xl ${control.status === "OWNED" ? "border-emerald-400 bg-emerald-950 text-emerald-200" : control.status === "RELEASED" ? "border-slate-600 bg-slate-900 text-slate-400" : "border-amber-400 bg-amber-950 text-amber-100"}`}>{label}</div>;
  }

  const occupied = control.status === "OCCUPIED";
  const offlineConfirm = control.status === "OFFLINE_CONFIRM";
  const title = control.status === "CHECKING" ? "COMPROBANDO CONTROL…"
    : occupied ? "ESTE PARTIDO ESTÁ SIENDO REGISTRADO EN OTRO DISPOSITIVO"
      : offlineConfirm ? "NO SE PUEDE VERIFICAR EL CONTROL"
        : control.status === "LOST" ? "CONTROL DEL PARTIDO PERDIDO"
          : control.status === "ACCESS_REVOKED" ? "ACCESO REVOCADO"
            : "NO SE PUDO ADQUIRIR EL CONTROL";
  const detail = occupied
    ? "La consulta sigue siendo segura, pero no se registrarán acciones mientras el otro control continúe activo."
    : offlineConfirm
      ? "Puedes iniciar captura offline bajo riesgo. Si otro dispositivo registra el mismo partido, ambas fuentes se conservarán para revisión."
      : control.status === "LOST"
        ? "Otra sesión controla ahora el partido. Tu outbox y todos los cambios locales permanecen intactos y no se sobrescribirán."
        : control.status === "ACCESS_REVOKED"
          ? "Hay datos locales preservados, pero no se enviarán con este acceso. Un ADMIN deberá recuperar este dispositivo."
          : control.message ?? "Espera o vuelve a comprobar el estado.";

  return <div className="fixed inset-0 z-[125] grid grid-rows-[auto_1fr] overflow-y-auto bg-slate-950/95 p-3 sm:p-4">
    <nav aria-label="Navegación disponible con Directo bloqueado" className="mx-auto flex w-full max-w-5xl flex-wrap justify-center gap-2 rounded-2xl border border-slate-700 bg-slate-900/95 p-2 shadow-xl">
      <Link href="/partidos" className="grid min-h-11 flex-1 basis-28 place-items-center rounded-xl bg-cyan-300 px-3 text-[10px] font-black text-slate-950">← PARTIDOS</Link>
      <Link href="/dashboard" className="grid min-h-11 flex-1 basis-28 place-items-center rounded-xl bg-slate-800 px-3 text-[10px] font-black text-cyan-100">DASHBOARD</Link>
      <Link href="/plantilla" className="grid min-h-11 flex-1 basis-28 place-items-center rounded-xl bg-slate-800 px-3 text-[10px] font-black text-cyan-100">PLANTILLA</Link>
      <Link href={`/partido/${matchId}/revision`} className="grid min-h-11 flex-1 basis-28 place-items-center rounded-xl bg-slate-800 px-3 text-[10px] font-black text-cyan-100">REVISIÓN</Link>
      <Link href={`/partidos/${matchId}/video`} className="grid min-h-11 flex-1 basis-28 place-items-center rounded-xl bg-slate-800 px-3 text-[10px] font-black text-cyan-100">VÍDEO</Link>
    </nav>
    <div className="grid place-items-center py-4"><section className="w-full max-w-lg rounded-3xl border border-amber-500/60 bg-slate-900 p-5 text-center shadow-2xl"><p className="text-4xl" aria-hidden="true">{control.status === "CHECKING" ? "↻" : "⚠"}</p><h2 className="mt-3 text-xl font-black text-white">{title}</h2><p className="mt-3 text-sm leading-relaxed text-slate-300">{detail}</p>{occupied && <p className="mt-3 text-[10px] text-slate-500">Control técnico: {control.occupiedBy?.captureSessionId.slice(0, 8)}… · acceso {control.occupiedBy?.accessId}</p>}<div className="mt-5 grid gap-2 sm:grid-cols-2">{offlineConfirm && <button type="button" onClick={control.beginOfflineRisk} className="min-h-14 rounded-2xl bg-amber-400 px-4 text-xs font-black text-slate-950 sm:col-span-2">INICIAR CAPTURA OFFLINE BAJO RIESGO</button>}{occupied && !confirmTakeover && <button type="button" onClick={() => setConfirmTakeover(true)} className="min-h-14 rounded-2xl bg-amber-950 px-4 text-xs font-black text-amber-100 sm:col-span-2">TOMAR CONTROL DEL PARTIDO</button>}{occupied && confirmTakeover && <><p className="rounded-xl bg-rose-950 p-3 text-left text-xs text-rose-100 sm:col-span-2">Tomar el control puede provocar conflictos si el otro dispositivo continúa capturando sin conexión.</p><button type="button" onClick={() => setConfirmTakeover(false)} className="min-h-12 rounded-xl bg-slate-800 text-xs font-black">CANCELAR</button><button type="button" disabled={busy} onClick={() => { setBusy(true); void control.takeover().finally(() => setBusy(false)); }} className="min-h-12 rounded-xl bg-rose-500 text-xs font-black text-white disabled:opacity-40">CONFIRMAR RELEVO</button></>}{["ERROR", "LOST"].includes(control.status) && <button type="button" onClick={control.retry} className="min-h-12 rounded-xl bg-cyan-300 text-xs font-black text-slate-950 sm:col-span-2">RECOMPROBAR</button>}</div></section></div>
  </div>;
}
