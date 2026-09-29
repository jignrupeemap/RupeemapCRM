import { contentDisposition } from '../common/http-safety';
import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { ticketCreateSchema, ticketReplySchema, ticketUpdateSchema } from '@rupeemap/shared';
import { TicketsService } from './tickets.service';
import { MAX_UPLOAD_BYTES } from '../common/storage.service';
import { parse } from '../common/validate';
import { CurrentUser, Meta, type AuthUser, type RequestMeta } from '../common/auth-context';

@Controller('tickets')
export class TicketsController {
  constructor(private readonly tickets: TicketsService) {}

  @Get()
  list(@CurrentUser() user: AuthUser, @Query() q: Record<string, string>) {
    return this.tickets.list(user, q);
  }

  @Get('counts')
  counts(@CurrentUser() user: AuthUser) {
    return this.tickets.counts(user);
  }

  @Get(':id')
  detail(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.tickets.detail(user, id);
  }

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() body: unknown, @Meta() meta: RequestMeta) {
    return this.tickets.create(user, parse(ticketCreateSchema, body), meta);
  }

  /** Reply or internal note, optionally with one attachment (multipart field "file"). */
  @Post(':id/messages')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 } }))
  reply(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: Record<string, unknown>,
    @Meta() meta: RequestMeta,
    @UploadedFile() file?: { buffer: Buffer; originalname: string; size: number },
  ) {
    // Multipart sends text fields as strings.
    const input = { ...body, internal: body?.internal === true || body?.internal === 'true' };
    return this.tickets.reply(user, id, parse(ticketReplySchema, input), meta, file);
  }

  @Patch(':id')
  update(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown, @Meta() meta: RequestMeta) {
    return this.tickets.update(user, id, parse(ticketUpdateSchema, body), meta);
  }

  @Get('messages/:messageId/file')
  async file(@CurrentUser() user: AuthUser, @Param('messageId', ParseUUIDPipe) messageId: string, @Meta() meta: RequestMeta, @Res() res: Response) {
    const f = await this.tickets.attachment(user, messageId, meta);
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
