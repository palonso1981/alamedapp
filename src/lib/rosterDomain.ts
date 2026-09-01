import {
  CDA_CLUB_ID,
  MasterPlayer,
  MasterPlayerRole,
  MasterStaffMember,
  MasterStaffRole,
  Player,
  StaffMember,
  TeamRoster,
  DominantFoot,
  FutsalPosition,
} from "../types";

export interface MasterPlayerInput {
  fullName: string;
  displayName: string;
  number: number;
  photoUrl?: string;
  role: MasterPlayerRole;
  dateOfBirth?: string;
  primaryPosition?: FutsalPosition;
  dominantFoot?: Exclude<DominantFoot, "UNKNOWN">;
  canPlayGoalkeeper?: boolean;
}

export interface MasterStaffInput {
  fullName: string;
  displayName: string;
  role: MasterStaffRole;
  customRole?: string;
  photoUrl?: string;
}

function cleanRequired(value: string, label: string): string {
  const cleaned = value.trim();
  if (!cleaned) throw new Error(`${label} es obligatorio.`);
  return cleaned;
}

function cleanOptional(value?: string): string | undefined {
  const cleaned = value?.trim();
  return cleaned ? cleaned : undefined;
}

function identityKey(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLocaleLowerCase("es").replace(/\s+/g, " ");
}

export function findClubPlayerByIdentity(
  players: readonly MasterPlayer[],
  fullName: string,
): MasterPlayer | undefined {
  const key = identityKey(fullName);
  return players.find((player) => !player.deletedAt && identityKey(player.fullName) === key);
}

function validNumber(number: number): number {
  const normalized = Math.trunc(number);
  if (!Number.isFinite(number) || normalized < 0 || normalized > 99) {
    throw new Error("El dorsal debe estar entre 0 y 99.");
  }
  return normalized;
}

function validDateOfBirth(value?: string): string | undefined {
  const cleaned = cleanOptional(value);
  if (!cleaned) return undefined;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(cleaned) || Number.isNaN(Date.parse(`${cleaned}T00:00:00Z`))) {
    throw new Error("La fecha de nacimiento no es válida.");
  }
  return cleaned;
}

export function canPlayGoalkeeper(player: MasterPlayer): boolean {
  return player.canPlayGoalkeeper ?? player.role === "GOALKEEPER";
}

export function assertUniqueActiveNumber(
  players: readonly MasterPlayer[],
  number: number,
  exceptPlayerId?: string,
): void {
  const duplicate = players.find(
    (player) =>
      player.active &&
      player.playerId !== exceptPlayerId &&
      player.number === number,
  );
  if (duplicate) {
    throw new Error(`El dorsal ${number} ya pertenece a ${duplicate.displayName}.`);
  }
}

export function createMasterPlayer(
  players: readonly MasterPlayer[],
  input: MasterPlayerInput,
  options: { id?: string; now?: number } = {},
): MasterPlayer {
  const number = validNumber(input.number);
  assertUniqueActiveNumber(players, number);
  const now = options.now ?? Date.now();
  const goalkeeperCapable = input.canPlayGoalkeeper ?? input.role === "GOALKEEPER";
  return {
    playerId: options.id ?? globalThis.crypto.randomUUID(),
    clubId: CDA_CLUB_ID,
    fullName: cleanRequired(input.fullName, "El nombre"),
    displayName: cleanRequired(input.displayName, "El nombre corto"),
    number,
    photoUrl: cleanOptional(input.photoUrl),
    dateOfBirth: validDateOfBirth(input.dateOfBirth),
    primaryPosition: input.primaryPosition,
    dominantFoot: input.dominantFoot,
    canPlayGoalkeeper: goalkeeperCapable,
    role: goalkeeperCapable ? "GOALKEEPER" : "FIELD",
    active: true,
    createdAt: now,
    updatedAt: now,
  };
}

