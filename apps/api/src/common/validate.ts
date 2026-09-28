import type { ZodTypeAny, z } from 'zod';
import { AppError } from './errors';

/** Parse input with a shared Zod schema; field errors go back to the form. */
export function parse<S extends ZodTypeAny>(schema: S, input: unknown): z.infer<S> {
  const r = schema.safeParse(input ?? {});
  if (!r.success) {
    const fields: Record<string, string> = {};
    for (const issue of r.error.issues) {
      const k = issue.path.join('.') || '_';
      if (!fields[k]) fields[k] = issue.message;
    }
    throw new AppError('VALIDATION_ERROR', Object.values(fields)[0] ?? 'Please check the form', { fields });
  }
  return r.data;
}
