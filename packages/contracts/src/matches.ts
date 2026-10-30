import { z } from 'zod';

const onlineMatchIdPattern = /^\d{1,32}$/;

export function isOnlineMatchId(value: string): boolean {
  return onlineMatchIdPattern.test(value);
}

export const matchReferenceSchema = z.union([
  z.string().regex(onlineMatchIdPattern),
  z
    .string()
    .max(128)
    .regex(/^(?:local|legacy):[^\u0000-\u001f\u007f-\u009f\u2028\u2029]+$/),
]);
