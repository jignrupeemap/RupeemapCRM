import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { z } from 'zod';
import { PrismaService } from '../common/prisma.service';
import { AuditService } from '../common/audit.service';
import { MAX_UPLOAD_BYTES, StorageService } from '../common/storage.service';
import { contentDisposition } from '../common/http-safety';
import { parse } from '../common/validate';
import { AppError, forbidden, notFound } from '../common/errors';
import { can, CurrentUser, Meta, RequirePermission, type AuthUser, type RequestMeta } from '../common/auth-context';

const blank = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? undefined : v);
const uploadSchema = z.object({ note: z.preprocess(blank, z.string().trim().max(300).optional()) });
const deleteSchema = z.object({ reason: z.string().trim().min(3, 'Enter why it is being removed').max(300) });

type File = { buffer: Buffer; originalname: string; size: number };
const isStaff = (u: AuthUser) => u.role === 'ADMIN' || u.role === 'EXECUTIVE';

/**
 * Banker confirmation mail kept against a payout (taken when staff mark it Confirmed).
 * Admin and Admin Executives add and view; only Admin can remove (soft delete, with a reason).
 * Partners never see these.
 */
@Controller('payouts')
export class PayoutAttachmentsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly storage: StorageService,
  ) {}

  private assertStaff(user: AuthUser) {
    if (!isStaff(user) || !can(user, 'PAYOUT_VIEW')) throw forbidden();
  }

  @Get(':id/attachments')
  async list(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    this.assertStaff(user);
    const rows = await this.prisma.payoutAttachment.findMany({
      where: { payoutId: id, deletedAt: null },
      include: { document: { select: { originalName: true, mime: true, sizeBytes: true } } },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((r) => ({
      id: r.id,
      name: r.document.originalName,
      mime: r.document.mime,
      sizeBytes: r.document.sizeBytes,
      note: r.note,
      uploadedByName: r.uploadedByName,
      createdAt: r.createdAt,
      url: `/api/v1/payouts/attachments/${r.id}/file`,
      canDelete: user.role === 'ADMIN',
    }));
  }

  @Post(':id/attachments')
  @RequirePermission('PAYOUT_UPDATE')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 } }))
  async add(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown, @Meta() meta: RequestMeta, @UploadedFile() file?: File) {
    this.assertStaff(user);
    if (!file) throw new AppError('VALIDATION_ERROR', 'Choose the banker confirmation (PDF, JPG or PNG)', { fields: { file: 'Required' } });
    const b = parse(uploadSchema, body);
    const payout = await this.prisma.payout.findFirst({ where: { id, loanCase: { deletedAt: null } }, select: { id: true, caseId: true, status: true } });
    if (!payout) throw notFound('Payout');
    const stored = await this.storage.save(file);
    return this.prisma.$transaction(async (tx) => {
      const doc = await tx.document.create({ data: { ...stored, uploadedById: user.id } });
      const a = await tx.payoutAttachment.create({ data: { payoutId: id, documentId: doc.id, note: b.note ?? null, uploadedById: user.id, uploadedByName: user.name } });
      await this.audit.log(tx, user, { action: 'PAYOUT_ATTACHMENT_ADDED', entity: 'case', entityId: payout.caseId, after: { payoutId: id, attachmentId: a.id, file: stored.originalName, payoutStatus: payout.status, note: b.note } }, meta);
      return { id: a.id, name: stored.originalName };
    });
  }

  @Get('attachments/:attId/file')
  async file(@CurrentUser() user: AuthUser, @Param('attId', ParseUUIDPipe) attId: string, @Meta() meta: RequestMeta, @Res() res: Response) {
    this.assertStaff(user);
    const a = await this.prisma.payoutAttachment.findFirst({ where: { id: attId, deletedAt: null }, include: { document: true } });
    if (!a) throw notFound('Attachment');
    const body = await this.storage.read(a.document.storageKey);
    await this.prisma.documentAccessLog.create({ data: { documentId: a.documentId, userId: user.id, ip: meta.ip } });
    res.set({
      'Content-Type': a.document.mime,
      'Content-Length': String(body.length),
      'Content-Disposition': contentDisposition('inline', a.document.originalName),
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    res.end(body);
  }

  /** Only Admin. Kept in the database (soft delete) with who removed it and why. */
  @Post('attachments/:attId/remove')
  async remove(@CurrentUser() user: AuthUser, @Param('attId', ParseUUIDPipe) attId: string, @Body() body: unknown, @Meta() meta: RequestMeta) {
    if (user.role !== 'ADMIN') throw forbidden('Only Admin can remove a banker confirmation');
    const { reason } = parse(deleteSchema, body);
    const a = await this.prisma.payoutAttachment.findFirst({ where: { id: attId, deletedAt: null }, include: { payout: { select: { caseId: true } }, document: { select: { originalName: true } } } });
    if (!a) throw notFound('Attachment');
    await this.prisma.$transaction(async (tx) => {
      await tx.payoutAttachment.update({ where: { id: attId }, data: { deletedAt: new Date(), deletedById: user.id, deleteReason: reason } });
      await this.audit.log(tx, user, { action: 'PAYOUT_ATTACHMENT_REMOVED', entity: 'case', entityId: a.payout.caseId, before: { payoutId: a.payoutId, attachmentId: attId, file: a.document.originalName }, after: { reason } }, meta);
    });
    return null;
  }
}
