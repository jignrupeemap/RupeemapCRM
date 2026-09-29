import { contentDisposition } from '../common/http-safety';
import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Put, Query, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { z } from 'zod';
import { KYC_DOC_TYPES } from '@rupeemap/shared';
import { KycService } from './kyc.service';
import { MAX_UPLOAD_BYTES } from '../common/storage.service';
import { parse } from '../common/validate';
import { CurrentUser, Meta, type AuthUser, type RequestMeta } from '../common/auth-context';

const typeSchema = z.enum(KYC_DOC_TYPES, { errorMap: () => ({ message: 'Unknown document type' }) });
const gstSchema = z.object({ gstApplicable: z.boolean() });

interface UploadedBuffer {
  buffer: Buffer;
  originalname: string;
  size: number;
}

@Controller('kyc')
export class KycController {
  constructor(private readonly kyc: KycService) {}

  @Get()
  queue(@CurrentUser() user: AuthUser, @Query() q: Record<string, string>) {
    return this.kyc.queue(user, q);
  }

  @Get(':userId')
  detail(@CurrentUser() user: AuthUser, @Param('userId', ParseUUIDPipe) userId: string) {
    return this.kyc.detail(user, userId);
  }

  /** Multipart upload, field name "file". Kept in memory (max 10 MB) and stored encrypted. */
  @Post(':userId/documents/:type')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 } }))
  upload(
    @CurrentUser() user: AuthUser,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Param('type') type: string,
    @UploadedFile() file: UploadedBuffer,
    @Meta() meta: RequestMeta,
  ) {
    return this.kyc.upload(user, userId, parse(typeSchema, type), file, meta);
  }

  @Put(':userId/gst')
  gst(@CurrentUser() user: AuthUser, @Param('userId', ParseUUIDPipe) userId: string, @Body() body: unknown, @Meta() meta: RequestMeta) {
    return this.kyc.setGst(user, userId, parse(gstSchema, body).gstApplicable, meta);
  }

  @Post(':userId/submit')
  submit(@CurrentUser() user: AuthUser, @Param('userId', ParseUUIDPipe) userId: string, @Meta() meta: RequestMeta) {
    return this.kyc.submit(user, userId, meta);
  }

  /** Streams a private document to an authorised viewer; never cached, never guessed. */
  @Get('documents/:id/file')
  async file(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Meta() meta: RequestMeta, @Res() res: Response) {
    const f = await this.kyc.open(user, id, meta);
    res.set({
      'Content-Type': f.mime,
      'Content-Length': String(f.body.length),
      'Content-Disposition': contentDisposition('inline', f.name),
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
    });
    res.end(f.body);
  }
}
