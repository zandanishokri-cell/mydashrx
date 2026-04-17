import { randomUUID } from 'crypto';
import { writeFile, mkdir } from 'fs/promises';
import { join } from 'path';

const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const useR2 = !!(process.env.R2_ENDPOINT && process.env.R2_ACCESS_KEY_ID && process.env.R2_BUCKET_NAME);

// ── Local disk storage (dev / no R2 configured) ──────────────────────────────
const UPLOAD_DIR = process.env.UPLOAD_DIR ?? join(process.cwd(), 'uploads');

async function uploadLocal(buffer: Buffer, mimeType: string, folder: string): Promise<{ key: string; url: string }> {
  const ext = mimeType === 'image/jpeg' ? 'jpg' : mimeType === 'image/webp' ? 'webp' : 'png';
  const key = `${folder}/${randomUUID()}.${ext}`;
  const dir = join(UPLOAD_DIR, folder);
  await mkdir(dir, { recursive: true });
  await writeFile(join(UPLOAD_DIR, key), buffer);
  const baseUrl = process.env.API_BASE_URL ?? 'http://localhost:3001';
  return { key, url: `${baseUrl}/uploads/${key}` };
}

// ── R2 / S3 storage (production) ─────────────────────────────────────────────
async function uploadR2(buffer: Buffer, mimeType: string, folder: string): Promise<{ key: string; url: string }> {
  const { S3Client, PutObjectCommand, GetObjectCommand } = await import('@aws-sdk/client-s3');
  const { getSignedUrl } = await import('@aws-sdk/s3-request-presigner');
  const r2 = new S3Client({
    region: 'auto',
    endpoint: process.env.R2_ENDPOINT!,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID!,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
    },
  });
  const BUCKET = process.env.R2_BUCKET_NAME!;
  const ext = mimeType === 'image/jpeg' ? 'jpg' : mimeType === 'image/webp' ? 'webp' : 'png';
  const key = `${folder}/${randomUUID()}.${ext}`;
  await r2.send(new PutObjectCommand({ Bucket: BUCKET, Key: key, Body: buffer, ContentType: mimeType }));
  const url = await getSignedUrl(r2, new GetObjectCommand({ Bucket: BUCKET, Key: key }), { expiresIn: 3600 * 24 * 7 });
  return { key, url };
}

export async function uploadBuffer(buffer: Buffer, mimeType: string, folder = 'pod'): Promise<{ key: string; url: string }> {
  if (!ALLOWED_MIME_TYPES.includes(mimeType)) throw new Error(`Unsupported MIME type: ${mimeType}`);
  return useR2 ? uploadR2(buffer, mimeType, folder) : uploadLocal(buffer, mimeType, folder);
}
