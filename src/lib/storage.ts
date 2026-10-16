import { supabase } from './supabase';
import type { PhotoKind } from './types';

export const LOGO_BUCKET = 'logos';
export const PHOTO_BUCKET = 'job-photos';

const MAX_LOGO_BYTES = 2 * 1024 * 1024;

export async function uploadLogo(orgId: string, file: File): Promise<string> {
  if (!file.type.startsWith('image/')) throw new Error('Please choose an image file (PNG, JPG, SVG or WebP).');
  if (file.size > MAX_LOGO_BYTES) throw new Error('Logo must be under 2 MB.');
  const ext = (file.name.split('.').pop() || 'png').toLowerCase().replace(/[^a-z0-9]/g, '');
  const path = `${orgId}/logo-${Date.now()}.${ext}`;
  const { error } = await supabase.storage.from(LOGO_BUCKET).upload(path, file, {
    cacheControl: '31536000',
    contentType: file.type,
    upsert: false,
  });
  if (error) throw new Error(error.message);
  return supabase.storage.from(LOGO_BUCKET).getPublicUrl(path).data.publicUrl;
}

/** Downscale phone photos before upload — keeps uploads fast on cellular. */
export async function compressImage(file: File, maxSide = 1600, quality = 0.82): Promise<Blob> {
  if (!file.type.startsWith('image/') || file.type === 'image/gif') return file;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
    const w = Math.round(bitmap.width * scale);
    const h = Math.round(bitmap.height * scale);
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0, w, h);
    const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/jpeg', quality));
    return blob ?? file;
  } catch {
    return file;
  }
}

export async function uploadJobPhoto(orgId: string, jobId: string, kind: PhotoKind, file: File, userId: string) {
  const blob = await compressImage(file);
  const path = `${orgId}/${jobId}/${kind}/${crypto.randomUUID()}.jpg`;
  const up = await supabase.storage.from(PHOTO_BUCKET).upload(path, blob, { contentType: 'image/jpeg', upsert: false });
  if (up.error) throw new Error(up.error.message);
  const ins = await supabase
    .from('job_photos')
    .insert({ org_id: orgId, job_id: jobId, kind, storage_path: path, uploaded_by: userId })
    .select()
    .single();
  if (ins.error) {
    await supabase.storage.from(PHOTO_BUCKET).remove([path]);
    throw new Error(ins.error.message);
  }
  return ins.data;
}

export async function signedPhotoUrls(paths: string[]): Promise<Record<string, string>> {
  if (!paths.length) return {};
  const { data, error } = await supabase.storage.from(PHOTO_BUCKET).createSignedUrls(paths, 60 * 60);
  if (error) throw new Error(error.message);
  const out: Record<string, string> = {};
  for (const row of data ?? []) if (row.path && row.signedUrl) out[row.path] = row.signedUrl;
  return out;
}

export async function deleteJobPhoto(id: string, path: string) {
  const del = await supabase.from('job_photos').delete().eq('id', id);
  if (del.error) throw new Error(del.error.message);
  await supabase.storage.from(PHOTO_BUCKET).remove([path]);
}
