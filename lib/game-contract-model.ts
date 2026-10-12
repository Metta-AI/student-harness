import {z} from 'zod';
export const manifestHashSchema=z.string().regex(/^sha256:[0-9a-f]{64}$/);
export const gameDocumentIdSchema=z.string().min(1).max(180).regex(/^[a-zA-Z0-9_:.-]+$/);
export const gameContractReadSchema=z.object({
 documentId:gameDocumentIdSchema.optional(),expectedManifestHash:manifestHashSchema.optional(),
 offset:z.number().int().min(0).max(2_000_000).default(0),limit:z.number().int().min(1).max(24000).default(12000),
}).strict().refine(p=>p.offset===0||!!p.documentId,'Choose a document before paging');
export type GameContractRead=z.infer<typeof gameContractReadSchema>;
export type GameContract={
 leagueId:string;leagueName:string;gameName:string;coworldId:string;version:string;manifestHash:string;checkedAt:string;
 runtime:'platform-hosted'|'game-hosted'|null;runtimeDefaulted:boolean;sourceURL:string|null;sourceRevision:string|null;
 episodeTimeoutMinutes:number|null;playersPerUser:number|null;
 /** Published execution metadata, absent on older saved contract snapshots. */
 practice?:{configSchema:Record<string,unknown>;variants:{id:string;name:string;gameConfig:Record<string,unknown>}[]};
 starters:{id:string;name:string;image:string|null;file:string|null;run:string[];sourceURL:string|null;sourceRevision:string|null}[];
 documents:{id:string;title:string;characters:number|null;sha256:string|null;url:string|null}[];
 document:{id:string;title:string;sha256:string|null;content:string|null;url:string|null;offset:number;nextOffset:number|null;totalCharacters:number|null}|null;
};
