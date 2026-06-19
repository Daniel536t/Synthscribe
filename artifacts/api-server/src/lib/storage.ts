import { objectStorageClient, ObjectStorageService } from "./objectStorage";

const service = new ObjectStorageService();

function parseObjectPath(fullPath: string): { bucketName: string; objectName: string } {
  let p = fullPath;
  if (!p.startsWith("/")) p = `/${p}`;
  const parts = p.split("/");
  if (parts.length < 3) {
    throw new Error("Invalid object path: must contain a bucket name");
  }
  return { bucketName: parts[1], objectName: parts.slice(2).join("/") };
}

/**
 * Upload a buffer to the private object dir under the given relative key.
 * Returns the entity object path (e.g. "/objects/synthscribe/<id>/final.wav")
 * which can be served via GET /api/storage/objects/<...>.
 */
export async function uploadBuffer(
  key: string,
  buffer: Buffer,
  contentType: string,
): Promise<string> {
  let dir = service.getPrivateObjectDir();
  if (dir.endsWith("/")) dir = dir.slice(0, -1);
  const fullPath = `${dir}/${key}`;
  const { bucketName, objectName } = parseObjectPath(fullPath);
  const file = objectStorageClient.bucket(bucketName).file(objectName);
  await file.save(buffer, {
    contentType,
    metadata: { contentType },
    resumable: false,
  });
  return `/objects/${key}`;
}

/**
 * Download an object (by its "/objects/<key>" path) into a Buffer.
 */
export async function downloadToBuffer(objectPath: string): Promise<Buffer> {
  const file = await service.getObjectEntityFile(objectPath);
  const [contents] = await file.download();
  return contents;
}

/**
 * Convert a stored object path ("/objects/...") into a browser-fetchable URL
 * served through the API server ("/api/storage/objects/...").
 */
export function objectPathToUrl(objectPath: string | null): string | null {
  if (!objectPath) return null;
  return `/api/storage${objectPath}`;
}
