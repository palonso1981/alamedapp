import assert from "node:assert/strict";
import test from "node:test";
import { buildDashboardFixture, DASHBOARD_FIXTURE_CLUB_ID, DASHBOARD_FIXTURE_SEASON_ID, DASHBOARD_FIXTURE_TEAM_ID } from "./dashboardFixture";
import { emptyDashboardScope } from "./dashboardV2";
import { buildVideoReviewRows, buildWhatsAppVideoText } from "./videoReview";

const scope = emptyDashboardScope(DASHBOARD_FIXTURE_CLUB_ID, DASHBOARD_FIXTURE_TEAM_ID, DASHBOARD_FIXTURE_SEASON_ID);

test("revisión de vídeo filtra goles por jugador, paradas por portero y pérdidas", () => {
  const records = buildDashboardFixture();
  const goals = buildVideoReviewRows(records, scope, "GOALS", "fx-p-4");
  const saves = buildVideoReviewRows(records, scope, "SAVES", "fx-gk-1");
  const losses = buildVideoReviewRows(records, scope, "LOSSES", "fx-p-8");
  assert.ok(goals.length > 0 && goals.every((row) => row.event.type === "threat_recorded" && row.event.playerId === "fx-p-4"));
  assert.ok(saves.length > 0 && saves.every((row) => row.event.type === "threat_recorded" && row.event.defensive?.goalkeeper.status === "PLAYER" && row.event.defensive.goalkeeper.playerId === "fx-gk-1"));
  assert.ok(losses.length > 0 && losses.every((row) => row.event.type === "possession_lost" && row.event.playerId === "fx-p-8"));
});

test("revisión reutiliza filtros globales de partido y periodo", () => {
  const records = buildDashboardFixture();
  const selected = records[0];
  const rows = buildVideoReviewRows(records, { ...scope, matchIds: [selected.catalog.matchId], period: 1 }, "ALL");
  assert.ok(rows.length > 0);
  assert.ok(rows.every((row) => row.record.catalog.matchId === selected.catalog.matchId && row.event.period === 1));
});

test("revisión respeta filtros deportivos globales sin crear un segundo motor", () => {
  const records = buildDashboardFixture();
  const phases = buildVideoReviewRows(records, { ...scope, phases: ["TRANSITION"] }, "ALL");
  const key = buildVideoReviewRows(records, { ...scope, competitiveContext: "KEY" }, "ALL");
  const goalkeeper = buildVideoReviewRows(records, { ...scope, goalkeeperIds: ["fx-gk-1"] }, "SAVES");
  assert.ok(phases.length > 0);
  assert.ok(phases.every((row) => row.event.type !== "threat_recorded" || row.event.phase === "TRANSITION"));
  assert.ok(key.length > 0);
  assert.ok(goalkeeper.length > 0);
  assert.ok(goalkeeper.every((row) => row.event.type === "threat_recorded" && row.event.defensive?.goalkeeper.status === "PLAYER" && row.event.defensive.goalkeeper.playerId === "fx-gk-1"));
});

test("WhatsApp incluye deep links completos y declara jugadas sin vídeo", () => {
  const rows = buildVideoReviewRows(buildDashboardFixture(), { ...scope, matchIds: ["dashboard-fixture-1", "dashboard-fixture-4"] }, "GOALS");
  const text = buildWhatsAppVideoText("GOLES", rows, "https://alamedapp.example");
  assert.match(text, /https:\/\/alamedapp\.example\/video\/player\?videoId=fixture0001&start=\d+/);
  assert.doesNotMatch(text, /youtube(?:-nocookie)?\.com\/embed/);
  assert.match(text, /SIN VÍDEO/);
  assert.match(text, /ALAMEDAPP · GOLES/);
  assert.doesNotMatch(text, /undefined/);
});

test("córner y banda independientes se filtran por lado aunque no tengan amenaza", () => {
  const records = buildDashboardFixture();
  assert.deepEqual(buildVideoReviewRows(records, scope, "CORNERS_FOR").map((row) => row.event.id), ["dashboard-fixture-1-corner-for"]);
  assert.deepEqual(buildVideoReviewRows(records, scope, "CORNERS_AGAINST").map((row) => row.event.id), ["dashboard-fixture-1-corner-against"]);
  assert.deepEqual(buildVideoReviewRows(records, scope, "KICK_INS_FOR").map((row) => row.event.id), ["dashboard-fixture-1-kick-for"]);
  assert.deepEqual(buildVideoReviewRows(records, scope, "KICK_INS_AGAINST").map((row) => row.event.id), ["dashboard-fixture-1-kick-against"]);
});

test("copiar selección usa solo las filas elegidas y copiar filtradas conserva todas", () => {
  const rows = buildVideoReviewRows(buildDashboardFixture(), scope, "ALL").slice(0, 5);
  assert.equal(rows.length, 5);
  const selected = buildWhatsAppVideoText("SELECCIÓN", [rows[1], rows[3]]);
  assert.equal((selected.match(/ · P[12] min /g) ?? []).length, 2);
  const all = buildWhatsAppVideoText("TODAS", rows);
  assert.equal((all.match(/ · P[12] min /g) ?? []).length, 5);
});
