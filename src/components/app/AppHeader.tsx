import Link from "next/link";
import { ClubContextLabel } from "./ClubContextLabel";

export function AppHeader({ title, actions, clubId }: { title: string; actions?: React.ReactNode; clubId?: string }) {
  return (
    <header className="border-b border-slate-800 bg-slate-950/95 px-4 py-3 text-white">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-4">
          <Link href="/" className="shrink-0 text-sm font-black tracking-[0.16em] text-cyan-300">CDA</Link>
          <div className="min-w-0">
            <h1 className="truncate text-lg font-black sm:text-xl">{title}</h1>
            <ClubContextLabel clubId={clubId} />
          </div>
        </div>
        <nav className="flex items-center gap-2 text-xs font-bold sm:text-sm">
          <Link href="/plantilla" aria-label="Plantilla" className="grid min-h-10 min-w-10 place-items-center rounded-lg px-2 hover:bg-slate-800 sm:block sm:min-w-0 sm:px-3 sm:py-2.5"><span className="sm:hidden" aria-hidden="true">●</span><span className="hidden sm:inline">PLANTILLA</span></Link>
          <Link href="/partidos" aria-label="Partidos" className="grid min-h-10 min-w-10 place-items-center rounded-lg px-2 hover:bg-slate-800 sm:block sm:min-w-0 sm:px-3 sm:py-2.5"><span className="sm:hidden" aria-hidden="true">▦</span><span className="hidden sm:inline">PARTIDOS</span></Link>
          <Link href="/configuracion" aria-label="Configuración" className="grid min-h-10 min-w-10 place-items-center rounded-lg px-2 text-base hover:bg-slate-800">⚙</Link>
          {actions}
        </nav>
      </div>
    </header>
  );
}
