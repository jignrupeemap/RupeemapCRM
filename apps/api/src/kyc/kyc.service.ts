import { Injectable } from '@nestjs/common';
import { KYC_DOC_LABELS, requiredKycDocs, type KycDocType, type KycStatus } from '@rupeemap/shared';
import { PrismaService } from '../common/prisma.service';
import { AuditService } from '../common/audit.service';
import { NotifyService } from '../common/notify.service';
import { StorageService } from '../common/storage.service';
import { AppError, forbidden, notFound } from '../common/errors';
import { can, type AuthUser, type RequestMeta } from '../common/auth-context';

const isStaff = (u: AuthUser) => u.role === 'ADMIN' || u.role === 'EXECUTIVE';

/** Staff with KYC_UPLOAD can manage anyone's KYC; a DSA or Team Partner can manage only their own. */
const canManage = (u: AuthUser, userId: string) =>
  (isStaff(u) && can(u, 'KYC_UPLOAD')) || ((u.role === 'DSA' || u.role === 'TEAM_PARTNER') && u.id === userId);

/** Statuses in which documents can still be added or replaced. */
const EDITABLE: KycStatus[] = ['DOCUMENTS_PENDING', 'UPLOADED', 'REJECTED', 'RESUBMISSION_REQUIRED'];

/**
 * First payout KYC (PART 38, 75): Executives upload PAN, Aadhaar, cancelled
 * cheque, photo and GST certificate (when applicable), submit for verification,
 * and Admin is the final verifier.
 */
