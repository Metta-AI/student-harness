/** Bounded parallel I/O with stable output ordering and no detached work on failure. */
export async function mapConcurrent<T,R>(items:readonly T[],concurrency:number,run:(item:T,index:number)=>Promise<R>):Promise<R[]>{
 if(!Number.isInteger(concurrency)||concurrency<1)throw Error('Concurrency must be a positive integer');
 const output:R[]=new Array(items.length);let cursor=0;
 const results=await Promise.allSettled(Array.from({length:Math.min(concurrency,items.length)},async()=>{
  while(cursor<items.length){const index=cursor++;output[index]=await run(items[index],index);}
 }));
 const failed=results.find(r=>r.status==='rejected');if(failed?.status==='rejected')throw failed.reason;
 return output;
}
