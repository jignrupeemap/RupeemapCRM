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

/** JSON with object keys sorted, so a row hashes the same after a round trip through jsonb. */
export function canonical(v: unknown): string {
  if (v === null || v === undefined) return 'null';
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    const keys = Object.keys(o).filter((k) => o[k] !== undefined).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`).join(',')}}`;
  }
  return JSON.stringify(v);
}

export interface HashInput {
  prevHash: string | null;
  actorId: string | null;
  action: string;
  entity: string;
  entityId: string | null;
  before: unknown;
  after: unknown;
  at: Date;
}

export function auditHash(r: HashInput) {
  return createHash('sha256')
    .update(canonical([r.prevHash, r.actorId, r.action, r.entity, r.entityId, r.before ?? null, r.after ?? null, r.at.toISOString()]))
    .digest('hex');
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
    const hash = auditHash({ prevHash, actorId: actor?.id ?? null, action: entry.action, entity: entry.entity, entityId: entry.entityId ?? null, before, after, at });
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
