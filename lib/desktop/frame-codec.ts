import sharp from 'sharp';
import type {z} from 'zod';
import {replayFrameSchema} from './control';
export async function normalizeReplayFrame(input:z.infer<typeof replayFrameSchema>){
 const p=replayFrameSchema.parse(input),bytes=Buffer.from(p.image,'base64');
 if(bytes.length>524288||bytes.toString('base64')!==p.image)throw Error('Invalid frame encoding');
 const image=sharp(bytes,{limitInputPixels:1280*1280,failOn:'warning'}),metadata=await image.metadata();
 if(metadata.format!=='jpeg'||metadata.width!==p.width||metadata.height!==p.height||(metadata.pages??1)!==1)throw Error('Invalid JPEG frame dimensions');
 // Decode and re-encode to reject corrupt images and strip embedded metadata.
 const normalized=await image.jpeg({quality:80}).toBuffer();
 if(normalized.length>524288)throw Error('Frame exceeds image limit');
 return {...p,image:normalized.toString('base64')};
}
