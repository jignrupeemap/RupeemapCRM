import { Body, Controller, Get, Param, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import {
  changePasswordSchema,
  loginSchema,
  mobileSchema,
  otpRequestSchema,
  otpVerifySchema,
  setPasswordSchema,
} from '@rupeemap/shared';
import { AuthService } from './auth.service';
import { parse } from '../common/validate';
import { CurrentUser, Meta, Public, type AuthUser, type RequestMeta } from '../common/auth-context';
import { SESSION_COOKIE } from '../common/auth.guard';
import { RedisService } from '../common/redis.service';
import { notFound } from '../common/errors';

function setSessionCookie(res: Response, token: string, maxAgeMs: number) {
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: maxAgeMs,
    path: '/',
  });
}

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly redis: RedisService,
  ) {}

  @Public()
  @Post('login')
  async login(@Body() body: unknown, @Meta() meta: RequestMeta, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const { login, password } = parse(loginSchema, body);
    const { token, maxAgeMs } = await this.auth.login(login, password, { ...meta, userAgent: req.headers['user-agent'] });
    setSessionCookie(res, token, maxAgeMs);
    // Bearer token returned for mobile apps; the web app relies on the httpOnly cookie.
    return { token: req.headers['x-client'] === 'mobile' ? token : undefined };
  }

  @Post('logout')
  async logout(@CurrentUser() user: AuthUser, @Req() req: Request, @Meta() meta: RequestMeta, @Res({ passthrough: true }) res: Response) {
    await this.auth.logout(user, req.cookies?.[SESSION_COOKIE], meta);
    res.clearCookie(SESSION_COOKIE, { path: '/' });
    return null;
  }

  @Public()
  @Post('otp/request')
  requestOtp(@Body() body: unknown, @Meta() meta: RequestMeta) {
    const { mobile, purpose } = parse(otpRequestSchema, body);
    return this.auth.requestOtp(mobile, purpose, meta);
  }

  @Public()
  @Post('otp/verify')
  verifyOtp(@Body() body: unknown, @Meta() meta: RequestMeta) {
    const { mobile, purpose, otp } = parse(otpVerifySchema, body);
    return this.auth.verifyOtp(mobile, purpose, otp, meta);
  }

  @Public()
  @Post('password/set')
  async setPassword(@Body() body: unknown, @Meta() meta: RequestMeta, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const { token, password } = parse(setPasswordSchema, body);
    const r = await this.auth.setPassword(token, password, { ...meta, userAgent: req.headers['user-agent'] });
    setSessionCookie(res, r.token, r.maxAgeMs);
    return null;
  }

  @Post('password/change')
  async changePassword(@CurrentUser() user: AuthUser, @Body() body: unknown, @Meta() meta: RequestMeta) {
    const { currentPassword, newPassword } = parse(changePasswordSchema, body);
    await this.auth.changePassword(user, currentPassword, newPassword, meta);
    return null;
  }

  @Get('me')
  me(@CurrentUser() user: AuthUser) {
    return this.auth.me(user);
  }

  /** Development/staging only: read the last SMS sent to a number (console SMS provider). */
  @Public()
  @Get('dev/last-sms/:mobile')
  async lastSms(@Param('mobile') mobile: string) {
    if (process.env.NODE_ENV === 'production' || process.env.SMS_PROVIDER !== 'console') throw notFound();
    const m = parse(mobileSchema, mobile);
    return this.redis.getJson(`dev:sms:${m}`);
  }
}
