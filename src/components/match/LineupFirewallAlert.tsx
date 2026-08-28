import { LineupValidation, Player } from "../../types";

export function LineupFirewallAlert({ validation, players }: { validation: LineupValidation; players: Player[] }) {
  if (validation.valid) return null;
  const causePlayer = validation.inferiorityCause
    ? players.find((player) => player.id === validation.inferiorityCause?.playerId)
    : undefined;
  return (
    <div role="alert" className="mx-auto mb-2 max-w-7xl rounded-2xl border-2 border-red-300 bg-red-950/95 px-3 py-2 text-red-50 shadow-[0_0_28px_rgba(239,68,68,0.25)]">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-3">
          <span className="text-3xl" aria-hidden="true">⚠</span>
          <div>
            <p className="text-sm font-black uppercase tracking-wide">Captura bloqueada · alineación inválida</p>
            <p className="font-mono text-lg font-black">{validation.actualPlayersOnCourt}/{validation.expectedPlayersOnCourt} en pista · {validation.goalkeeper.status === "PLAYER" ? "portero ✓" : "portero ?"}</p>
          </div>
        </div>
        <div className="max-w-xl text-xs font-semibold text-red-100">
          {validation.reasons.map((reason) => <p key={reason.code}>{reason.message}</p>)}
          {validation.inferiorityCause && <p className="text-amber-200">4v5 justificado por roja a {causePlayer?.name ?? validation.inferiorityCause.playerId}.</p>}
          <p className="mt-1 text-red-200">Puedes deshacer, editar la cronología o completar una sustitución para repararlo.</p>
        </div>
      </div>
    </div>
  );
}
