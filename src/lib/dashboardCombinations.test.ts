import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { analyzeCombination, buildCombinationsContext, combinationKey, combinationMinimumMinutes, compareCombinations, combinationPlayers, rankCombinations, validateCombination } from "./dashboardCombinations";
import { DashboardMatchRecord } from "./dashboardAnalytics";
import { buildDashboardV2, emptyDashboardScope } from "./dashboardV2";
import { createLineupInitializedEvent, createLiveThreatEvent, createSubstitutionEvent, createGameStateEvent } from "./matchEngine";
import { buildMatchMomentum, deriveSharedPlayerIntervals } from "./matchMomentum";
import { MatchEvent, Player } from "../types";
const players: Player[] = Array.from({ length: 7 }, (_, i) => ({ id: `p${i + 1}`, name: `P${i + 1}`, number: i + 1, position: i === 0 ? "PORTERO" : "ALA", goalkeeperCapable: i === 0 }));
const scope = () => emptyDashboardScope("club", "team", "season");
function record(id = "m", venue: "HOME" | "AWAY" = "HOME"): DashboardMatchRecord {
  const lineup = (period: number) => createLineupInitializedEvent({ id: `${id}-lineup-${period}`, matchId: id, position: { period, minute: 0, order: 1 }, squadPlayerIds: players.map(p => p.id), onCourtPlayerIds: players.slice(0, 5).map(p => p.id), goalkeeperPlayerId: "p1", now: 1 });
  const shot = (key: string, period: number, minute: number, side: "FOR" | "AGAINST", goal: boolean) => createLiveThreatEvent({ id: key, matchId: id, position: { period, minute, order: 1 }, side, playerId: side === "FOR" ? "p3" : undefined, origin: { x: .6, y: .5 }, outcome: goal ? "GOL" : "FUERA", phase: "POSITIONAL", now: 100 + minute });
  const events: MatchEvent[] = [lineup(1), shot(id+"gf1",1,5,"FOR",true),shot(id+"shot",1,7,"FOR",false),createSubstitutionEvent({id:id+"sub",matchId:id,position:{period:1,minute:10,order:1},playerOutId:"p2",playerInId:"p6",now:110}),shot(id+"gc",1,12,"AGAINST",true),lineup(2),shot(id+"gf2",2,5,"FOR",true)];
  return { catalog: { matchId:id,clubId:"club",teamId:"team",seasonId:"season",opponent:id,venue,date:id==="m"?"2026-01-01":"2026-02-01",status:"FINISHED",updatedAt:1 }, session:{matchId:id,players,staff:[],period:2,minute:20,periodMinutes:{1:20,2:20},closedPeriods:[1,2],matchFinished:true,events,past:[],future:[],lastError:null,persistenceStatus:"saved",lastSavedAt:1} };
}
for(const ids of [["p1","p2"],["p1","p2","p3"],["p1","p2","p3","p4"],["p1","p2","p3","p4","p5"]]) test(`${ids.length} jugadores simultáneos con GK; quinteto exacto`,()=>{const c=buildCombinationsContext([record()],scope()),r=analyzeCombination(c,ids);assert.equal(r.minutes,30);assert.equal(r.percent,75);assert.equal(r.matches,1);assert.equal(r.minutesPerMatch,30);assert.equal(r.rates.gf,2*40/30);assert.equal(r.rates.gc,0);assert.equal(r.rates.shots,4);assert.equal(r.rates.threats,0);assert.equal(r.rates.goals,2*40/30);assert.equal(r.rates.danger,4);assert.equal(r.rest.goals,-4);assert.equal(r.rest.danger,-4);assert.equal(r.differential.goals,2*40/30+4);assert.equal(r.differential.danger,8);});
test("sin coincidencia, sin jugadores duplicados, sin tamaño uno ni IDs desconocidos",()=>{const c=buildCombinationsContext([record()],scope());const r=analyzeCombination(c,["p2","p6"]);assert.equal(r.minutes,0);assert.equal(r.rates.gf,null);assert.equal(r.points.possible,0);for(const ids of [["p1"],["p1","p1"],["p1","unknown"]])assert.throws(()=>validateCombination(ids,c.players));});
test("ranking solo de combinaciones observadas y claves sin orden",()=>{const c=buildCombinationsContext([record()],scope());assert.equal(rankCombinations(c,5).length,2);assert.equal(rankCombinations(c,2).some(r=>r.ids.includes("p7")),false);assert.equal(combinationKey(["p2","p1"]),combinationKey(["p1","p2"]));});
test("varios partidos: exposición real no player-minutes y min/PJ",()=>{const c=buildCombinationsContext([record(),record("b","AWAY")],scope()),r=analyzeCombination(c,["p1","p2"]);assert.equal(c.minutes,80);assert.equal(r.minutes,60);assert.equal(r.matches,2);assert.equal(r.percent,75);assert.equal(r.minutesPerMatch,30);assert.deepEqual(r.byMatch.map(m=>m.matchId),["m","b"]);assert.equal(r.lowSample,false);});
test("periodos distintos usan duración registrada",()=>{const r=record();r.session.periodMinutes={1:15,2:12};r.session.minute=12;const c=buildCombinationsContext([r],scope()),a=analyzeCombination(c,["p1","p2"]);assert.equal(c.minutes,27);assert.equal(a.minutes,22);assert.equal(a.percent,22/27*100);});
test("filtro P2 recorta ambos minutos y eventos",()=>{const c=buildCombinationsContext([record()],{...scope(),period:2}),r=analyzeCombination(c,["p1","p2"]);assert.equal(c.minutes,20);assert.equal(r.minutes,20);assert.equal(r.rates.gf,2);assert.equal(r.rest.goals,null);assert.equal(r.differential.goals,null);});
test("filtros de partido, sede y rival comparten contexto con RESTO",()=>{const records=[record(),record("b","AWAY")];for(const patch of [{matchIds:["b"]},{venues:["AWAY"] as Array<"AWAY">},{rivals:["b"]}]){const c=buildCombinationsContext(records,{...scope(),...patch});assert.equal(c.minutes,40);assert.equal(c.matches[0].record.catalog.matchId,"b");}});
test("estado marcador recorta exposición con marcador previo al evento",()=>{const c=buildCombinationsContext([record()],{...scope(),scoreState:"LEADING"}),r=analyzeCombination(c,["p1","p2"]);assert.equal(c.minutes,22);assert.equal(r.minutes,20);assert.equal(r.rates.gf,0);});
test("evento/fase no altera denominador ni puntos combinación",()=>{const base=buildCombinationsContext([record()],scope()),filtered=buildCombinationsContext([record()],{...scope(),phases:["TRANSITION"]});const a=analyzeCombination(base,["p1","p2"]),b=analyzeCombination(filtered,["p1","p2"]);assert.equal(filtered.minutes,base.minutes);assert.equal(b.minutes,a.minutes);assert.equal(b.rates.goals,0);assert.deepEqual(b.points,a.points);assert.equal(b.points.total,3);});
test("todos los filtros de amenaza reutilizan el selector y mantienen exposición",()=>{const patches=[{outcomes:["FUERA"] as ["FUERA"]},{originZones:["Z1"] as ["Z1"]},{originDistance:"NEAR" as const},{outcomeGroup:"ON_TARGET" as const},{threatSides:["AGAINST"] as ["AGAINST"]},{setPieceTraceability:"LINKED_RESTART_ONLY" as const},{targetZones:["TOP_LEFT"] as never[]},{playerIds:["p2"]}];for(const patch of patches){const c=buildCombinationsContext([record()],{...scope(),...patch});assert.equal(c.minutes,40);assert.equal(analyzeCombination(c,["p1","p2"]).points.total,3);}});
test("guardarraíl centralizado y límite estricto; 2 PJ solo si contexto multipartido",()=>{assert.equal(combinationMinimumMinutes(40),8);assert.equal(combinationMinimumMinutes(300),15);assert.equal(combinationMinimumMinutes(1000),20);const r=record();r.session.periodMinutes={1:8,2:0};r.session.events=r.session.events.filter(e=>e.period===1&&e.minute<=8);const c=buildCombinationsContext([r],scope());assert.equal(analyzeCombination(c,["p1","p2"]).lowSample,true);const a=record(),b=record("b");b.session.events=b.session.events.filter(e=>e.type!=="lineup_initialized");assert.equal(analyzeCombination(buildCombinationsContext([a,b],scope()),["p1","p2"]).lowSample,true);});
test("puntos positivos, empate, negativos; sin referencia a clasificación",()=>{const a=record(),b=record("b"),c=record("c");b.session.events=b.session.events.filter(e=>e.type!=="threat_recorded");c.session.events=c.session.events.map(e=>e.type==="threat_recorded"&&e.side==="FOR"?{...e,side:"AGAINST" as const,playerId:undefined}:e);const r=analyzeCombination(buildCombinationsContext([a,b,c],scope()),["p1","p2"]);assert.deepEqual(r.points,{total:4,possible:9,perMatch:4/3,positive:1,draws:1,negative:1});});
test("quintetos completos reales y porcentaje del tiempo conjunto",()=>{const c=buildCombinationsContext([record()],scope()),r=analyzeCombination(c,["p1","p3"]);assert.equal(r.quintets.length,2);assert.deepEqual(r.quintets.map(q=>q.minutes),[30,10]);assert.deepEqual(r.quintets.map(q=>q.percent),[75,25]);assert.equal(analyzeCombination(c,players.slice(0,5).map(p=>p.id)).quintets.length,0);});
test("comparador permite solapamiento pero nunca tamaños diferentes",()=>{const c=buildCombinationsContext([record()],scope());assert.equal(compareCombinations(c,["p1","p2"],["p1","p6"]).b.minutes,10);assert.throws(()=>compareCombinations(c,["p1","p2"],["p1","p2","p3"]));});
test("tombstones y pendientes no reincorporados; replay de sustitución pendiente",()=>{const r=record();r.session.events=r.session.events.map(e=>e.id==="mgf1"?{...e,deletedAt:500}:e.id==="mgf2"?{...e,pendingReview:true,reviewState:"PENDING_REVIEW" as const}:e.id==="msub"?{...e,pendingReview:true,reviewState:"PENDING_REVIEW" as const}:e);const c=buildCombinationsContext([r],scope()),a=analyzeCombination(c,["p1","p2"]);assert.equal(a.minutes,40);assert.equal(a.rates.gf,0);});
test("límites exactos de sustitución siguen el orden canónico y no el autor",()=>{const r=record();const goal=r.session.events.find(e=>e.id==="mgf1")!;r.session.events.push({...goal,id:"before",minute:10,order:0},{...goal,id:"after",minute:10,order:2});const c=buildCombinationsContext([r],scope());assert.equal(analyzeCombination(c,["p1","p2"]).byMatch[0].counts.gf,3);assert.equal(analyzeCombination(c,["p1","p6"]).byMatch[0].counts.gf,1);});
test("alineación inválida excluida hasta nueva inicialización fiable",()=>{const r=record();r.session.events=r.session.events.map(e=>e.id==="msub"&&e.type==="substitution"?{...e,playerOutId:"p7"}:e);const c=buildCombinationsContext([r],scope());assert.equal(c.minutes,30);assert.equal(c.excludedMinutes,10);});
test("sin alineación no hay exposición inferida por autores",()=>{const r=record();r.session.events=r.session.events.filter(e=>e.type!=="lineup_initialized");const c=buildCombinationsContext([r],scope());assert.equal(c.minutes,0);assert.equal(rankCombinations(c,2).length,0);assert.equal(analyzeCombination(c,["p1","p2"]).rates.goals,null);});
test("regresión: minutos de Momentum y Dashboard intactos tras analizar",()=>{const r=record(),before=JSON.stringify(r),dashboard=buildDashboardV2([r],scope()),momentum=buildMatchMomentum(r);const c=buildCombinationsContext([r],scope());assert.equal(deriveSharedPlayerIntervals(r.session,["p1","p2"]).reduce((s,i)=>s+i.end-i.start,0),analyzeCombination(c,["p1","p2"]).minutes);assert.deepEqual(buildMatchMomentum(r),momentum);assert.deepEqual(buildDashboardV2([r],scope()),dashboard);assert.equal(JSON.stringify(r),before);});
test("UI integrada, sin rutas nuevas, ranking plegado y acciones accesibles",()=>{const ui=readFileSync('src/components/dashboard/DashboardCombinations.tsx','utf8');for(const label of ['EXPLORAR COMBINACIÓN','SIN MUESTRA CONJUNTA','VOLVER AL RANKING','PUNTOS COMBINACIÓN','DIFERENCIAL','aria-sort','canViewIndividualAnalytics'])assert.ok(ui.includes(label));assert.ok(!ui.includes('firebase'));assert.ok(readFileSync('src/components/dashboard/DashboardV2Page.tsx','utf8').includes('["COMBINATIONS", "COMBINACIONES"]'));});

