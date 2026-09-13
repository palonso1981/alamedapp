import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  BackupBundle,
  LogicalDataset,
  MatchBundle,
  applyLogicalRestore,
  backupDocuments,
  createLogicalBackup,
  createSelectiveMatchBundle,
  matchBundleDocuments,
  planLogicalRestore,
  validateBackupBundle,
  validateLogicalDataset,
} from "../lib/dataPortability";
import { AppEnvironment, assertExpectedEnvironment, inspectApplicationEnvironment, normalizeAppEnvironment } from "../lib/environmentSafety";

const argv = process.argv.slice(2);
const command = argv[0];

function option(name: string): string | undefined {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : undefined;
}

function positional(index: number): string | undefined {
  return argv.slice(1).filter((value, position, values) => !value.startsWith("--") && (position === 0 || !values[position - 1].startsWith("--")))[index];
}

function required(name: string): string {
  const value = option(name);
  if (!value) throw new Error("Falta " + name + ".");
  return value;
}

function readJson<T>(file: string): T {
  return JSON.parse(readFileSync(resolve(file), "utf8")) as T;
}

function writeJson(file: string, value: unknown): void {
  writeFileSync(resolve(file), JSON.stringify(value, null, 2) + "\n", "utf8");
}

function environment(name: string): AppEnvironment {
  const value = normalizeAppEnvironment(required(name));
  if (!value) throw new Error(name + " debe ser dev o prod.");
  return value;
}

function ensureDatasetIdentity(dataset: LogicalDataset, envName: string, projectName: string): void {
  const declaredEnvironment = environment(envName);
  const declaredProject = required(projectName);
  if (dataset.environment !== declaredEnvironment || dataset.projectId !== declaredProject) {
    throw new Error("El inventario no coincide con el entorno/projectId declarados.");
  }
}

function summary(plan: ReturnType<typeof planLogicalRestore>) {
  return {
    mode: plan.dryRun ? "DRY_RUN" : "APPLY_LOCAL_FILE",
    targetEnvironment: plan.targetEnvironment,
    targetProjectId: plan.targetProjectId,
    counts: plan.counts,
    conflicts: plan.items.filter((item) => item.disposition === "CONFLICT"),
    changes: plan.items.filter((item) => item.disposition === "CREATE" || item.disposition === "UPDATE_SAFE"),
  };
}

function restoreInput(documents: ReturnType<typeof backupDocuments>, target: LogicalDataset) {
  const targetEnvironment = environment("--target-env");
  const targetProjectId = required("--target-project");
  const apply = argv.includes("--apply");
  const plan = planLogicalRestore({
    documents,
    target,
    targetEnvironment,
    targetProjectId,
    expectedProjectId: apply ? required("--expected-project") : option("--expected-project"),
    confirmationProjectId: option("--confirm-project"),
    apply,
  });
  process.stdout.write(JSON.stringify(summary(plan), null, 2) + "\n");
  if (apply) {
    const output = required("--output");
    writeJson(output, applyLogicalRestore(documents, target, plan));
    process.stdout.write("Aplicado únicamente al archivo local: " + resolve(output) + "\n");
  }
}

function main(): void {
  if (command === "preflight") {
    const report = inspectApplicationEnvironment(process.env);
    process.stdout.write(JSON.stringify(report, null, 2) + "\n");
    if (!report.ok) process.exitCode = 2;
    return;
  }
  if (command === "backup") {
    const dataset = readJson<LogicalDataset>(required("--input"));
    ensureDatasetIdentity(dataset, "--source-env", "--source-project");
    const bundle = createLogicalBackup(dataset);
    writeJson(required("--output"), bundle);
    process.stdout.write(JSON.stringify({ mode: "READ_ONLY_EXPORT", sourceProjectId: bundle.sourceProjectId, documents: bundle.documents.length, accessMetadata: bundle.accessMetadata.length, cloudinaryReferences: bundle.cloudinaryReferences.length }, null, 2) + "\n");
    return;
  }
  if (command === "validate") {
    const file = positional(0) ?? required("--input");
    const value = readJson<LogicalDataset | BackupBundle>(file);
    const report = value.kind === "ALAMEDAPP_LOGICAL_BACKUP"
      ? validateBackupBundle(value as BackupBundle)
      : validateLogicalDataset(value as LogicalDataset);
    process.stdout.write(JSON.stringify(report, null, 2) + "\n");
    if (!report.ok) process.exitCode = 2;
    return;
  }
  if (command === "restore") {
    const bundle = readJson<BackupBundle>(positional(0) ?? required("--input"));
    const report = validateBackupBundle(bundle);
    if (!report.ok) throw new Error(report.errors.join(" | "));
    const target = readJson<LogicalDataset>(required("--target-data"));
    restoreInput(backupDocuments(bundle), target);
    return;
  }
  if (command === "export-match") {
    const matchId = positional(0);
    if (!matchId) throw new Error("Falta matchId explícito.");
    const dataset = readJson<LogicalDataset>(required("--input"));
    ensureDatasetIdentity(dataset, "--source-env", "--source-project");
    const bundle = createSelectiveMatchBundle(dataset, matchId);
    writeJson(required("--output"), bundle);
    process.stdout.write(JSON.stringify({ mode: "READ_ONLY_EXPORT", matchId, events: bundle.events.length, players: bundle.referencedPlayers.length, memberships: bundle.relevantMemberships.length, staff: bundle.relevantStaff.length, videoSegments: bundle.videoMetadata.segments.length }, null, 2) + "\n");
    return;
  }
  if (command === "import-match") {
    const bundle = readJson<MatchBundle>(positional(0) ?? required("--input"));
    assertExpectedEnvironment({ environment: bundle.sourceEnvironment, projectId: bundle.sourceProjectId, action: "EXPORT_MATCH" });
    const target = readJson<LogicalDataset>(required("--target-data"));
    restoreInput(matchBundleDocuments(bundle), target);
    return;
  }
  throw new Error("Comando desconocido. Usa preflight, backup, validate, restore, export-match o import-match.");
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
