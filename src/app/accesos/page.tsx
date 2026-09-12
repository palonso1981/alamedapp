"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { AppHeader } from "../../components/app/AppHeader";
import { useAccess } from "../../components/access/AccessProvider";
import { createClubAccess, deleteClubAccess, listClubAccesses, updateClubAccess, AccessUsageSummary } from "../../lib/access/accessFirestore";
import { AccessRole, AccessScope, ClubAccessProfile, generateAccessCode, newAccessCodeValidationError, roleLabel, scopeLabel } from "../../lib/access/accessDomain";
import { useTeamStore } from "../../store/useTeamStore";

type Row = { profile: ClubAccessProfile; usage: AccessUsageSummary };

export default function AccessManagementPage() {
  const { grant } = useAccess();
  const workspace = useTeamStore((state) => state.teams[grant.profile.clubId]);
  const ensureTeam = useTeamStore((state) => state.ensureTeam);
  const [rows, setRows] = useState<Row[]>([]);
  const [editing, setEditing] = useState<ClubAccessProfile | "NEW" | null>(null);
  const [revealedCode, setRevealedCode] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const teams = useMemo(() => (workspace?.teams ?? []).filter((team) => !team.deletedAt && !team.archivedAt), [workspace?.teams]);
  const load = useCallback(async () => { try { setRows((await listClubAccesses(grant.profile.clubId)).filter(({ profile }) => profile.status !== "DELETED")); setMessage(""); } catch { setMessage("No se pudieron cargar los accesos. Comprueba la conexión y las reglas DEV."); } }, [grant.profile.clubId]);
  useEffect(() => { ensureTeam(grant.profile.clubId); void load(); }, [ensureTeam, grant.profile.clubId, load]);
  async function toggle(profile: ClubAccessProfile) {
    setBusy(true);
    try {
      await updateClubAccess(profile, { label: profile.label, role: profile.role, scope: profile.scope, status: "DISABLED" }, Date.now(), grant.profile.accessId);
      await load();
    }
    catch (error) { setMessage(error instanceof Error ? error.message : "No se pudo cambiar el estado."); }
    finally { setBusy(false); }
  }
  async function remove(profile: ClubAccessProfile) {
    if (!window.confirm(`Eliminar funcionalmente “${profile.label}”. Su código dejará de validar. ¿Continuar?`)) return;
    setBusy(true);
    try { await deleteClubAccess(profile, grant.profile.accessId); await load(); }
    catch (error) { setMessage(error instanceof Error ? error.message : "No se pudo eliminar el acceso."); }
    finally { setBusy(false); }
  }
  return <div className="min-h-screen bg-slate-950 text-white"><AppHeader title="Accesos" clubId={grant.profile.clubId}/><main className="mx-auto max-w-6xl space-y-4 p-4 sm:p-6">
    <section className="flex flex-wrap items-end justify-between gap-4 rounded-3xl border border-slate-800 bg-slate-900 p-5"><div><p className="text-[10px] font-black tracking-widest text-cyan-300">CREDENCIALES COMPARTIBLES · NO PERSONAS</p><h2 className="mt-1 text-2xl font-black">ACCESOS DEL CLUB</h2><p className="mt-2 max-w-2xl text-xs text-slate-400">El código se elige al crear y solo se muestra una vez. Si se pierde, desactiva o elimina el acceso y crea otro.</p></div><button type="button" onClick={() => { setEditing("NEW"); setRevealedCode(null); }} className="min-h-12 rounded-xl bg-cyan-300 px-5 text-xs font-black text-slate-950">CREAR ACCESO</button></section>
    {message && <p role="alert" className="rounded-xl bg-amber-950 p-3 text-sm text-amber-200">{message}</p>}
    <section className="overflow-hidden rounded-3xl border border-slate-800 bg-slate-900"><div className="hidden grid-cols-[1fr_7rem_10rem_7rem_9rem] gap-3 border-b border-slate-800 px-4 py-3 text-[9px] font-black text-slate-500 md:grid"><span>NOMBRE</span><span>ROL</span><span>ALCANCE</span><span>ESTADO</span><span>ACTIVIDAD APROX.</span></div>{rows.map(({ profile, usage }) => <article key={profile.accessId} className="grid gap-3 border-b border-slate-800 p-4 last:border-0 md:grid-cols-[1fr_7rem_10rem_7rem_9rem] md:items-center"><div><strong>{profile.label}</strong><p className="mt-1 font-mono text-[9px] text-slate-600">{profile.accessId}</p></div><span className="text-xs font-black text-cyan-300">{roleLabel(profile.role)}</span><span className="text-xs text-slate-300">{scopeLabel(profile.role === "EDITOR" ? { type: "CLUB" } : profile.scope)}</span><span className={`text-xs font-black ${profile.status === "ACTIVE" ? "text-emerald-300" : "text-amber-300"}`}>{profile.status === "ACTIVE" ? "ACTIVO" : "DESACTIVADO"}</span><div className="text-[10px] text-slate-400"><p>{usage.lastUsedAt ? new Date(usage.lastUsedAt).toLocaleString("es-ES") : "Sin uso"}</p><p>{usage.approximateDevices30d} dispositivos · {usage.activeDays30d} días / 30</p></div><div className="flex flex-wrap gap-2 md:col-span-5"><button type="button" onClick={() => { setEditing(profile); setRevealedCode(null); }} className="min-h-10 rounded-lg bg-slate-800 px-3 text-[10px] font-black">EDITAR</button>{profile.status === "ACTIVE" && <button type="button" disabled={busy || profile.accessId === grant.profile.accessId} onClick={() => void toggle(profile)} className="min-h-10 rounded-lg bg-slate-800 px-3 text-[10px] font-black disabled:opacity-30">DESACTIVAR</button>}<button type="button" disabled={busy || profile.accessId === grant.profile.accessId} onClick={() => void remove(profile)} className="min-h-10 rounded-lg bg-rose-950 px-3 text-[10px] font-black text-rose-200 disabled:opacity-30">ELIMINAR</button></div></article>)}{rows.length === 0 && <p className="p-10 text-center text-sm text-slate-500">Todavía no hay accesos visibles.</p>}</section>
    {editing && <AccessForm initial={editing === "NEW" ? null : editing} clubId={grant.profile.clubId} actorAccessId={grant.profile.accessId} teams={teams} onCancel={() => setEditing(null)} onSaved={async (result) => { if (result) setRevealedCode(result); setEditing(null); await load(); }} />}
    {revealedCode && <CodeReveal code={revealedCode} onClose={() => setRevealedCode(null)} />}
  </main></div>;
}