test("P-J filtra exposición y eventos; fuera del periodo no hay fuga en el borde",()=>{const r=record();r.session.events.push(createGameStateEvent({id:"pj-on",matchId:"m",position:{period:2,minute:5,order:0},state:"FLYING_GOALKEEPER",active:true,side:"FOR",now:100}),createGameStateEvent({id:"pj-off",matchId:"m",position:{period:2,minute:10,order:1},state:"FLYING_GOALKEEPER",active:false,side:"FOR",now:110}));const c=buildCombinationsContext([r],{...scope(),playingState:"PJ_CDA"});assert.equal(c.minutes,5);assert.equal(analyzeCombination(c,["p1","p2"]).minutes,5);const p1=buildCombinationsContext([r],{...scope(),period:1});assert.equal(p1.minutes,20);});
test("minutos clave/de oro y filtro de portero recortan el mismo contexto",()=>{const r=record();assert.equal(buildCombinationsContext([r],{...scope(),competitiveContext:"KEY"}).minutes,40);assert.equal(buildCombinationsContext([r],{...scope(),competitiveContext:"GOLD"}).minutes,5);assert.equal(buildCombinationsContext([r],{...scope(),goalkeeperIds:["p1"]}).minutes,40);assert.equal(buildCombinationsContext([r],{...scope(),goalkeeperIds:["p2"]}).minutes,0);});
test("quinteto duplicado o con desconocido queda fuera del denominador",()=>{for(const id of ["p1","unknown"]){const r=record();r.session.events=r.session.events.map(e=>e.type==="lineup_initialized"?{...e,onCourtPlayerIds:["p1","p2","p3","p4",id]}:e);assert.equal(buildCombinationsContext([r],scope()).minutes,0);}});
test("regla multi-PJ y denominador cero explícitos",()=>{const a=record(),b=record("b");b.session.events=b.session.events.map(e=>e.type==="lineup_initialized"?{...e,onCourtPlayerIds:["p1","p3","p4","p5","p6"]}:e).filter(e=>e.type!=="substitution");assert.equal(analyzeCombination(buildCombinationsContext([a,b],scope()),["p1","p2"]).lowSample,true);const c=buildCombinationsContext([a],{...scope(),goalkeeperIds:["p7"]});const row=analyzeCombination(c,["p1","p2"]);assert.equal(row.percent,null);assert.equal(row.rest.goals,null);assert.equal(row.differential.goals,null);});


