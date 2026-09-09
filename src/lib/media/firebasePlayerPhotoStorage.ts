import { getFirebaseDevServices } from "../firebase";
import { PlayerPhotoStorageAdapter } from "./playerPhoto";

const FIREBASE_MEDIA_DEV_PROJECT = "cdalameda-dev";

export class FirebaseDevPlayerPhotoStorage implements PlayerPhotoStorageAdapter {
  private async context() {
    const [{ deleteObject, getDownloadURL, getStorage, ref, uploadBytes }, services] = await Promise.all([import("firebase/storage"), getFirebaseDevServices()]);
    if (services.app.options.projectId !== FIREBASE_MEDIA_DEV_PROJECT) throw new Error("La subida de fotos solo está habilitada para Firebase DEV.");
    if (!services.auth.currentUser) throw new Error("Necesitas conexión y autenticación para subir fotos.");
    return { deleteObject, getDownloadURL, ownerUid: services.auth.currentUser.uid, ref, uploadBytes, storage: getStorage(services.app) };
  }

  async upload(input: Parameters<PlayerPhotoStorageAdapter["upload"]>[0]): Promise<{ url: string }> {
    if (input.metadata.clubId !== "cd-alameda") throw new Error("Storage DEV solo está habilitado para CD Alameda.");
    const { getDownloadURL, ownerUid, ref, storage, uploadBytes } = await this.context();
    const reference = ref(storage, input.path);
    await uploadBytes(reference, input.data, { contentType: input.contentType, cacheControl: "public,max-age=31536000,immutable", customMetadata: { ...input.metadata, ownerUid } });
    return { url: await getDownloadURL(reference) };
  }

  async delete(path: string): Promise<void> {
    const { deleteObject, ref, storage } = await this.context();
    try { await deleteObject(ref(storage, path)); }
    catch (error) { if ((error as { code?: string }).code !== "storage/object-not-found") throw error; }
  }
}