function AccessForm({ initial, clubId, actorAccessId, teams, onCancel, onSaved }: { initial: ClubAccessProfile | null; clubId: string; actorAccessId: string; teams: Array<{ teamId: string; name: string }>; onCancel(): void; onSaved(code?: string): Promise<void> }) {
  const [label, setLabel] = useState(initial?.label ?? "");
  const [role, setRole] = useState<AccessRole>(initial?.role ?? "EDITOR");
  const [scopeType, setScopeType] = useState<"CLUB" | "TEAMS">(initial?.scope.type ?? "CLUB");
  const [teamIds, setTeamIds] = useState<string[]>(initial?.scope.type === "TEAMS" ? initial.scope.teamIds : []);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [code, setCode] = useState(() => initial ? "" : generateAccessCode());
  const scope: AccessScope = role !== "VIEWER" || scopeType === "CLUB" ? { type: "CLUB" } : { type: "TEAMS", teamIds };
  const codeError = initial ? null : newAccessCodeValidationError(code, label);
  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setMessage("");
    try {
      if (initial) { await updateClubAccess(initial, { label, role, scope }, Date.now(), actorAccessId); await onSaved(); }
      else { const created = await createClubAccess({ clubId, label, role, scope, code }); await onSaved(created.code); }
    } catch (error) { setMessage(error instanceof Error ? error.message : "No se pudo guardar el acceso."); }
    finally { setBusy(false); }
  }
  return <div className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-slate-950/85 p-4"><form onSubmit={submit} className="w-full max-w-xl rounded-3xl border border-slate-700 bg-slate-900 p-5"><h3 className="text-xl font-black">{initial ? "EDITAR ACCESO" : "NUEVO ACCESO"}</h3><label className="mt-4 block text-[10px] font-black text-slate-400">NOMBRE<input value={label} onChange={(event) => setLabel(event.target.value)} placeholder="Graba partidos" className="mt-1 min-h-12 w-full rounded-xl bg-slate-950 px-3 text-sm"/></label><label className="mt-3 block text-[10px] font-black text-slate-400">ROL<select value={role} onChange={(event) => setRole(event.target.value as AccessRole)} className="mt-1 min-h-12 w-full rounded-xl bg-slate-950 px-3"><option value="ADMIN">ADMIN</option><option value="EDITOR">EDITOR</option><option value="VIEWER">VISOR</option></select></label>{role === "VIEWER" && <fieldset className="mt-3"><legend className="text-[10px] font-black text-slate-400">ALCANCE</legend><div className="mt-1 grid grid-cols-2 gap-2"><button type="button" onClick={() => setScopeType("CLUB")} className={`min-h-12 rounded-xl text-xs font-black ${scopeType === "CLUB" ? "bg-cyan-300 text-slate-950" : "bg-slate-800"}`}>TODO EL CLUB</button><button type="button" onClick={() => setScopeType("TEAMS")} className={`min-h-12 rounded-xl text-xs font-black ${scopeType === "TEAMS" ? "bg-cyan-300 text-slate-950" : "bg-slate-800"}`}>EQUIPOS</button></div>{scopeType === "TEAMS" && <div className="mt-2 grid max-h-48 gap-2 overflow-y-auto rounded-xl bg-slate-950 p-2 sm:grid-cols-2">{teams.map((team) => <label key={team.teamId} className="flex min-h-11 items-center gap-3 rounded-lg bg-slate-900 px-3 text-sm"><input type="checkbox" checked={teamIds.includes(team.teamId)} onChange={() => setTeamIds((current) => current.includes(team.teamId) ? current.filter((id) => id !== team.teamId) : [...current, team.teamId])}/>{team.name}</label>)}</div>}</fieldset>}{!initial && <label className="mt-3 block text-[10px] font-black text-slate-400">CÓDIGO DE ACCESO<div className="mt-1 flex gap-2"><input value={code} onChange={(event) => setCode(event.target.value)} autoComplete="off" className="min-h-12 min-w-0 flex-1 rounded-xl bg-slate-950 px-3 font-mono text-sm"/><button type="button" onClick={() => setCode(generateAccessCode())} className="min-h-12 rounded-xl bg-slate-800 px-3 text-[10px] font-black">GENERAR OTRO</button></div><span className={`mt-1 block text-[10px] ${codeError ? "text-amber-300" : "text-emerald-300"}`}>{codeError ?? "Código válido. Se guardará únicamente su hash."}</span></label>}{message && <p className="mt-3 text-sm text-amber-300">{message}</p>}<div className="mt-5 flex justify-end gap-2"><button type="button" onClick={onCancel} className="min-h-11 rounded-xl bg-slate-800 px-4 text-xs font-black">CANCELAR</button><button disabled={busy || Boolean(codeError)} className="min-h-11 rounded-xl bg-cyan-300 px-4 text-xs font-black text-slate-950 disabled:opacity-40">{initial ? "GUARDAR" : "CREAR ACCESO"}</button></div></form></div>;
}

function CodeReveal({ code, onClose }: { code: string; onClose(): void }) {
  const [copied, setCopied] = useState(false);
  return <div className="fixed inset-0 z-[60] grid place-items-center bg-slate-950/90 p-4"><section className="w-full max-w-lg rounded-3xl border border-emerald-700 bg-slate-900 p-6 text-center"><p className="text-[10px] font-black tracking-widest text-emerald-300">ACCESO CREADO</p><p className="mt-4 break-all rounded-2xl bg-slate-950 p-5 font-mono text-2xl font-black tracking-widest">{code}</p><p className="mt-4 text-sm text-slate-400">Guárdalo o compártelo ahora. Al cerrar no podrá volver a consultarse ni cambiarse.</p><button type="button" onClick={async () => { await navigator.clipboard.writeText(code); setCopied(true); }} className="mt-5 min-h-12 w-full rounded-xl bg-emerald-400 text-xs font-black text-slate-950">{copied ? "✓ COPIADO" : "COPIAR CÓDIGO"}</button><button type="button" onClick={onClose} className="mt-2 min-h-11 w-full rounded-xl bg-slate-800 text-xs font-black">CERRAR</button></section></div>;
}
