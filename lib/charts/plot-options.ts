import * as Plot from '@observablehq/plot';
import type {ChartDatum,TufteChartSpec} from './tufte';

const extent=(values:number[],zero=false):[number,number]=>{
  let lo=Math.min(...values),hi=Math.max(...values);
  if(zero){lo=Math.min(0,lo);hi=Math.max(0,hi);}
  if(lo===hi){const pad=Math.abs(lo)*.05||1;lo-=pad;hi+=pad;}
  return [lo,hi];
};
const format=(value:number)=>value.toLocaleString(undefined,{maximumFractionDigits:4});
/** All groups derive domains from the entire spec, not their local subset. */
export function tuftePlotOptions(spec:TufteChartSpec,width:number,group?:string):Plot.PlotOptions {
  const all=spec.data,rows=group===undefined?all:all.filter(d=>(d.group??'')===group);
  const known=rows.filter(d=>d.value!==null),values=all.flatMap(d=>d.value===null?[]:[d.value,...(spec.kind==='interval'?[d.low!,d.high!]:[])]);
  const numericDomain=extent(values,spec.kind==='bar'||spec.kind==='histogram');
  const categories=[...new Set(all.map(d=>d.label))];
  const title=(d:ChartDatum)=>`${d.label}: ${d.value===null?'Missing':format(d.value)} ${spec.unit}${d.low!==undefined?` (${format(d.low)}–${format(d.high!)})`:''}`;
  const common:Plot.PlotOptions={width:Math.max(340,Math.floor(width)),height:230,marginTop:12,marginBottom:40,marginLeft:55,marginRight:65,
    style:{background:'white',color:'#222',fontFamily:'Gill Sans, Calibri, system-ui, sans-serif',fontSize:'11px'},
    ariaLabel:`${spec.kind} chart${group?` · ${group}`:''}`,ariaDescription:spec.note,
  };
  if(['bar','dot','interval'].includes(spec.kind)){
    const marginLeft=Math.min(180,Math.max(80,...categories.map(c=>c.length*5.8)));
    const marks:Plot.Markish[]=numericDomain[0]<=0&&numericDomain[1]>=0?[Plot.ruleX([0],{stroke:'#bbb',strokeWidth:.5})]:[];
    if(spec.kind==='bar')marks.push(Plot.barX(known,{x:'value',y:'label',fill:'#444',insetTop:6,insetBottom:6,title}));
    if(spec.kind==='interval')marks.push(Plot.ruleY(known,{x1:'low',x2:'high',y:'label',stroke:'#777',strokeWidth:1,title}));
    if(spec.kind!=='bar')marks.push(Plot.dot(known,{x:'value',y:'label',r:3,fill:'#222',title}));
    marks.push(Plot.text(known,{x:()=>numericDomain[1],y:'label',text:d=>format(d.value!),dx:8,textAnchor:'start'}));
    return {...common,marginLeft,height:categories.length*24+(spec.kind==='bar'?24:48),marginBottom:spec.kind==='bar'?8:30,x:{domain:numericDomain,axis:spec.kind==='bar'?null:'bottom',label:null,ticks:3,nice:false},y:{domain:categories,label:null,tickSize:0,tickFormat:d=>String(d).length>28?`${String(d).slice(0,27)}…`:String(d)},marks};
  }
  if(spec.kind==='heatmap'){
    return {...common,height:new Set(all.map(d=>d.group)).size*30+100,marginLeft:120,marginBottom:80,marginRight:15,
      x:{domain:categories,label:null,tickRotate:-30,tickSize:0,tickFormat:d=>String(d).length>18?`${String(d).slice(0,17)}…`:String(d)},
      y:{domain:[...new Set(all.map(d=>d.group!))],label:null,tickSize:0},
      color:{domain:extent(values),range:['#f2f2f2','#222'],legend:true,label:spec.unit},
      marks:[Plot.cell(known,{x:'label',y:'group',fill:'value',inset:1,title}),Plot.text(known,{x:'label',y:'group',text:d=>format(d.value!),fill:d=>d.value!>(numericDomain[0]+numericDomain[1])/2?'#fff':'#222',fontSize:10})]};
  }
  if(spec.kind==='histogram'){
    const domain=extent(all.flatMap(d=>d.value===null?[]:[d.value]));
    const thresholds=Array.from({length:13},(_,i)=>domain[0]+(domain[1]-domain[0])*i/12);
    // Shared bin edges and count domain make adjacent groups comparable.
    const groups=[...new Set(all.map(d=>d.group??''))];
    const counts=groups.flatMap(g=>{const bins=Array(12).fill(0);for(const d of all)if((d.group??'')===g&&d.value!==null)bins[Math.min(11,Math.floor((d.value-domain[0])/(domain[1]-domain[0])*12))]++;return bins;});
    return {...common,marginTop:28,marginRight:15,x:{domain,label:spec.unit},y:{domain:[0,Math.max(1,...counts)],label:'Observations',ticks:4,grid:false},
      marks:[Plot.rectY(known,{...Plot.binX({y:'count'},{x:'value',thresholds}),fill:'#444',inset:1}),Plot.ruleY([0],{stroke:'#aaa'})]};
  }
  const xDomain=extent(all.map(d=>d.x!));
  const x=(d:ChartDatum)=>spec.xType==='time'?new Date(d.x!):d.x!;
  const xOptions:Plot.ScaleOptions={domain:spec.xType==='time'?xDomain.map(d=>new Date(d)):xDomain,type:spec.xType==='time'?'utc':'linear',label:spec.xLabel,labelArrow:false,ticks:4};
  const ordered=[...rows].sort((a,b)=>a.x!-b.x!);
  const marks:Plot.Markish[]=spec.kind==='scatter'?[Plot.dot(known,{x,y:'value',r:3,fill:'#333',fillOpacity:.75,title})]:[
    Plot.line(ordered,{x,y:'value',stroke:'#333',strokeWidth:1.3}),Plot.dot(known,{x,y:'value',r:2,fill:'#333',title}),
  ];
  if(spec.kind!=='scatter'){
    const end=ordered.filter(d=>d.value!==null).at(-1);
    if(end)marks.push(Plot.text([end],{x,y:'value',text:d=>format(d.value!),dx:7,textAnchor:'start'}));
  }
  return {...common,height:spec.kind==='sparkline'?90:230,marginBottom:spec.kind==='sparkline'?8:40,marginLeft:spec.kind==='sparkline'?5:55,
    x:{...xOptions,axis:spec.kind==='sparkline'?null:'bottom'},y:{domain:numericDomain,label:null,ticks:4,grid:false,axis:spec.kind==='sparkline'?null:'left'},marks};
}
