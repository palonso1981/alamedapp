"use client";

import { createContext, FormEvent, ReactNode, useContext, useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { AccessError, closeTechnicalSession, recordDailyUsage, redeemAccessCode, validateRememberedGrant } from "../../lib/access/accessFirestore";
import { ActiveAccessGrant, canAccessTeam, canManageAccess, canMutateSports, canOpenRoute, roleLabel } from "../../lib/access/accessDomain";
import { clearRememberedAccess, loadRememberedAccess, pendingLocalOperations, saveRememberedAccess } from "../../lib/access/accessPersistence";
import { setRuntimeAccessGrant } from "../../lib/access/accessRuntime";
import { hydrateAuthorizedRemoteData } from "../../lib/access/accessRemoteHydration";
import { loadMatchSession } from "../../lib/matchPersistence";
import { useTeamStore } from "../../store/useTeamStore";

interface AccessContextValue {
  grant: ActiveAccessGrant;
  canManage: boolean;
  canWrite: boolean;
  changeAccess(): Promise<void>;
  refresh(): Promise<void>;
}

const AccessContext = createContext<AccessContextValue | null>(null);

export function useAccess(): AccessContextValue {
  const value = useContext(AccessContext);
  if (!value) throw new Error("useAccess debe utilizarse dentro de AccessProvider.");
  return value;
}

function developmentFixtureGrant(): ActiveAccessGrant | null {
  if (process.env.NODE_ENV === "production" || typeof window === "undefined") return null;
  const role = new URLSearchParams(window.location.search).get("accessFixture");
  if (!role || !["ADMIN", "EDITOR", "VIEWER"].includes(role)) return null;
  return {
    uid: "fixture-uid", deviceInstallId: "fixture-device", credentialVersion: 1, lastValidatedAt: Date.now(), offline: false,
    profile: { accessId: `fixture-${role.toLowerCase()}`, clubId: "cd-alameda", label: `${role} · fixture local`, role: role as "ADMIN" | "EDITOR" | "VIEWER", scope: { type: "CLUB" }, status: "ACTIVE", credentialVersion: 1, createdAt: 1, updatedAt: 1 },
  };
}

function AccessLogin({ onAuthorized, initialMessage }: { onAuthorized(grant: ActiveAccessGrant): Promise<void>; initialMessage?: string | null }) {
  const [code, setCode] = useState("");
  const [message, setMessage] = useState(initialMessage ?? "");
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setMessage("");
    try { await onAuthorized(await redeemAccessCode(code)); }
    catch (error) { setMessage(error instanceof AccessError ? error.message : "No se pudo validar el acceso."); }
    finally { setBusy(false); }
  }
  return <div className="grid min-h-screen place-items-center bg-slate-950 p-5 text-white"><form onSubmit={submit} className="w-full max-w-md rounded-[2rem] border border-cyan-900 bg-slate-900 p-6 shadow-2xl sm:p-9"><p className="text-xs font-black tracking-[0.24em] text-cyan-300">APP ALAM</p><h1 className="mt-2 text-3xl font-black">CD ALAMEDA</h1><label className="mt-8 block text-[10px] font-black tracking-widest text-slate-400">CÓDIGO DE ACCESO<input autoFocus autoComplete="one-time-code" inputMode="text" value={code} onChange={(event) => setCode(event.target.value.toUpperCase())} placeholder="XXXX-XXXX-XXXX" className="mt-2 min-h-14 w-full rounded-2xl border border-slate-700 bg-slate-950 px-4 text-center font-mono text-xl font-black tracking-widest outline-none focus:border-cyan-400" /></label><button type="submit" disabled={busy || !code.trim()} className="mt-4 min-h-14 w-full rounded-2xl bg-cyan-300 text-sm font-black text-slate-950 disabled:opacity-40">{busy ? "VALIDANDO…" : "ENTRAR"}</button>{message && <p role="alert" className="mt-4 rounded-xl bg-amber-950 p-3 text-sm text-amber-200">{message}</p>}<p className="mt-5 text-center text-[10px] text-slate-500">El código identifica un acceso compartible, no una cuenta personal.</p></form></div>;
}

function Denied({ message }: { message: string }) {
  return <div className="grid min-h-screen place-items-center bg-slate-950 p-6 text-center text-white"><div className="max-w-md rounded-3xl border border-amber-900 bg-slate-900 p-8"><div className="text-4xl">⊘</div><h1 className="mt-4 text-2xl font-black">ACCESO NO DISPONIBLE</h1><p className="mt-3 text-sm text-slate-400">{message}</p><a href="/" className="mt-6 inline-grid min-h-12 place-items-center rounded-xl bg-cyan-300 px-5 text-xs font-black text-slate-950">VOLVER AL INICIO</a></div></div>;
}

