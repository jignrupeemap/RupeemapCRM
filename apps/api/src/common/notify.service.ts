import { Injectable } from '@nestjs/common';
import type { Tx } from './prisma.service';

/** In-app notifications created inside business transactions. */
@Injectable()
export class NotifyService {
  async toUsers(
    tx: Tx,
    userIds: (string | null | undefined)[],
    n: { title: string; body: string; caseId?: string; priority?: string; sentById?: string },
  ) {
    const ids = [...new Set(userIds.filter((x): x is string => !!x))];
    if (!ids.length) return;
    await tx.notification.create({
      data: {
        title: n.title,
        body: n.body,
        priority: n.priority ?? 'NORMAL',
        audience: 'SYSTEM',
        caseId: n.caseId,
        sentById: n.sentById,
        recipients: { create: ids.map((userId) => ({ userId })) },
      },
    });
  }
}
