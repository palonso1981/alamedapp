import { ManagedPlayerPhoto, MasterPlayer } from "../../types";

export const PLAYER_PHOTO_INPUT_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export const PLAYER_PHOTO_MAX_INPUT_BYTES = 12 * 1024 * 1024;
export const PLAYER_PHOTO_MAX_OUTPUT_BYTES = 2 * 1024 * 1024;
export const PLAYER_PHOTO_MAX_EDGE = 1280;
export const PLAYER_PHOTO_OUTPUT_TYPE = "image/webp" as const;

export interface PlayerPhotoCandidate { type: string; size: number }
export interface PreparedPlayerPhoto {
  blob: Blob;
  contentType: typeof PLAYER_PHOTO_OUTPUT_TYPE;
  width: number;
  height: number;
}
export interface PlayerPhotoStorageAdapter {
  upload(input: {
    path: string;
    data: Blob;
    contentType: typeof PLAYER_PHOTO_OUTPUT_TYPE;
    metadata: { clubId: string; playerId: string; version: string };
  }): Promise<{ url: string }>;
  delete(path: string): Promise<void>;
}
export interface ReplacePlayerPhotoInput {
  clubId: string;
  player: MasterPlayer;
  file: File;
  storage: PlayerPhotoStorageAdapter;
  persist: (photo: ManagedPlayerPhoto | null) => void | Promise<void>;
  process?: (file: File) => Promise<PreparedPlayerPhoto>;
  now?: () => number;
  idFactory?: () => string;
}

export function validatePlayerPhotoCandidate(file: PlayerPhotoCandidate): void {
  if (!PLAYER_PHOTO_INPUT_TYPES.includes(file.type as typeof PLAYER_PHOTO_INPUT_TYPES[number])) {
    throw new Error("Formato no compatible. Usa JPEG, PNG o WebP.");
  }
  if (file.size <= 0) throw new Error("La imagen está vacía.");
  if (file.size > PLAYER_PHOTO_MAX_INPUT_BYTES) throw new Error("La imagen es demasiado grande. El máximo es 12 MB.");
}

const safeSegment = (value: string) => encodeURIComponent(value.trim());

export function playerPhotoStoragePath(clubId: string, playerId: string, version: string): string {
  if (!clubId.trim() || !playerId.trim() || !version.trim()) throw new Error("La identidad de la foto no es válida.");
  return `clubs/${safeSegment(clubId)}/players/${safeSegment(playerId)}/${safeSegment(version)}.webp`;
}

export function resolvePlayerPhoto(player: Pick<MasterPlayer, "managedPhoto" | "photoUrl">): string | undefined {
  return player.managedPhoto?.url || player.photoUrl;
}

function canvasBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob(
    (blob) => blob ? resolve(blob) : reject(new Error("No se pudo preparar la imagen.")),
    PLAYER_PHOTO_OUTPUT_TYPE,
    quality,
  ));
}

export async function preparePlayerPhoto(file: File): Promise<PreparedPlayerPhoto> {
  validatePlayerPhotoCandidate(file);
  if (typeof createImageBitmap !== "function" || typeof document === "undefined") throw new Error("Este dispositivo no permite preparar la imagen.");
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    throw new Error("No se pudo leer la imagen seleccionada.");
  }
  try {
    const scale = Math.min(1, PLAYER_PHOTO_MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("No se pudo preparar la imagen.");
    context.drawImage(bitmap, 0, 0, width, height);
    let blob = await canvasBlob(canvas, 0.84);
    if (blob.size > PLAYER_PHOTO_MAX_OUTPUT_BYTES) blob = await canvasBlob(canvas, 0.68);
    if (blob.size > PLAYER_PHOTO_MAX_OUTPUT_BYTES) throw new Error("No se pudo reducir la imagen a un tamaño seguro.");
    return { blob, contentType: PLAYER_PHOTO_OUTPUT_TYPE, width, height };
  } finally {
    bitmap.close();
  }
}

export async function replacePlayerPhoto(input: ReplacePlayerPhotoInput): Promise<{ photo: ManagedPlayerPhoto; cleanupPending: boolean }> {
  if (input.player.clubId && input.player.clubId !== input.clubId) throw new Error("El jugador no pertenece al club activo.");
  validatePlayerPhotoCandidate(input.file);
  const prepared = await (input.process ?? preparePlayerPhoto)(input.file);
  if (prepared.blob.size > PLAYER_PHOTO_MAX_OUTPUT_BYTES) throw new Error("La imagen procesada es demasiado grande.");
  const now = (input.now ?? Date.now)();
  const version = `${now}-${(input.idFactory ?? (() => crypto.randomUUID()))()}`;
  const path = playerPhotoStoragePath(input.clubId, input.player.playerId, version);
  let result: { url: string };
  try {
    result = await input.storage.upload({ path, data: prepared.blob, contentType: prepared.contentType, metadata: { clubId: input.clubId, playerId: input.player.playerId, version } });
  } catch {
    throw new Error("No se pudo subir la foto. Comprueba la conexión y vuelve a intentarlo.");
  }
  const photo: ManagedPlayerPhoto = { provider: "FIREBASE_STORAGE", path, url: result.url, version, contentType: prepared.contentType, width: prepared.width, height: prepared.height, byteSize: prepared.blob.size, updatedAt: now };
  try {
    await input.persist(photo);
  } catch (error) {
    await input.storage.delete(path).catch(() => undefined);
    throw error;
  }
  let cleanupPending = false;
  const previousPath = input.player.managedPhoto?.path;
  if (previousPath && previousPath !== path) {
    try { await input.storage.delete(previousPath); } catch { cleanupPending = true; }
  }
  return { photo, cleanupPending };
}

export async function removePlayerPhoto(input: { player: MasterPlayer; storage: PlayerPhotoStorageAdapter; persist: (photo: null) => void | Promise<void> }): Promise<{ cleanupPending: boolean }> {
  const path = input.player.managedPhoto?.path;
  await input.persist(null);
  if (!path) return { cleanupPending: false };
  try {
    await input.storage.delete(path);
    return { cleanupPending: false };
  } catch {
    return { cleanupPending: true };
  }
}
