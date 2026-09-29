import { Injectable } from '@nestjs/common';
import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from 'crypto';
import { mkdir, readFile, writeFile } from 'fs/promises';
import path from 'path';
import { AppError } from './errors';

/** Allowed uploads, checked against the file's first bytes, never its name or browser-sent type. */
const SIGNATURES: { mime: string; ext: string[]; test: (b: Buffer) => boolean }[] = [
  { mime: 'application/pdf', ext: ['pdf'], test: (b) => b.subarray(0, 5).toString('latin1') === '%PDF-' },
  { mime: 'image/jpeg', ext: ['jpg', 'jpeg'], test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { mime: 'image/png', ext: ['png'], test: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { mime: 'image/webp', ext: ['webp'], test: (b) => b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP' },
];

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

export interface StoredFile {
  storageKey: string;
  originalName: string;
  mime: string;
  sizeBytes: number;
  sha256: string;
}

/**
 * Private file storage. Files are validated, encrypted with AES-256-GCM and
 * written under a random key outside the web root. The local driver is for
 * development and single-server installs; an S3 driver plugs in behind the
 * same interface for production.
 */
@Injectable()
export class StorageService {
  private readonly dir = path.resolve(process.env.STORAGE_DIR ?? path.join(process.cwd(), 'storage'));

  private key(): Buffer {
    const hex = process.env.FILE_ENCRYPTION_KEY;
    if (hex && /^[0-9a-f]{64}$/i.test(hex)) return Buffer.from(hex, 'hex');
    if (process.env.NODE_ENV === 'production') throw new Error('FILE_ENCRYPTION_KEY (64 hex chars) is required in production');
    return createHash('sha256').update('rupeemap-dev-only-file-key').digest();
  }

  /** Validates type, size and name. Throws a user-facing error when the file is not acceptable. */
  inspect(file: { buffer: Buffer; originalname: string; size: number }) {
    if (!file?.buffer?.length) throw new AppError('VALIDATION_ERROR', 'Choose a file to upload');
    if (file.size > MAX_UPLOAD_BYTES) throw new AppError('VALIDATION_ERROR', 'File is larger than 10 MB');
    const ext = (file.originalname.split('.').pop() ?? '').toLowerCase();
    const sig = SIGNATURES.find((s) => s.test(file.buffer));
    if (!sig || !sig.ext.includes(ext)) throw new AppError('VALIDATION_ERROR', 'Upload a PDF, JPG, PNG or WEBP file');
    const safeName = file.originalname
      .normalize('NFKC')
      .replace(/[^\w.\- ]+/g, '_')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(-120);
    return { mime: sig.mime, name: safeName || `document.${sig.ext[0]}` };
  }

  async save(file: { buffer: Buffer; originalname: string; size: number }): Promise<StoredFile> {
    const { mime, name } = this.inspect(file);
    const storageKey = `${new Date().toISOString().slice(0, 7)}/${randomUUID()}`;
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key(), iv);
    const body = Buffer.concat([cipher.update(file.buffer), cipher.final()]);
    const target = this.pathFor(storageKey);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, Buffer.concat([iv, cipher.getAuthTag(), body]), { flag: 'wx' });
    return { storageKey, originalName: name, mime, sizeBytes: file.size, sha256: createHash('sha256').update(file.buffer).digest('hex') };
  }

  async read(storageKey: string): Promise<Buffer> {
    const raw = await readFile(this.pathFor(storageKey));
    const decipher = createDecipheriv('aes-256-gcm', this.key(), raw.subarray(0, 12));
    decipher.setAuthTag(raw.subarray(12, 28));
    return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]);
  }

  private pathFor(storageKey: string) {
    if (!/^\d{4}-\d{2}\/[0-9a-f-]{36}$/.test(storageKey)) throw new Error('Invalid storage key');
    return path.join(this.dir, storageKey);
  }
}
