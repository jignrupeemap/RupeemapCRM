import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { ChecklistItemStatus, ChecklistTemplateInput } from '@rupeemap/shared';
import { PrismaService } from '../common/prisma.service';
import { AuditService } from '../common/audit.service';
import { ScopeService } from '../common/scope.service';
import { AppError, forbidden, notFound } from '../common/errors';
import { can, type AuthUser, type RequestMeta } from '../common/auth-context';

export interface ResolvedItem {
  itemId: string;
  name: string;
  required: boolean;
  hint: string | null;
  source: string;
}

const TEMPLATE_INCLUDE = {
  items: { where: { active: true }, orderBy: { sortOrder: 'asc' } },
} satisfies Prisma.ChecklistTemplateInclude;

/**
 * Configurable document checklists (PART 40). A template applies to a case
 * when each of its bank / loan type / project is blank or matches the case.
 */
@Injectable()
export class ChecklistsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly scope: ScopeService,
  ) {}

  async list(user: AuthUser, q: { includeInactive?: string; bankId?: string; loanType?: string }) {
    const manage = can(user, 'CHECKLIST_MANAGE');
    const templates = await this.prisma.checklistTemplate.findMany({
      where: {
        deletedAt: null,
        ...(manage && q.includeInactive === '1' ? {} : { active: true }),
        ...(q.bankId ? { OR: [{ bankId: q.bankId }, { bankId: null }] } : {}),
        ...(q.loanType ? { AND: [{ OR: [{ loanType: q.loanType }, { loanType: null }] }] } : {}),
      },
      include: manage ? { items: { orderBy: { sortOrder: 'asc' } } } : TEMPLATE_INCLUDE,
      orderBy: [{ bankId: 'asc' }, { loanType: 'asc' }, { name: 'asc' }],
      take: 200,
    });
    const [banks, projects] = await Promise.all([
      this.prisma.bank.findMany({ where: { id: { in: templates.map((t) => t.bankId).filter((x): x is string => !!x) } }, select: { id: true, name: true } }),
      this.prisma.project.findMany({ where: { id: { in: templates.map((t) => t.projectId).filter((x): x is string => !!x) } }, select: { id: true, name: true } }),
    ]);
    return templates.map((t) => ({
      ...t,
      bankName: banks.find((b) => b.id === t.bankId)?.name ?? null,
      projectName: projects.find((p) => p.id === t.projectId)?.name ?? null,
    }));
  }

  /** The combined document list for a bank + loan type (+ project). Same document name appears once. */
  async resolve(filter: { bankId: string; loanType: string; projectId?: string | null }): Promise<ResolvedItem[]> {
    const templates = await this.prisma.checklistTemplate.findMany({
      where: {
        deletedAt: null,
        active: true,
        AND: [
          { OR: [{ bankId: null }, { bankId: filter.bankId }] },
          { OR: [{ loanType: null }, { loanType: filter.loanType }] },
          { OR: [{ projectId: null }, ...(filter.projectId ? [{ projectId: filter.projectId }] : [])] },
        ],
      },
      include: TEMPLATE_INCLUDE,
      // General templates first, then more specific ones.
      orderBy: [{ createdAt: 'asc' }],
    });
    const specificity = (t: { bankId: string | null; loanType: string | null; projectId: string | null }) => (t.bankId ? 1 : 0) + (t.loanType ? 1 : 0) + (t.projectId ? 1 : 0);
    templates.sort((a, b) => specificity(a) - specificity(b));
    const byName = new Map<string, ResolvedItem>();
    for (const t of templates) {
      for (const i of t.items) {
        const key = i.name.trim().toLowerCase();
        const prev = byName.get(key);
        if (prev) {
          prev.required = prev.required || i.required;
          continue;
        }
        byName.set(key, { itemId: i.id, name: i.name, required: i.required, hint: i.hint, source: t.name });
      }
    }
    return [...byName.values()];
  }

  async create(user: AuthUser, input: ChecklistTemplateInput, meta: RequestMeta) {
    await this.assertRefs(input);
    return this.prisma.$transaction(async (tx) => {
      const t = await tx.checklistTemplate.create({
        data: {
          name: input.name,
          bankId: input.bankId ?? null,
          loanType: input.loanType ?? null,
          projectId: input.projectId ?? null,
          product: input.product ?? null,
          active: input.active,
          createdById: user.id,
          items: { create: input.items.map((i, n) => ({ name: i.name, required: i.required, hint: i.hint ?? null, active: i.active, sortOrder: n })) },
        },
        include: { items: true },
      });
      await this.audit.log(tx, user, { action: 'CHECKLIST_CREATED', entity: 'checklist', entityId: t.id, after: t }, meta);
      return t;
    });
  }

  /** Items are updated in place and removed ones deactivated, so case progress is never lost. */
  async update(user: AuthUser, id: string, input: ChecklistTemplateInput, meta: RequestMeta) {
    const before = await this.prisma.checklistTemplate.findFirst({ where: { id, deletedAt: null }, include: { items: true } });
    if (!before) throw notFound('Checklist');
    await this.assertRefs(input);
    return this.prisma.$transaction(async (tx) => {
      await tx.checklistTemplate.update({
        where: { id },
        data: { name: input.name, bankId: input.bankId ?? null, loanType: input.loanType ?? null, projectId: input.projectId ?? null, product: input.product ?? null, active: input.active },
      });
      const keep = new Set<string>();
      for (const [n, i] of input.items.entries()) {
        const existing = i.id ? before.items.find((x) => x.id === i.id) : undefined;
        if (existing) {
          keep.add(existing.id);
          await tx.checklistTemplateItem.update({ where: { id: existing.id }, data: { name: i.name, required: i.required, hint: i.hint ?? null, active: i.active, sortOrder: n } });
        } else {
          await tx.checklistTemplateItem.create({ data: { templateId: id, name: i.name, required: i.required, hint: i.hint ?? null, active: i.active, sortOrder: n } });
        }
      }
      const removed = before.items.filter((x) => !keep.has(x.id)).map((x) => x.id);
      if (removed.length) await tx.checklistTemplateItem.updateMany({ where: { id: { in: removed } }, data: { active: false } });
      const after = await tx.checklistTemplate.findUniqueOrThrow({ where: { id }, include: { items: { orderBy: { sortOrder: 'asc' } } } });
      await this.audit.log(tx, user, { action: 'CHECKLIST_UPDATED', entity: 'checklist', entityId: id, before, after }, meta);
      return after;
    });
  }

  async remove(user: AuthUser, id: string, meta: RequestMeta) {
    const before = await this.prisma.checklistTemplate.findFirst({ where: { id, deletedAt: null } });
    if (!before) throw notFound('Checklist');
    await this.prisma.$transaction(async (tx) => {
      await tx.checklistTemplate.update({ where: { id }, data: { deletedAt: new Date(), active: false } });
      await this.audit.log(tx, user, { action: 'CHECKLIST_DELETED', entity: 'checklist', entityId: id, before }, meta);
    });
    return null;
  }

  private async assertRefs(input: ChecklistTemplateInput) {
    if (input.bankId && !(await this.prisma.bank.findUnique({ where: { id: input.bankId } }))) throw new AppError('VALIDATION_ERROR', 'Selected bank does not exist');
    if (input.projectId && !(await this.prisma.project.findFirst({ where: { id: input.projectId, deletedAt: null } })))
      throw new AppError('VALIDATION_ERROR', 'Selected project does not exist');
    const names = input.items.map((i) => i.name.trim().toLowerCase());
    if (new Set(names).size !== names.length) throw new AppError('VALIDATION_ERROR', 'The same document is listed twice');
  }

  private async scopedCase(user: AuthUser, caseId: string) {
    const c = await this.prisma.loanCase.findFirst({ where: { AND: [this.scope.caseWhere(user), { id: caseId }] } });
    if (!c) throw notFound('Case');
    return c;
  }

  /** The case's checklist with progress. */
  async forCase(user: AuthUser, caseId: string) {
    const c = await this.scopedCase(user, caseId);
    const items = await this.resolve({ bankId: c.bankId, loanType: c.loanType, projectId: c.projectId });
    const progress = await this.prisma.caseChecklistItem.findMany({ where: { caseId } });
    const rows = items.map((i) => {
      const p = progress.find((x) => x.templateItemId === i.itemId);
      return { ...i, status: (p?.status ?? 'PENDING') as ChecklistItemStatus, remarks: p?.remarks ?? null, updatedByName: p?.updatedByName ?? null, updatedAt: p?.updatedAt ?? null };
    });
    const required = rows.filter((r) => r.required);
    const done = (r: (typeof rows)[number]) => r.status !== 'PENDING';
    return {
      items: rows,
      progress: {
        total: rows.length,
        done: rows.filter(done).length,
        required: required.length,
        requiredDone: required.filter(done).length,
      },
      canUpdate: can(user, 'CASE_UPDATE') && !['REJECT', 'WITHDRAW'].includes(c.status),
    };
  }

  async updateCaseItem(user: AuthUser, caseId: string, itemId: string, body: { status: ChecklistItemStatus; remarks?: string }, meta: RequestMeta) {
    if (!can(user, 'CASE_UPDATE')) throw forbidden();
    const c = await this.scopedCase(user, caseId);
    if (c.status === 'REJECT' || c.status === 'WITHDRAW') throw new AppError('INVALID_TRANSITION', 'This case is closed. Reopen it to update the checklist.');
    const applicable = await this.resolve({ bankId: c.bankId, loanType: c.loanType, projectId: c.projectId });
    if (!applicable.some((i) => i.itemId === itemId)) throw notFound('Checklist item');
    return this.prisma.$transaction(async (tx) => {
      const before = await tx.caseChecklistItem.findUnique({ where: { caseId_templateItemId: { caseId, templateItemId: itemId } } });
      const row = await tx.caseChecklistItem.upsert({
        where: { caseId_templateItemId: { caseId, templateItemId: itemId } },
        create: { caseId, templateItemId: itemId, status: body.status, remarks: body.remarks ?? null, updatedById: user.id, updatedByName: user.name },
        update: { status: body.status, remarks: body.remarks ?? null, updatedById: user.id, updatedByName: user.name },
      });
      await this.audit.log(tx, user, { action: 'CASE_CHECKLIST_UPDATED', entity: 'case', entityId: caseId, before: before && { item: itemId, status: before.status }, after: { item: itemId, status: row.status, remarks: row.remarks } }, meta);
      return row;
    });
  }
}
