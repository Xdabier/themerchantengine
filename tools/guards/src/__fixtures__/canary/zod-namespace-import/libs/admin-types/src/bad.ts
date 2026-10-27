import { z } from 'zod';

export const badSchema = z.object({ id: z.string() });
