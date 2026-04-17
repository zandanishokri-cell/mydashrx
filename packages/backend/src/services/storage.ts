import { randomUUID } from 'crypto';
import { writeFile, mkdir } from 'fs/promises';
import { join } from 'path';

const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const useS3 = !!(process.env.AWS_BUCKET_NAME && process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY);
const useR2 = !!(process.env.R2_ENDPOINT && process.env.R2_ACCESS_KEY_ID && process.env.R2_BUCKET_NAME);

// ── Local disk storage (dev fallback) ────────────────────────────────────────
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

// ── AWS S3 storage (HIPAA BAA signed) ────────────────────────────────────────
async function uploadS3(buffer: Buffer, mimeType: string, folder: string): Promise<{ key: string; url: string }> {
  const { S3Client, PutObjectCommand, GetObjectCommand } = await import('@aws-sdk/client-s3');
  const { getSignedUrl } = await import('@aws-sdk/s3-request-presigner');
  const s3 = new S3Client({
    region: process.env.AWS_REGION ?? 'us-east-1',
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID!.trim(),
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!.trim(),
    },
  });
  const BUCKET = process.env.AWS_BUCKET_NAME!;
  const ext = mimeType === 'image/jpeg' ? 'jpg' : mimeType === 'image/webp' ? 'webp' : 'png';
  const key = `${folder}/${randomUUID()}.${ext}`;
  await s3.send(new PutObjectCommand({
    Bucket: BUCKET, Key: key, Body: buffer, ContentType: mimeType,
    ServerSideEncryption: 'AES256', // enforce encryption at rest
  }));
  // Signed URL valid 7 days
  const url = await getSignedUrl(s3, new GetObjectCommand({ Bucket: BUCKET, Key: key }), { expiresIn: 3600 * 24 * 7 });
  return { key, url };
}

// ── Cloudflare R2 storage (S3-compatible, no egress fees) ────────────────────
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

// AWS S3 takes priority (BAA signed) → R2 fallback → local dev
export async function uploadBuffer(buffer: Buffer, mimeType: string, folder = 'pod'): Promise<{ key: string; url: string }> {
  if (!ALLOWED_MIME_TYPES.includes(mimeType)) throw new Error(`Unsupported MIME type: ${mimeType}`);
  if (useS3) return uploadS3(buffer, mimeType, folder);
  if (useR2) return uploadR2(buffer, mimeType, folder);
  return uploadLocal(buffer, mimeType, folder);
}
