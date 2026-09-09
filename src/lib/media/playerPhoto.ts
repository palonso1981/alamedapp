import { CloudinaryManagedPlayerPhoto, ManagedPlayerPhoto, MasterPlayer } from "../../types";

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
export interface PlayerPhotoUploadResult {
  publicId: string;
  secureUrl: string;
  version?: number;
  contentType: typeof PLAYER_PHOTO_OUTPUT_TYPE;
  width: number;
  height: number;
  byteSize: number;
  uploadedAt?: number;
}
export interface PlayerPhotoStorageAdapter {
  upload(input: {
    data: Blob;
    contentType: typeof PLAYER_PHOTO_OUTPUT_TYPE;
  }): Promise<PlayerPhotoUploadResult>;
  /** Solo existe para providers capaces de borrar sin exponer secretos al cliente. */
  delete?(photo: ManagedPlayerPhoto): Promise<void>;
}
export interface ReplacePlayerPhotoInput {
  clubId: string;
  player: MasterPlayer;
  file: File;
  storage: PlayerPhotoStorageAdapter;
  persist: (photo: ManagedPlayerPhoto | null) => void | Promise<void>;
  process?: (file: File) => Promise<PreparedPlayerPhoto>;
  now?: () => number;
}

export function validatePlayerPhotoCandidate(file: PlayerPhotoCandidate): void {
  if (!PLAYER_PHOTO_INPUT_TYPES.includes(file.type as typeof PLAYER_PHOTO_INPUT_TYPES[number])) {
    throw new Error("Formato no compatible. Usa JPEG, PNG o WebP.");
  }
  if (file.size <= 0) throw new Error("La imagen está vacía.");
  if (file.size > PLAYER_PHOTO_MAX_INPUT_BYTES) throw new Error("La imagen es demasiado grande. El máximo es 12 MB.");
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

export async function replacePlayerPhoto(input: ReplacePlayerPhotoInput): Promise<{ photo: CloudinaryManagedPlayerPhoto; cleanupPending: boolean }> {
  if (input.player.clubId && input.player.clubId !== input.clubId) throw new Error("El jugador no pertenece al club activo.");
  validatePlayerPhotoCandidate(input.file);
  const prepared = await (input.process ?? preparePlayerPhoto)(input.file);
  if (prepared.blob.size > PLAYER_PHOTO_MAX_OUTPUT_BYTES) throw new Error("La imagen procesada es demasiado grande.");
  const now = (input.now ?? Date.now)();
  let result: PlayerPhotoUploadResult;
  try {
    result = await input.storage.upload({ data: prepared.blob, contentType: prepared.contentType });
  } catch (error) {
    if (error instanceof Error && error.message) throw new Error(`No se pudo subir la foto: ${error.message}`);
    throw new Error("No se pudo subir la foto. Comprueba la conexión y vuelve a intentarlo.");
  }
  const photo: CloudinaryManagedPlayerPhoto = {
    provider: "CLOUDINARY",
    publicId: result.publicId,
    secureUrl: result.secureUrl,
    version: result.version,
    contentType: result.contentType,
    width: result.width,
    height: result.height,
    byteSize: result.byteSize,
    uploadedAt: result.uploadedAt ?? now,
  };
  try {
    await input.persist(photo);
  } catch (error) {
    if (input.storage.delete) await input.storage.delete(photo).catch(() => undefined);
    throw error;
  }
  let cleanupPending = false;
  const previous = input.player.managedPhoto;
  if (previous) {
    if (!input.storage.delete) cleanupPending = true;
    else {
      try { await input.storage.delete(previous); } catch { cleanupPending = true; }
    }
  }
  return { photo, cleanupPending };
}

export async function removePlayerPhoto(input: { player: MasterPlayer; storage: PlayerPhotoStorageAdapter; persist: (photo: null) => void | Promise<void> }): Promise<{ cleanupPending: boolean }> {
  const previous = input.player.managedPhoto;
  await input.persist(null);
  if (!previous) return { cleanupPending: false };
  if (!input.storage.delete) return { cleanupPending: true };
  try {
    await input.storage.delete(previous);
    return { cleanupPending: false };
  } catch {
    return { cleanupPending: true };
  }
}
