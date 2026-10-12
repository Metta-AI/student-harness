/** Bound streamed bodies as well as requests with Content-Length. */
export async function readLearningBody(request:Request):Promise<unknown>{
 const reader=request.body?.getReader();if(!reader)throw new SyntaxError('Missing body');
 const chunks:Uint8Array[]=[];let size=0;
 try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>65536){await reader.cancel();throw new SyntaxError('Request too large');}chunks.push(value);}return JSON.parse(Buffer.concat(chunks).toString('utf8'));}finally{reader.releaseLock();}
}
