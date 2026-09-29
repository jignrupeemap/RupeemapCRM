import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { TICKET_STATUS_LABELS, effectivePermissions, type Permission, type Role, type TicketKind, type TicketStatus, ticketCreateSchema, ticketReplySchema, ticketUpdateSchema } from '@rupeemap/shared';
import type { z } from 'zod';
import { PrismaService, type Tx } from '../common/prisma.service';
import { AuditService } from '../common/audit.service';
import { NotifyService } from '../common/notify.service';
import { ScopeService } from '../common/scope.service';
import { StorageService } from '../common/storage.service';
import { AppError, conflict, forbidden, notFound } from '../common/errors';
import { can, type AuthUser, type RequestMeta } from '../common/auth-context';
import { Paged } from '../common/http';

const CREATE: Record<TicketKind, Permission> = { QUERY: 'QUERY_CREATE', ASSISTANCE: 'SUPPORT_CREATE' };
const HANDLE: Record<TicketKind, Permission> = { QUERY: 'QUERY_ANSWER', ASSISTANCE: 'SUPPORT_HANDLE' };
const PREFIX: Record<TicketKind, string> = { QUERY: 'Q', ASSISTANCE: 'A' };
const isStaff = (u: AuthUser) => u.role === 'ADMIN' || u.role === 'EXECUTIVE';

/**
 * Raise Query (PART 45) and Need Assistance (PART 46). Partners raise and follow
 * their own tickets (a DSA also sees their Team Partners'); Admin/Executives with
 * the handle permission assign, reply, add internal notes, resolve and close.
 * The conversation is append-only, and internal notes never reach partners.
 */