function routeTeam(pathname: string): { clubId: string; teamId?: string } | null {
  const matchId = pathname.match(/^\/partido(?:s)?\/([^/]+)/)?.[1];
  if (!matchId || matchId === "nuevo") return null;
  const session = loadMatchSession(matchId);
  const clubId = session?.preparation?.clubId ?? "cd-alameda";
  return { clubId, teamId: session?.preparation?.teamId };
}

export function AccessProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const setCurrentClub = useTeamStore((state) => state.setCurrentClub);
  const [grant, setGrant] = useState<ActiveAccessGrant | null>(null);
  const [ready, setReady] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const fixture = developmentFixtureGrant();
    if (fixture) { setRuntimeAccessGrant(fixture); setGrant(fixture); setReady(true); return () => { active = false; }; }
    const remembered = loadRememberedAccess();
    if (!remembered) { setRuntimeAccessGrant(null); setReady(true); return () => { active = false; }; }
    void validateRememberedGrant(remembered).then(async (validated) => {
      if (!active) return;
      setRuntimeAccessGrant(validated);
      await hydrateAuthorizedRemoteData(validated);
      if (!active) return; saveRememberedAccess(validated); setGrant(validated); setReady(true); void recordDailyUsage(validated).catch(() => undefined);
    }).catch((error) => {
      if (!active) return;
      if (error instanceof AccessError && error.kind === "OFFLINE") {
        const offline = { ...remembered, offline: true }; setRuntimeAccessGrant(offline); setGrant(offline); setMessage("Sin conexión · acceso restaurado temporalmente");
      } else { clearRememberedAccess(); setRuntimeAccessGrant(null); setMessage(error instanceof Error ? error.message : "El acceso ya no es válido."); }
      setReady(true);
    });
    return () => { active = false; };
  }, []);

  useEffect(() => { if (grant) setCurrentClub(grant.profile.clubId); }, [grant, setCurrentClub]);

  async function authorized(next: ActiveAccessGrant) {
    setRuntimeAccessGrant(next);
    try {
      await hydrateAuthorizedRemoteData(next);
    } catch (error) {
      setRuntimeAccessGrant(null);
      throw error;
    }
    saveRememberedAccess(next); setGrant(next); setMessage(null); setReady(true); void recordDailyUsage(next).catch(() => undefined);
  }
  async function refresh() {
    if (!grant) return;
    const next = await validateRememberedGrant(grant); await authorized(next);
  }
  async function changeAccess() {
    if (!grant) return;
    const pending = pendingLocalOperations();
    if (pending.length > 0) throw new Error(`Hay ${pending.length} cambios pendientes de sincronizar. Conéctate y sincronízalos antes de cambiar de acceso.`);
    const { releaseOwnedCaptureLeases } = await import("../../lib/captureLeaseClient");
    await releaseOwnedCaptureLeases(grant);
    await closeTechnicalSession(grant);
    clearRememberedAccess(); setRuntimeAccessGrant(null); setGrant(null); setMessage(null);
  }

  const value: AccessContextValue | null = grant ? { grant, canManage: canManageAccess(grant), canWrite: canMutateSports(grant), changeAccess, refresh } : null;
  if (!ready) return <div className="grid min-h-screen place-items-center bg-slate-950 text-sm font-black text-slate-400">VALIDANDO ACCESO…</div>;
  if (!grant || !value) return <AccessLogin onAuthorized={authorized} initialMessage={message} />;
  if (!canOpenRoute(grant, pathname)) return <Denied message={grant.profile.role === "VIEWER" ? "Este acceso es de solo lectura." : "Esta función requiere un acceso ADMIN."} />;
  const target = routeTeam(pathname);
  if (target && !canAccessTeam(grant, target.clubId, target.teamId)) return <Denied message="No tienes acceso a este equipo." />;
  return <AccessContext.Provider value={value}><div data-access-role={grant.profile.role}>{message && <div className="bg-amber-950 px-3 py-1 text-center text-[10px] font-black text-amber-200">{message}</div>}{children}</div></AccessContext.Provider>;
}

export function AccessIdentityBadge() {
  const { grant, canManage, changeAccess } = useAccess();
  const [error, setError] = useState("");
  return <div className="flex items-center gap-1"><span className="hidden rounded-lg border border-slate-700 px-2 py-1 text-[9px] font-black text-slate-300 lg:inline">{grant.profile.label} · {roleLabel(grant.profile.role)}</span>{canManage && <a href="/accesos" aria-label="Accesos" className="grid min-h-10 min-w-10 place-items-center rounded-lg hover:bg-slate-800">⌁</a>}<button type="button" aria-label="Cambiar acceso" onClick={() => { setError(""); void changeAccess().catch((cause) => setError(cause instanceof Error ? cause.message : "No se pudo cambiar el acceso.")); }} className="grid min-h-10 min-w-10 place-items-center rounded-lg hover:bg-slate-800">⇥</button>{error && <span title={error} className="text-amber-300">!</span>}</div>;
}