@Injectable()
export class KycService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notify: NotifyService,
    private readonly storage: StorageService,
  ) {}

  private assertCanView(actor: AuthUser, userId: string) {
    if (!can(actor, 'KYC_VIEW')) throw forbidden();
    if (!isStaff(actor) && actor.id !== userId) throw forbidden();
  }

  /** Staff queue: partners and their KYC state, most urgent first. */
  async queue(actor: AuthUser, q: { status?: string; q?: string }) {
    if (!isStaff(actor) || !can(actor, 'KYC_VIEW')) throw forbidden();
    const profiles = await this.prisma.kycProfile.findMany({
      where: {
        user: {
          deletedAt: null,
          role: { in: ['DSA', 'TEAM_PARTNER'] },
          ...(q.q ? { OR: [{ name: { contains: q.q, mode: 'insensitive' } }, { mobile: { contains: q.q } }] } : {}),
        },
        ...(q.status ? { status: { in: q.status.split(',') as KycStatus[] } } : {}),
      },
      include: {
        user: { select: { id: true, name: true, mobile: true, role: true, status: true, dsaProfile: { select: { code: true } } } },
        documents: { where: { current: true }, select: { type: true } },
      },
      orderBy: { updatedAt: 'desc' },
      take: 300,
    });
    // Partners with a payout waiting on KYC go to the top.
    const waiting = await this.prisma.payout.groupBy({
      by: ['beneficiaryId'],
      where: { beneficiaryId: { in: profiles.map((p) => p.userId) }, status: { in: ['PENDING', 'CONFIRMED', 'HOLD'] } },
      _count: true,
      _sum: { amount: true },
    });
    const order: KycStatus[] = ['UNDER_ADMIN_VERIFICATION', 'UPLOADED', 'RESUBMISSION_REQUIRED', 'REJECTED', 'DOCUMENTS_PENDING', 'APPROVED'];
    return profiles
      .map((p) => {
        const required = requiredKycDocs(p.gstApplicable);
        const have = new Set(p.documents.map((d) => d.type));
        const w = waiting.find((x) => x.beneficiaryId === p.userId);
        return {
          userId: p.userId,
          name: p.user.name,
          mobile: p.user.mobile,
          role: p.user.role,
          dsaCode: p.user.dsaProfile?.code ?? null,
          status: p.status,
          gstApplicable: p.gstApplicable,
          uploaded: required.filter((t) => have.has(t)).length,
          required: required.length,
          pendingPayouts: w?._count ?? 0,
          pendingPayoutAmount: Number(w?._sum.amount ?? 0),
          updatedAt: p.updatedAt,
        };
      })
      .sort((a, b) => b.pendingPayouts - a.pendingPayouts || order.indexOf(a.status as KycStatus) - order.indexOf(b.status as KycStatus));
  }

  async detail(actor: AuthUser, userId: string) {
    this.assertCanView(actor, userId);
    const p = await this.prisma.kycProfile.findUnique({
      where: { userId },
      include: {
        user: { select: { id: true, name: true, mobile: true, role: true, status: true } },
        documents: { orderBy: [{ type: 'asc' }, { version: 'desc' }], include: { document: { select: { id: true, originalName: true, mime: true, sizeBytes: true, createdAt: true } } } },
      },
    });
    if (!p) throw notFound('KYC profile');
    const verifier = p.verifiedById ? await this.prisma.user.findUnique({ where: { id: p.verifiedById }, select: { name: true } }) : null;
    const required = requiredKycDocs(p.gstApplicable);
    const current = p.documents.filter((d) => d.current);
    return {
      userId: p.userId,
      user: p.user,
      status: p.status,
      gstApplicable: p.gstApplicable,
      rejectionReason: p.rejectionReason,
      submittedAt: p.submittedAt,
      verifiedAt: p.verifiedAt,
      verifiedBy: verifier?.name ?? null,
      required,
      missing: required.filter((t) => !current.some((d) => d.type === t)),
      documents: p.documents.map((d) => ({
        id: d.id,
        type: d.type,
        version: d.version,
        current: d.current,
        uploadedByName: d.uploadedByName,
        createdAt: d.createdAt,
        file: d.document,
      })),
      canUpload: canManage(actor, userId) && EDITABLE.includes(p.status as KycStatus),
      isSelf: actor.id === userId,
      canVerify: can(actor, 'KYC_VERIFY') && p.status === 'UNDER_ADMIN_VERIFICATION',
    };
  }

  async upload(actor: AuthUser, userId: string, type: KycDocType, file: { buffer: Buffer; originalname: string; size: number }, meta: RequestMeta) {
    if (!canManage(actor, userId)) throw forbidden();
    const p = await this.prisma.kycProfile.findUnique({ where: { userId } });
    if (!p) throw notFound('KYC profile');
    if (!EDITABLE.includes(p.status as KycStatus)) {
      throw new AppError('INVALID_TRANSITION', p.status === 'APPROVED' ? 'KYC is already approved.' : 'KYC is with Admin for verification. Wait for the decision before changing documents.');
    }
    if (type === 'GST_CERTIFICATE' && !p.gstApplicable) throw new AppError('VALIDATION_ERROR', 'Mark the partner as GST registered before uploading a GST certificate');
    const stored = await this.storage.save(file);
    return this.prisma.$transaction(async (tx) => {
      const last = await tx.kycDocument.findFirst({ where: { kycProfileId: p.id, type }, orderBy: { version: 'desc' } });
      await tx.kycDocument.updateMany({ where: { kycProfileId: p.id, type, current: true }, data: { current: false } });
      const doc = await tx.document.create({ data: { ...stored, uploadedById: actor.id } });
      const k = await tx.kycDocument.create({
        data: { kycProfileId: p.id, type, version: (last?.version ?? 0) + 1, documentId: doc.id, uploadedById: actor.id, uploadedByName: actor.name },
      });
      const current = await tx.kycDocument.findMany({ where: { kycProfileId: p.id, current: true }, select: { type: true } });
      const complete = requiredKycDocs(p.gstApplicable).every((t) => current.some((c) => c.type === t));
      const status: KycStatus = complete ? 'UPLOADED' : p.status === 'UPLOADED' ? 'DOCUMENTS_PENDING' : (p.status as KycStatus);
      if (status !== p.status) await tx.kycProfile.update({ where: { id: p.id }, data: { status } });
      await this.audit.log(
        tx,
        actor,
        { action: 'KYC_DOCUMENT_UPLOADED', entity: 'kyc', entityId: p.id, after: { userId, type, version: k.version, sha256: stored.sha256, size: stored.sizeBytes, status } },
        meta,
      );
      return { id: k.id, type, version: k.version, status };
    });
  }

  async setGst(actor: AuthUser, userId: string, gstApplicable: boolean, meta: RequestMeta) {
    if (!canManage(actor, userId)) throw forbidden();
    const p = await this.prisma.kycProfile.findUnique({ where: { userId }, include: { documents: { where: { current: true }, select: { type: true } } } });
    if (!p) throw notFound('KYC profile');
    if (!EDITABLE.includes(p.status as KycStatus)) throw new AppError('INVALID_TRANSITION', 'GST can only be changed while documents are being collected');
    const complete = requiredKycDocs(gstApplicable).every((t) => p.documents.some((d) => d.type === t));
    const status: KycStatus = complete ? 'UPLOADED' : p.status === 'UPLOADED' ? 'DOCUMENTS_PENDING' : (p.status as KycStatus);
    return this.prisma.$transaction(async (tx) => {
      await tx.kycProfile.update({ where: { id: p.id }, data: { gstApplicable, status } });
      await tx.dsaPartner.updateMany({ where: { userId }, data: { gstApplicable } });
      await this.audit.log(tx, actor, { action: 'KYC_GST_CHANGED', entity: 'kyc', entityId: p.id, before: { gstApplicable: p.gstApplicable }, after: { gstApplicable, status } }, meta);
      return { gstApplicable, status };
    });
  }

  /** Executive sends a complete set to Admin. */
  async submit(actor: AuthUser, userId: string, meta: RequestMeta) {
    if (!canManage(actor, userId)) throw forbidden();
    const p = await this.prisma.kycProfile.findUnique({ where: { userId }, include: { user: true, documents: { where: { current: true }, select: { type: true } } } });
    if (!p) throw notFound('KYC profile');
    const missing = requiredKycDocs(p.gstApplicable).filter((t) => !p.documents.some((d) => d.type === t));
    if (missing.length) throw new AppError('VALIDATION_ERROR', `Upload ${missing.map((t) => KYC_DOC_LABELS[t]).join(', ')} first`);
    if (p.status !== 'UPLOADED') throw new AppError('INVALID_TRANSITION', 'Only a complete, uploaded KYC can be sent for verification');
    const staff = await this.prisma.user.findMany({ where: { role: { in: ['ADMIN', 'EXECUTIVE'] }, status: 'ACTIVE', deletedAt: null }, select: { id: true } });
    return this.prisma.$transaction(async (tx) => {
      await tx.kycProfile.update({ where: { id: p.id }, data: { status: 'UNDER_ADMIN_VERIFICATION', submittedAt: new Date(), rejectionReason: null } });
      await this.audit.log(tx, actor, { action: 'KYC_SUBMITTED', entity: 'kyc', entityId: p.id, before: { status: p.status }, after: { status: 'UNDER_ADMIN_VERIFICATION' } }, meta);
      await this.notify.toUsers(tx, staff.map((a) => a.id), {
        title: `KYC ready to verify: ${p.user.name}`,
        body: `${actor.id === userId ? `${actor.name} uploaded their own` : `${actor.name} uploaded all`} first payout KYC documents. Admin can approve or send back from First Payout KYC.`,
        priority: 'HIGH',
        sentById: actor.id,
      });
      return { status: 'UNDER_ADMIN_VERIFICATION' as const };
    });
  }

  /** Returns the decrypted file after an access check, and logs who opened it. */
  async open(actor: AuthUser, kycDocumentId: string, meta: RequestMeta) {
    const k = await this.prisma.kycDocument.findUnique({ where: { id: kycDocumentId }, include: { profile: true, document: true } });
    if (!k || k.document.deletedAt) throw notFound('Document');
    this.assertCanView(actor, k.profile.userId);
    const body = await this.storage.read(k.document.storageKey);
    await this.prisma.documentAccessLog.create({ data: { documentId: k.documentId, userId: actor.id, ip: meta.ip } });
    return { body, mime: k.document.mime, name: k.document.originalName };
  }
}
