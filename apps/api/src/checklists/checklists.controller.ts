import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { z } from 'zod';
import { caseChecklistUpdateSchema, checklistTemplateSchema } from '@rupeemap/shared';
import { ChecklistsService } from './checklists.service';
import { parse } from '../common/validate';
import { CurrentUser, Meta, RequirePermission, type AuthUser, type RequestMeta } from '../common/auth-context';

const resolveSchema = z.object({ bankId: z.string().uuid('Choose a bank'), loanType: z.string().min(1, 'Choose a loan type').max(40), projectId: z.string().uuid().optional() });

@Controller()
export class ChecklistsController {
  constructor(private readonly checklists: ChecklistsService) {}

  @Get('checklists')
  @RequirePermission('CHECKLIST_VIEW')
  list(@CurrentUser() user: AuthUser, @Query() q: Record<string, string>) {
    return this.checklists.list(user, q);
  }

  /** "Which documents do I need?" for a bank and loan type, before a case exists. */
  @Get('checklists/resolve')
  @RequirePermission('CHECKLIST_VIEW')
  resolve(@Query() q: unknown) {
    return this.checklists.resolve(parse(resolveSchema, q));
  }

  @Post('checklists')
  @RequirePermission('CHECKLIST_MANAGE')
  create(@CurrentUser() user: AuthUser, @Body() body: unknown, @Meta() meta: RequestMeta) {
    return this.checklists.create(user, parse(checklistTemplateSchema, body), meta);
  }

  @Patch('checklists/:id')
  @RequirePermission('CHECKLIST_MANAGE')
  update(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown, @Meta() meta: RequestMeta) {
    return this.checklists.update(user, id, parse(checklistTemplateSchema, body), meta);
  }

  @Delete('checklists/:id')
  @RequirePermission('CHECKLIST_MANAGE')
  remove(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Meta() meta: RequestMeta) {
    return this.checklists.remove(user, id, meta);
  }

  @Get('cases/:id/checklist')
  forCase(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.checklists.forCase(user, id);
  }

  @Put('cases/:id/checklist/:itemId')
  updateItem(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('itemId', ParseUUIDPipe) itemId: string,
    @Body() body: unknown,
    @Meta() meta: RequestMeta,
  ) {
    return this.checklists.updateCaseItem(user, id, itemId, parse(caseChecklistUpdateSchema, body), meta);
  }
}
