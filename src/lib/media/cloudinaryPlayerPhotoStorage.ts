import { PlayerPhotoStorageAdapter, PlayerPhotoUploadResult } from "./playerPhoto";

export interface CloudinaryPublicConfig {
  cloudName: string;
  uploadPreset: string;
}

interface CloudinaryUploadPayload {
  public_id?: unknown;
  secure_url?: unknown;
  version?: unknown;
  width?: unknown;
  height?: unknown;
  bytes?: unknown;
  format?: unknown;
  resource_type?: unknown;
  created_at?: unknown;
  error?: { message?: unknown };
}

const safeConfigValue = /^[A-Za-z0-9_-]+$/;

export function cloudinaryPublicConfig(): CloudinaryPublicConfig {
  const cloudName = process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME?.trim() ?? "";
  const uploadPreset = process.env.NEXT_PUBLIC_CLOUDINARY_UPLOAD_PRESET?.trim() ?? "";
  if (!cloudName || !uploadPreset || !safeConfigValue.test(cloudName) || !safeConfigValue.test(uploadPreset)) {
    throw new Error("Cloudinary no está configurado para subir fotografías.");
  }
  return { cloudName, uploadPreset };
}

export function cloudinaryUploadEndpoint(cloudName: string): string {
  if (!safeConfigValue.test(cloudName)) throw new Error("La configuración de Cloudinary no es válida.");
  return `https://api.cloudinary.com/v1_1/${cloudName}/image/upload`;
}

const positiveNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value > 0;

export function parseCloudinaryUploadResponse(payload: CloudinaryUploadPayload): PlayerPhotoUploadResult {
  if (payload.error?.message && typeof payload.error.message === "string") throw new Error(payload.error.message);
  if (
    typeof payload.public_id !== "string" || !payload.public_id ||
    typeof payload.secure_url !== "string" || !payload.secure_url.startsWith("https://") ||
    !positiveNumber(payload.width) || !positiveNumber(payload.height) || !positiveNumber(payload.bytes) ||
    payload.format !== "webp" || payload.resource_type !== "image"
  ) throw new Error("Cloudinary devolvió una respuesta de imagen incompleta.");
  const uploadedAt = typeof payload.created_at === "string" ? Date.parse(payload.created_at) : Number.NaN;
  return {
    publicId: payload.public_id,
    secureUrl: payload.secure_url,
    version: positiveNumber(payload.version) ? payload.version : undefined,
    contentType: "image/webp",
    width: payload.width,
    height: payload.height,
    byteSize: payload.bytes,
    uploadedAt: Number.isFinite(uploadedAt) ? uploadedAt : undefined,
  };
}

export class CloudinaryPlayerPhotoStorage implements PlayerPhotoStorageAdapter {
  constructor(
    private readonly config: CloudinaryPublicConfig = cloudinaryPublicConfig(),
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  async upload(input: Parameters<PlayerPhotoStorageAdapter["upload"]>[0]): Promise<PlayerPhotoUploadResult> {
    const form = new FormData();
    form.append("file", input.data, "player-photo.webp");
    form.append("upload_preset", this.config.uploadPreset);
    // `window.fetch` debe invocarse desligado de la instancia del adapter.
    const fetcher = this.fetcher;
    const response = await fetcher(cloudinaryUploadEndpoint(this.config.cloudName), { method: "POST", body: form });
    const payload = await response.json().catch(() => ({})) as CloudinaryUploadPayload;
    if (!response.ok) {
      const detail = typeof payload.error?.message === "string" ? `: ${payload.error.message}` : "";
      throw new Error(`Cloudinary rechazó la imagen${detail}`);
    }
    return parseCloudinaryUploadResponse(payload);
  }

  // El borrado requiere firma/API Secret. Deliberadamente no se implementa en navegador.
}
