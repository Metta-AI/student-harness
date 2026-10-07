import { z } from "zod";
export const softmaxCliSchema=z.object({program:z.enum(['softmax','coworld']).default('coworld'),args:z.array(z.string().min(1).max(500)).min(1).max(30)}).strict();
