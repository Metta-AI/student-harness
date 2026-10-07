import { defineTool } from 'eve/tools';
import { requireStudent } from '../lib/student';
import { createViewSchema } from '../../lib/views/model';
import { createView } from '../../lib/views/store';
export default defineTool({description:'Compose and save a new view for the current question: evidence-linked tables, bar charts, explanations or ordered steps. Use fresh tool results for factual values. Label hypotheses and uncertainty. Never invent measurements. Use current presentation.requestToken. The saved view appears in a named workspace tab and can be reopened. No HTML or executable code needed.',inputSchema:createViewSchema,async execute(input,ctx){return createView(requireStudent(ctx).subjectId,input);}});