export function updateMasterPlayer(
  players: readonly MasterPlayer[],
  playerId: string,
  changes: Partial<MasterPlayerInput> & { active?: boolean },
  now = Date.now(),
): MasterPlayer[] {
  const current = players.find((player) => player.playerId === playerId);
  if (!current) throw new Error("El jugador no existe en la plantilla.");
  const goalkeeperCapable =
    changes.canPlayGoalkeeper ??
    (changes.role !== undefined
      ? changes.role === "GOALKEEPER"
      : canPlayGoalkeeper(current));
  const next: MasterPlayer = {
    ...current,
    fullName:
      changes.fullName === undefined
        ? current.fullName
        : cleanRequired(changes.fullName, "El nombre"),
    displayName:
      changes.displayName === undefined
        ? current.displayName
        : cleanRequired(changes.displayName, "El nombre corto"),
    number:
      changes.number === undefined ? current.number : validNumber(changes.number),
    photoUrl:
      changes.photoUrl === undefined
        ? current.photoUrl
        : cleanOptional(changes.photoUrl),
    dateOfBirth:
      changes.dateOfBirth === undefined
        ? current.dateOfBirth
        : validDateOfBirth(changes.dateOfBirth),
    primaryPosition:
      changes.primaryPosition === undefined
        ? current.primaryPosition
        : changes.primaryPosition,
    dominantFoot:
      changes.dominantFoot === undefined
        ? current.dominantFoot
        : changes.dominantFoot,
    canPlayGoalkeeper: goalkeeperCapable,
    role: goalkeeperCapable ? "GOALKEEPER" : "FIELD",
    active: changes.active ?? current.active,
    updatedAt: now,
  };
  if (next.active) assertUniqueActiveNumber(players, next.number, playerId);
  return players.map((player) => (player.playerId === playerId ? next : player));
}

export function createMasterStaff(
  input: MasterStaffInput,
  options: { id?: string; now?: number } = {},
): MasterStaffMember {
  const now = options.now ?? Date.now();
  return {
    staffId: options.id ?? globalThis.crypto.randomUUID(),
    clubId: CDA_CLUB_ID,
    fullName: cleanRequired(input.fullName, "El nombre"),
    displayName: cleanRequired(input.displayName, "El nombre corto"),
    role: input.role,
    customRole: cleanOptional(input.customRole),
    photoUrl: cleanOptional(input.photoUrl),
    active: true,
    createdAt: now,
    updatedAt: now,
  };
}

export function updateMasterStaff(
  staff: readonly MasterStaffMember[],
  staffId: string,
  changes: Partial<MasterStaffInput> & { active?: boolean },
  now = Date.now(),
): MasterStaffMember[] {
  const current = staff.find((member) => member.staffId === staffId);
  if (!current) throw new Error("El miembro de staff no existe.");
  const next: MasterStaffMember = {
    ...current,
    fullName:
      changes.fullName === undefined
        ? current.fullName
        : cleanRequired(changes.fullName, "El nombre"),
    displayName:
      changes.displayName === undefined
        ? current.displayName
        : cleanRequired(changes.displayName, "El nombre corto"),
    role: changes.role ?? current.role,
    customRole:
      changes.customRole === undefined
        ? current.customRole
        : cleanOptional(changes.customRole),
    photoUrl:
      changes.photoUrl === undefined
        ? current.photoUrl
        : cleanOptional(changes.photoUrl),
    active: changes.active ?? current.active,
    updatedAt: now,
  };
  return staff.map((member) => (member.staffId === staffId ? next : member));
}

export function playerSnapshot(
  player: MasterPlayer,
  functionalGoalkeeper = canPlayGoalkeeper(player),
): Player {
  return {
    id: player.playerId,
    name: player.displayName,
    fullName: player.fullName,
    number: player.number,
    photoUrl: player.photoUrl,
    position: functionalGoalkeeper ? "PORTERO" : "JUGADOR",
    goalkeeperCapable: canPlayGoalkeeper(player),
    naturalPosition: player.primaryPosition,
    dateOfBirth: player.dateOfBirth,
    dominantFoot: player.dominantFoot,
  };
}

const STAFF_ROLE_LABELS: Record<MasterStaffRole, string> = {
  HEAD_COACH: "Entrenador",
  ASSISTANT_COACH: "Segundo entrenador",
  DELEGATE: "Delegado",
  FITNESS_COACH: "Preparador",
  OTHER: "Otro",
};

export function staffRoleLabel(member: MasterStaffMember): string {
  return member.role === "OTHER" && member.customRole
    ? member.customRole
    : STAFF_ROLE_LABELS[member.role];
}

export function staffSnapshot(member: MasterStaffMember): StaffMember {
  return {
    id: member.staffId,
    name: member.displayName,
    fullName: member.fullName,
    role: staffRoleLabel(member),
    photoUrl: member.photoUrl,
  };
}

export function emptyRoster(teamId: string): TeamRoster {
  return { teamId, players: [], staff: [] };
}
