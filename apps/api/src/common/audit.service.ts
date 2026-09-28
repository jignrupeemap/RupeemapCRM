import { Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import { Prisma } from '@prisma/client';
import type { Tx } from './prisma.service';
import type { AuthUser, RequestMeta } from './auth-context';

const SECRET_KEYS = /pass(word)?|otp|token|secret|hash/i;

function scrub(v: unknown): unknown {
  if (v === null || v === undefined) return v;
  if (Array.isArray(v)) return v.map(scrub);
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'object') {
    if (Prisma.Decimal.isDecimal(v)) return (v as Prisma.Decimal).toString();
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      out[k] = SECRET_KEYS.test(k) ? '[redacted]' : scrub(val);
    }
    return out;
  }
  if (typeof v === 'bigint') return v.toString();
  return v;
}

export interface AuditEntry {
  action: string;
  entity: string;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
}

/**
 * Append-only, hash-chained audit log. Always written inside the same
 * transaction as the change it describes.
 */
@Injectable()
export class AuditService {
  async log(tx: Tx, actor: Pick<AuthUser, 'id' | 'role'> | null, entry: AuditEntry, meta: RequestMeta = {}) {
    // Serialise writers so the hash chain stays linear.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(7300001)`;
    const last = await tx.auditLog.findFirst({ orderBy: { id: 'desc' }, select: { hash: true } });
    const before = scrub(entry.before) as Prisma.InputJsonValue | undefined;
    const after = scrub(entry.after) as Prisma.InputJsonValue | undefined;
    const at = new Date();
    const prevHash = last?.hash ?? null;
    const hash = createHash('sha256')
      .update(JSON.stringify([prevHash, actor?.id ?? null, entry.action, entry.entity, entry.entityId ?? null, before ?? null, after ?? null, at.toISOString()]))
      .digest('hex');
    await tx.auditLog.create({
      data: {
        actorId: actor?.id ?? null,
        actorRole: actor?.role ?? null,
        action: entry.action,
        entity: entry.entity,
        entityId: entry.entityId ?? null,
        before: before ?? Prisma.JsonNull,
        after: after ?? Prisma.JsonNull,
        ip: meta.ip ?? null,
        requestId: meta.requestId ?? null,
        prevHash,
        hash,
        at,
      },
    });
  }
}
