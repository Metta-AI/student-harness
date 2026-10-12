import {z} from 'zod';

export const chartKinds=['bar','dot','line','sparkline','scatter','histogram','heatmap','interval'] as const;
export type ChartKind=typeof chartKinds[number];
export const chartCatalog:Record<ChartKind,{label:string;use:string}>={
  bar:{label:'Bars',use:'Compare category magnitudes on a zero-based scale.'},
  dot:{label:'Dots',use:'Compare many labeled values with less ink.'},
  line:{label:'Trend',use:'Show ordered numeric or time observations. Missing values break the line.'},
  sparkline:{label:'Sparkline',use:'Compact trend with endpoint values; use the source table for exact readings.'},
  scatter:{label:'Scatter',use:'Compare two measured numeric variables without implying causality.'},
  histogram:{label:'Distribution',use:'Show the distribution of individual observations, never pre-aggregated counts.'},
  heatmap:{label:'Matrix',use:'Compare a labeled row/column matrix with grayscale intensity and exact values.'},
  interval:{label:'Intervals',use:'Show supplied lower/upper bounds and estimates; never invent uncertainty.'},
};
const number=z.number().finite().min(-1e15).max(1e15);
export const chartDatumSchema=z.object({
  label:z.string().min(1).max(100),
  value:number.nullable().describe('Measured value; null means missing, never zero.'),
  x:number.optional().describe('Numeric horizontal coordinate for trend/scatter. For time, use epoch milliseconds and xType=time.'),
  group:z.string().min(1).max(80).optional().describe('Small-multiple group, or row name in a heatmap.'),
  low:number.optional(),high:number.optional(),
}).strict();
export type ChartDatum=z.infer<typeof chartDatumSchema>;
export const chartDataSchema=z.array(chartDatumSchema).min(1).max(600);
export function compatibleCharts(data:ChartDatum[], observations:'individual'|'aggregated'='aggregated'):ChartKind[]{
  const known=data.filter(d=>d.value!==null);
  if(!known.length)return [];
  const groups=new Set(data.map(d=>d.group??''));
  if(groups.size>8)return [];
  const uniqueCategories=new Set(data.map(d=>JSON.stringify([d.group??'',d.label]))).size===data.length;
  const boundedCategories=new Set(data.map(d=>d.label)).size<=40;
  const coordinates=data.every(d=>d.x!==undefined);
  const ordered=coordinates&&new Set(data.map(d=>JSON.stringify([d.group??'',d.x]))).size===data.length;
  return chartKinds.filter(kind=>{
    if(kind==='bar'||kind==='dot')return uniqueCategories&&boundedCategories;
    if(kind==='line'||kind==='sparkline')return ordered;
    if(kind==='scatter')return coordinates;
    if(kind==='histogram')return observations==='individual';
    if(kind==='heatmap')return uniqueCategories&&data.every(d=>d.group)&&new Set(data.map(d=>d.label)).size<=20;
    return uniqueCategories&&boundedCategories&&known.every(d=>d.low!==undefined&&d.high!==undefined&&d.low<=d.value!&&d.value!<=d.high);
  });
}
export const tufteChartSchema=z.object({
  kind:z.enum(chartKinds),
  unit:z.string().min(1).max(60),
  xLabel:z.string().max(100).optional(),
  xType:z.enum(['number','time']).default('number'),
  data:chartDataSchema,observations:z.enum(['individual','aggregated']).default('aggregated'),
  note:z.string().max(1000).optional().describe('Sample, scope, comparison and uncertainty; do not repeat the title.'),
}).strict().superRefine((spec,ctx)=>{
  if(!compatibleCharts(spec.data,spec.observations).includes(spec.kind))ctx.addIssue({code:'custom',message:'Chart does not fit the data. Check coordinates, unique categories, interval bounds, measured values and group limits.'});
  if(['line','sparkline','scatter'].includes(spec.kind)&&!spec.xLabel?.trim())ctx.addIssue({code:'custom',path:['xLabel'],message:'Label the horizontal coordinate and units.'});
  if(spec.data.some(d=>(d.low===undefined)!==(d.high===undefined)||(d.low!==undefined&&d.high!==undefined&&d.low>d.high)))ctx.addIssue({code:'custom',message:'Supply ordered lower and upper bounds together.'});
  if(spec.xType==='time'&&spec.data.some(d=>d.x!==undefined&&Math.abs(d.x)>8.64e15))ctx.addIssue({code:'custom',message:'Invalid timestamp.'});
});
export type TufteChartSpec=z.infer<typeof tufteChartSchema>;
export const chartSelectionSchema=z.object({
  purpose:z.enum(['comparison','trend','relationship','distribution','matrix','uncertainty']),
  title:z.string().min(1).max(160),
  unit:z.string().min(1).max(60),xLabel:z.string().max(100).optional(),xType:z.enum(['number','time']).default('number'),
  data:chartDataSchema,observations:z.enum(['individual','aggregated']).default('aggregated'),note:z.string().max(1000).optional(),prefer:z.enum(chartKinds).optional(),
});
export function selectTufteChart(input:z.infer<typeof chartSelectionSchema>){
  const defaults={comparison:'dot',trend:'line',relationship:'scatter',distribution:'histogram',matrix:'heatmap',uncertainty:'interval'} as const;
  const kind=input.prefer??defaults[input.purpose];
  const result=tufteChartSchema.safeParse({kind,unit:input.unit,xLabel:input.xLabel,xType:input.xType,data:input.data,observations:input.observations,note:input.note});
  if(!result.success)return {status:'needs_data' as const,reason:result.error.issues.map(i=>i.message).join(' '),compatible:compatibleCharts(input.data,input.observations),guidance:'Use a table if the question requires data you do not have. Do not synthesize missing measurements or intervals.'};
  return {status:'selected' as const,reason:chartCatalog[kind].use,compatible:compatibleCharts(input.data,input.observations),block:{type:'tufte_chart' as const,title:input.title,chart:result.data,evidence:[]},next:'Add real evidence links to block.evidence and pass this block to create_view with the current presentation.requestToken. For compose_workspace apps, use kind=chart, a stable id, title and chart. Selection does not save a panel or run work.'};
}
