import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import { normalizeName, projectSchema } from '@rupeemap/shared';
import { PrismaService } from '../common/prisma.service';
import { AuditService } from '../common/audit.service';
import { RedisService } from '../common/redis.service';
import { parse } from '../common/validate';
import { AppError, notFound } from '../common/errors';
import { can, CurrentUser, Meta, RequirePermission, type AuthUser, type RequestMeta } from '../common/auth-context';
import { Paged } from '../common/http';

const bankSchema = z.object({ name: z.string().trim().min(2).max(120), shortName: z.string().trim().max(30).optional(), isNbfc: z.boolean().default(false) });
const MASTER_TTL = 3600;

@Controller()
export class MastersController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly redis: RedisService,
  ) {}

  private async cached<T>(key: string, load: () => Promise<T>): Promise<T> {
    const hit = await this.redis.getJson<T>(key);
    if (hit) return hit;
    const v = await load();
    await this.redis.setJson(key, v, MASTER_TTL);
    return v;
  }

  @Get('loan-types')
  loanTypes() {
    return this.cached('m:loan-types', () => this.prisma.loanType.findMany({ where: { active: true }, orderBy: { sortOrder: 'asc' } }));
  }

  @Get('banks')
  @RequirePermission('BANK_VIEW')
  banks() {
    return this.cached('m:banks', () => this.prisma.bank.findMany({ where: { active: true }, orderBy: { name: 'asc' }, select: { id: true, name: true, shortName: true, isNbfc: true } }));
  }

  @Post('banks')
  @RequirePermission('BANK_MANAGE')
  async createBank(@CurrentUser() user: AuthUser, @Body() body: unknown, @Meta() meta: RequestMeta) {
    const b = parse(bankSchema, body);
    const bank = await this.prisma.$transaction(async (tx) => {
      const created = await tx.bank.create({ data: b });
      await this.audit.log(tx, user, { action: 'BANK_CREATED', entity: 'bank', entityId: created.id, after: created }, meta);
      return created;
    });
    await this.redis.client.del('m:banks');
    return bank;
  }

  @Get('projects')
  @RequirePermission('PROJECT_VIEW')
  async projects(@CurrentUser() user: AuthUser, @Query() q: Record<string, string>) {
    const page = Math.max(1, Number(q.page) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(q.pageSize) || 50));
    const where = {
      deletedAt: null,
      ...(can(user, 'PROJECT_MANAGE') && q.includeInactive === '1' ? {} : { active: true }),
      ...(q.q
        ? { OR: [{ name: { contains: q.q, mode: 'insensitive' as const } }, { city: { contains: q.q, mode: 'insensitive' as const } }, { locality: { contains: q.q, mode: 'insensitive' as const } }, { reraNumber: { contains: q.q, mode: 'insensitive' as const } }] }
        : {}),
      ...(q.city ? { city: q.city } : {}),
      ...(q.projectType ? { projectType: q.projectType as any } : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.project.findMany({ where, orderBy: { name: 'asc' }, skip: (page - 1) * pageSize, take: pageSize }),
      this.prisma.project.count({ where }),
    ]);
    return new Paged(items, { page, pageSize, total });
  }

  @Post('projects')
  @RequirePermission('PROJECT_MANAGE')
  async createProject(@CurrentUser() user: AuthUser, @Body() body: unknown, @Meta() meta: RequestMeta) {
    const p = parse(projectSchema, body);
    await this.assertUniqueProject(p.name, p.reraNumber);
    return this.prisma.$transaction(async (tx) => {
      const created = await tx.project.create({ data: { ...p, nameNormalized: normalizeName(p.name), createdById: user.id } });
      await this.audit.log(tx, user, { action: 'PROJECT_CREATED', entity: 'project', entityId: created.id, after: created }, meta);
      return created;
    });
  }

  @Patch('projects/:id')
  @RequirePermission('PROJECT_MANAGE')
  async updateProject(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown, @Meta() meta: RequestMeta) {
    const p = parse(projectSchema, body);
    const before = await this.prisma.project.findFirst({ where: { id, deletedAt: null } });
    if (!before) throw notFound('Project');
    await this.assertUniqueProject(p.name, p.reraNumber, id);
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.project.update({ where: { id }, data: { ...p, reraNumber: p.reraNumber ?? null, nameNormalized: normalizeName(p.name) } });
      await this.audit.log(tx, user, { action: 'PROJECT_UPDATED', entity: 'project', entityId: id, before, after: updated }, meta);
      return updated;
    });
  }

  @Delete('projects/:id')
  @RequirePermission('PROJECT_DELETE')
  async deleteProject(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Meta() meta: RequestMeta) {
    const before = await this.prisma.project.findFirst({ where: { id, deletedAt: null } });
    if (!before) throw notFound('Project');
    return this.prisma.$transaction(async (tx) => {
      // Soft delete; free the unique name so it can be re-added later.
      await tx.project.update({ where: { id }, data: { deletedAt: new Date(), active: false, nameNormalized: `${before.nameNormalized}#deleted#${id}`, reraNumber: null } });
      await this.audit.log(tx, user, { action: 'PROJECT_DELETED', entity: 'project', entityId: id, before }, meta);
      return null;
    });
  }

  private async assertUniqueProject(name: string, rera?: string, exceptId?: string) {
    const dup = await this.prisma.project.findFirst({
      where: { deletedAt: null, NOT: exceptId ? { id: exceptId } : undefined, OR: [{ nameNormalized: normalizeName(name) }, ...(rera ? [{ reraNumber: rera }] : [])] },
    });
    if (dup) {
      const field = dup.nameNormalized === normalizeName(name) ? 'name' : 'reraNumber';
      throw new AppError('CONFLICT', `Project "${dup.name}" already exists${field === 'reraNumber' ? ' with this RERA number' : ''}`, { fields: { [field]: 'Already exists' } });
    }
  }

}