@Injectable()
export class TicketsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notify: NotifyService,
    private readonly scope: ScopeService,
    private readonly storage: StorageService,
  ) {}

  private handles(user: AuthUser, kind: TicketKind) {
    return isStaff(user) && can(user, HANDLE[kind]);
  }

  private where(user: AuthUser, kind: TicketKind): Prisma.TicketWhereInput {
    if (this.handles(user, kind)) return { kind };
    if (user.role === 'DSA') return { kind, OR: [{ createdById: user.id }, { dsaId: user.id }] };
    return { kind, createdById: user.id };
  }

  private async load(user: AuthUser, id: string) {
    const t = await this.prisma.ticket.findUnique({ where: { id } });
    if (!t) throw notFound('Ticket');
    const visible = await this.prisma.ticket.count({ where: { AND: [this.where(user, t.kind as TicketKind), { id }] } });
    if (!visible) throw notFound('Ticket');
    return t;
  }

  async list(user: AuthUser, q: { kind?: string; status?: string; mine?: string; caseId?: string; q?: string; page?: string }) {
    const kind = (q.kind === 'ASSISTANCE' ? 'ASSISTANCE' : 'QUERY') as TicketKind;
    const page = Math.max(1, Number(q.page) || 1);
    const pageSize = 20;
    const where: Prisma.TicketWhereInput = {
      AND: [
        this.where(user, kind),
        q.status ? { status: { in: q.status.split(',') as TicketStatus[] } } : {},
        q.mine === '1' ? { assignedToId: user.id } : {},
        q.caseId ? { caseId: q.caseId } : {},
        q.q ? { OR: [{ ticketNo: { contains: q.q, mode: 'insensitive' } }, { subject: { contains: q.q, mode: 'insensitive' } }, { loanCase: { caseNo: { contains: q.q, mode: 'insensitive' } } }] } : {},
      ],
    };
    const [items, total, counts] = await Promise.all([
      this.prisma.ticket.findMany({
        where,
        include: { loanCase: { select: { id: true, caseNo: true, customer: { select: { name: true } } } }, _count: { select: { messages: { where: this.handles(user, kind) ? {} : { internal: false } } } } },
        orderBy: [{ lastActivityAt: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.ticket.count({ where }),
      this.prisma.ticket.groupBy({ by: ['status'], where: this.where(user, kind), _count: true }),
    ]);
    const people = await this.people(items.flatMap((t) => [t.createdById, t.assignedToId]));
    const paged = new Paged(
      items.map((t) => ({ ...t, createdBy: people.get(t.createdById) ?? null, assignedTo: t.assignedToId ? people.get(t.assignedToId) ?? null : null, messageCount: t._count.messages, _count: undefined })),
      { page, pageSize, total },
    );
    (paged.meta as any).counts = Object.fromEntries(counts.map((c) => [c.status, c._count]));
    return paged;
  }

  async detail(user: AuthUser, id: string) {
    const t = await this.load(user, id);
    const staff = this.handles(user, t.kind as TicketKind);
    const [messages, loanCase] = await Promise.all([
      this.prisma.ticketMessage.findMany({
        where: { ticketId: id, ...(staff ? {} : { internal: false }) },
        include: { document: { select: { id: true, originalName: true, mime: true, sizeBytes: true } } },
        orderBy: { createdAt: 'asc' },
      }),
      t.caseId ? this.prisma.loanCase.findUnique({ where: { id: t.caseId }, select: { id: true, caseNo: true, status: true, customer: { select: { name: true } }, bank: { select: { name: true } } } }) : null,
    ]);
    const people = await this.people([t.createdById, t.assignedToId]);
    return {
      ...t,
      loanCase,
      createdBy: people.get(t.createdById) ?? null,
      assignedTo: t.assignedToId ? people.get(t.assignedToId) ?? null : null,
      messages,
      canHandle: staff,
      canReply: t.status !== 'CLOSED',
    };
  }

  async create(user: AuthUser, b: z.infer<typeof ticketCreateSchema>, meta: RequestMeta) {
    if (!can(user, CREATE[b.kind])) throw forbidden();
    let dsaId: string | null = user.role === 'DSA' ? user.id : user.role === 'TEAM_PARTNER' ? user.teamDsaUserId : null;
    if (b.caseId) {
      const c = await this.prisma.loanCase.findFirst({ where: { AND: [this.scope.caseWhere(user), { id: b.caseId }] }, select: { id: true, dsaId: true } });
      if (!c) throw notFound('Case');
      dsaId = c.dsaId;
    }
    const year = new Date().getFullYear();
    const t = await this.prisma.$transaction(async (tx) => {
      const counter = await tx.ticketCounter.upsert({ where: { kind_year: { kind: b.kind, year } }, create: { kind: b.kind, year, lastSeq: 1 }, update: { lastSeq: { increment: 1 } } });
      const ticket = await tx.ticket.create({
        data: {
          ticketNo: `${PREFIX[b.kind]}-${year}-${String(counter.lastSeq).padStart(6, '0')}`,
          kind: b.kind,
          category: b.category,
          caseId: b.caseId ?? null,
          subject: b.subject,
          priority: b.priority,
          createdById: user.id,
          createdRole: user.role,
          dsaId,
        },
      });
      await tx.ticketMessage.create({ data: { ticketId: ticket.id, authorId: user.id, authorName: user.name, authorRole: user.role, body: b.description } });
      await this.audit.log(tx, user, { action: `${b.kind}_RAISED`, entity: 'ticket', entityId: ticket.id, after: { ticketNo: ticket.ticketNo, category: b.category, caseId: b.caseId, priority: b.priority } }, meta);
      const staff = await this.staffFor(tx, b.kind);
      await this.notify.toUsers(tx, staff.filter((id) => id !== user.id), {
        title: `${b.kind === 'QUERY' ? 'New query' : 'Assistance needed'} ${ticket.ticketNo}: ${b.subject}`,
        body: `${user.name} · ${b.priority === 'URGENT' || b.priority === 'HIGH' ? `${b.priority} priority · ` : ''}${b.description.slice(0, 140)}`,
        caseId: b.caseId,
        priority: b.priority === 'URGENT' || b.priority === 'HIGH' ? 'HIGH' : 'NORMAL',
        sentById: user.id,
      });
      return ticket;
    });
    return t;
  }

  async reply(user: AuthUser, id: string, b: z.infer<typeof ticketReplySchema>, meta: RequestMeta, file?: { buffer: Buffer; originalname: string; size: number }) {
    const t = await this.load(user, id);
    const staff = this.handles(user, t.kind as TicketKind);
    if (t.status === 'CLOSED') throw new AppError('INVALID_TRANSITION', 'This ticket is closed. Raise a new one if you still need help.');
    if (b.internal && !staff) throw forbidden('Only Rupeemap staff can add internal notes');
    const stored = file ? await this.storage.save(file) : null;
    return this.prisma.$transaction(async (tx) => {
      const doc = stored ? await tx.document.create({ data: { ...stored, uploadedById: user.id } }) : null;
      const m = await tx.ticketMessage.create({
        data: { ticketId: id, authorId: user.id, authorName: user.name, authorRole: user.role, body: b.body, internal: b.internal, documentId: doc?.id ?? null },
      });
      // A staff reply puts the ball in the partner's court; a partner reply brings it back.
      let next = t.status as TicketStatus;
      if (!b.internal) {
        if (staff && user.id !== t.createdById) next = t.status === 'RESOLVED' ? 'RESOLVED' : 'WAITING';
        else if (!staff) next = t.status === 'OPEN' ? 'OPEN' : 'IN_PROGRESS';
      }
      await tx.ticket.update({ where: { id }, data: { status: next, lastActivityAt: new Date(), version: { increment: 1 }, ...(next !== t.status && next !== 'RESOLVED' ? { resolvedAt: null } : {}) } });
      await this.audit.log(tx, user, { action: b.internal ? 'TICKET_NOTE_ADDED' : 'TICKET_REPLIED', entity: 'ticket', entityId: id, after: { messageId: m.id, attachment: !!doc, status: next } }, meta);
      if (!b.internal) {
        const to = staff ? [t.createdById] : t.assignedToId ? [t.assignedToId] : await this.staffFor(tx, t.kind as TicketKind);
        await this.notify.toUsers(tx, to.filter((x) => x !== user.id), {
          title: `${staff ? 'Reply from Rupeemap' : `${user.name} replied`} on ${t.ticketNo}`,
          body: `${t.subject}: ${b.body.slice(0, 160)}`,
          caseId: t.caseId ?? undefined,
          sentById: user.id,
        });
      }
      return { id: m.id, status: next };
    });
  }

  /** Staff: assign, change status or priority. Every change also appears as a line in the conversation. */
  async update(user: AuthUser, id: string, b: z.infer<typeof ticketUpdateSchema>, meta: RequestMeta) {
    const t = await this.load(user, id);
    const staff = this.handles(user, t.kind as TicketKind);
    // A partner may only close their own resolved ticket.
    if (!staff && !(b.status === 'CLOSED' && t.createdById === user.id && t.status === 'RESOLVED' && !b.assignedToId && !b.priority)) throw forbidden();
    if (t.version !== b.version) throw conflict();
    if (t.status === 'CLOSED' && b.status !== 'OPEN') throw new AppError('INVALID_TRANSITION', 'Reopen the ticket before changing it');
    let assignee: { id: string; name: string } | null = null;
    if (b.assignedToId) {
      assignee = await this.prisma.user.findFirst({ where: { id: b.assignedToId, role: { in: ['ADMIN', 'EXECUTIVE'] }, status: 'ACTIVE', deletedAt: null }, select: { id: true, name: true } });
      if (!assignee) throw new AppError('VALIDATION_ERROR', 'Assign to an active Admin or Executive', { fields: { assignedToId: 'Invalid' } });
    }
    const status: TicketStatus = b.status ?? (assignee && t.status === 'OPEN' ? 'ASSIGNED' : (t.status as TicketStatus));
    return this.prisma.$transaction(async (tx) => {
      const u = await tx.ticket.update({
        where: { id },
        data: {
          status,
          priority: b.priority ?? undefined,
          assignedToId: assignee?.id ?? undefined,
          version: { increment: 1 },
          lastActivityAt: new Date(),
          resolvedAt: status === 'RESOLVED' ? new Date() : status !== t.status ? null : undefined,
          closedAt: status === 'CLOSED' ? new Date() : status !== t.status ? null : undefined,
        },
      });
      const parts = [
        assignee && assignee.id !== t.assignedToId ? `assigned to ${assignee.name}` : null,
        status !== t.status ? `marked ${TICKET_STATUS_LABELS[status]}` : null,
        b.priority && b.priority !== t.priority ? `priority ${b.priority.toLowerCase()}` : null,
      ].filter(Boolean);
      if (parts.length || b.note) {
        await tx.ticketMessage.create({
          data: { ticketId: id, authorId: user.id, authorName: user.name, authorRole: user.role, body: [parts.join(', '), b.note].filter(Boolean).join('. '), event: 'UPDATE' },
        });
      }
      await this.audit.log(tx, user, { action: 'TICKET_UPDATED', entity: 'ticket', entityId: id, before: { status: t.status, assignedToId: t.assignedToId, priority: t.priority }, after: { status, assignedToId: u.assignedToId, priority: u.priority, note: b.note } }, meta);
      const notifyIds = [
        ...(status !== t.status && (status === 'RESOLVED' || status === 'CLOSED') && t.createdById !== user.id ? [t.createdById] : []),
        ...(assignee && assignee.id !== user.id && assignee.id !== t.assignedToId ? [assignee.id] : []),
      ];
      for (const uid of notifyIds) {
        await this.notify.toUsers(tx, [uid], {
          title: uid === assignee?.id ? `${t.ticketNo} assigned to you` : `${t.ticketNo} ${TICKET_STATUS_LABELS[status].toLowerCase()}`,
          body: `${t.subject}${b.note ? `: ${b.note}` : ''}`,
          caseId: t.caseId ?? undefined,
          sentById: user.id,
        });
      }
      return { id, status: u.status, version: u.version, assignedToId: u.assignedToId };
    });
  }

  async attachment(user: AuthUser, messageId: string, meta: RequestMeta) {
    const m = await this.prisma.ticketMessage.findUnique({ where: { id: messageId }, include: { document: true } });
    if (!m?.document) throw notFound('Attachment');
    const t = await this.load(user, m.ticketId);
    if (m.internal && !this.handles(user, t.kind as TicketKind)) throw notFound('Attachment');
    const body = await this.storage.read(m.document.storageKey);
    await this.prisma.documentAccessLog.create({ data: { documentId: m.document.id, userId: user.id, ip: meta.ip } });
    return { body, mime: m.document.mime, name: m.document.originalName };
  }

  /** Open tickets for dashboards: staff see what needs handling, partners what waits on them. */
  async counts(user: AuthUser) {
    const out: Record<TicketKind, { open: number; waiting: number }> = { QUERY: { open: 0, waiting: 0 }, ASSISTANCE: { open: 0, waiting: 0 } };
    for (const kind of ['QUERY', 'ASSISTANCE'] as TicketKind[]) {
      const rows = await this.prisma.ticket.groupBy({ by: ['status'], where: this.where(user, kind), _count: true });
      for (const r of rows) {
        if (['OPEN', 'ASSIGNED', 'IN_PROGRESS'].includes(r.status)) out[kind].open += r._count;
        if (r.status === 'WAITING') out[kind].waiting += r._count;
      }
    }
    return out;
  }

  private async staffFor(tx: Tx, kind: TicketKind) {
    const staff = await tx.user.findMany({ where: { role: { in: ['ADMIN', 'EXECUTIVE'] }, status: 'ACTIVE', deletedAt: null }, include: { permissions: true } });
    return staff.filter((s) => effectivePermissions(s.role as Role, s.permissions).includes(HANDLE[kind])).map((s) => s.id);
  }

  private async people(ids: (string | null)[]) {
    const uniq = [...new Set(ids.filter((x): x is string => !!x))];
    const users = uniq.length ? await this.prisma.user.findMany({ where: { id: { in: uniq } }, select: { id: true, name: true, role: true, mobile: true } }) : [];
    return new Map(users.map((u) => [u.id, u]));
  }
}