test("SIN PORTEROS usa solo posición de plantilla, no capacidad ni rol funcional", () => {
  const r = record();
  r.session.players = r.session.players.map(p => ({ ...p, goalkeeperCapable: p.id === "p2", position: p.id === "p1" || p.id === "p7" ? "PORTERO" : "ALA" }));
  r.session.events = r.session.events.map(e => e.type === "lineup_initialized" ? { ...e, goalkeeperPlayerId: "p2" } : e);
  const c = buildCombinationsContext([r], scope());
  for (const size of [2, 3, 4] as const) {
    assert.deepEqual(combinationPlayers(c, size, true).map(p => p.id), ["p2", "p3", "p4", "p5", "p6"]);
    const ranking = rankCombinations(c, size, true);
    assert.ok(ranking.length > 0);
    assert.ok(ranking.every(row => !row.ids.includes("p1") && !row.ids.includes("p7")));
    assert.ok(ranking.some(row => row.ids.includes("p2")));
  }
});
test("cuarteto sin porteros acumula los mismos minutos y métricas tras cambio de portero", () => {
  const r = record();
  r.session.players = r.session.players.map(p => p.id === "p6" ? { ...p, position: "PORTERO", goalkeeperCapable: true } : p);
  r.session.events = r.session.events.map(e => e.type === "substitution" ? { ...e, playerOutId: "p1", playerInId: "p6" } : e);
  const c = buildCombinationsContext([r], scope());
  const ids = ["p2", "p3", "p4", "p5"];
  const row = analyzeCombination(c, ids, true);
  assert.equal(row.minutes, 40);
  assert.equal(row.percent, 100);
  assert.deepEqual(row.quintets.map(q => q.minutes), [30, 10]);
  assert.deepEqual(row, analyzeCombination(c, ids));
  assert.deepEqual(rankCombinations(c, 4, true), [row]);
  const filtered = buildCombinationsContext([r], { ...scope(), period: 2, phases: ["TRANSITION"] });
  assert.equal(analyzeCombination(filtered, ids, true).minutes, 20);
  assert.deepEqual(analyzeCombination(filtered, ids, true), analyzeCombination(filtered, ids));
});
test("toggle off y quintetos exactos preservan íntegramente el comportamiento anterior", () => {
  const c = buildCombinationsContext([record()], scope());
  for (const size of [2, 3, 4, 5] as const) assert.deepEqual(rankCombinations(c, size, false), rankCombinations(c, size));
  assert.deepEqual(rankCombinations(c, 5, true), rankCombinations(c, 5));
  assert.deepEqual(combinationPlayers(c, 5, true), c.players);
});
test("exploración, detalle y comparador rechazan PORTERO con toggle activo", () => {
  const c = buildCombinationsContext([record()], scope());
  assert.throws(() => analyzeCombination(c, ["p1", "p2"], true));
  assert.throws(() => compareCombinations(c, ["p2", "p3"], ["p1", "p3"], true));
  assert.throws(() => compareCombinations(c, ["p1", "p3"], ["p2", "p3"], true));
  assert.deepEqual(compareCombinations(c, ["p2", "p3"], ["p3", "p6"], true), compareCombinations(c, ["p2", "p3"], ["p3", "p6"]));
  assert.equal(analyzeCombination(c, ["p2", "p6"], true).minutes, 0);
});

test("posición maestra de plantilla prevalece sobre slot inicial y snapshot histórico", () => {
  const r = record();
  r.session.players = r.session.players.map(p => p.id === "p1" ? { ...p, naturalPosition: "GOALKEEPER" } : p.id === "p2" ? { ...p, naturalPosition: "WINGER" } : p);
  const c = buildCombinationsContext([r], scope(), [{ playerId: "p1", primaryPosition: "WINGER" }, { playerId: "p2", primaryPosition: "GOALKEEPER" }]);
  const eligible = combinationPlayers(c, 2, true).map(p => p.id);
  assert.ok(eligible.includes("p1"));
  assert.ok(!eligible.includes("p2"));
  const historical = buildCombinationsContext([r], scope());
  assert.ok(!combinationPlayers(historical, 2, true).some(p => p.id === "p1"));
  assert.deepEqual(rankCombinations(c, 2), rankCombinations(historical, 2));
});
