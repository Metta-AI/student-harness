import { z } from "zod";
import defaultLeague from "../league.json" with { type: "json" };
export const leagueIdSchema = z.string().regex(/^league_[0-9a-f-]{36}$/);
export const catalogGameSchema = z.object({ id:z.string(),name:z.string(),coworld_name:z.string().nullable().optional(),coworld_id:z.string().nullable().optional(),default_league_id:z.string().nullable().optional() });
export const catalogLeagueSchema = z.object({
  id:leagueIdSchema,name:z.string(),game:catalogGameSchema,description:z.string().nullable().optional(),
  hidden:z.boolean().default(false),disabled_at:z.string().nullable().optional(),
  rounds_paused_at:z.string().nullable().optional(),participation_url:z.string().url().optional(),wiki_markdown_url:z.string().url().nullable().optional(),
});
export type CatalogLeague=z.infer<typeof catalogLeagueSchema>;
export const defaultLeagueId=defaultLeague.id;
export function leagueURL(id:string){return `https://softmax.com/observatory/v2?tab=coworlds&detail=${encodeURIComponent(`league:${id}`)}`;}
export function workspaceURL(id:string){return id===defaultLeagueId?"/":`/?league=${encodeURIComponent(id)}`;}
export function activeCatalog(leagues:CatalogLeague[]){return leagues.filter(l=>!l.hidden&&!l.disabled_at).sort((a,b)=>a.id===defaultLeagueId?-1:b.id===defaultLeagueId?1:a.game.name.localeCompare(b.game.name)||a.name.localeCompare(b.name));}
