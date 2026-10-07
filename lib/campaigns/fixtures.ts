import {fixtureSeat} from './candidate';
import {hashObject,type Baseline,type Fixture} from './model';

/** Keep metadata order; duplicate seeds never discard earlier valid fixtures. */
export function extendFixtures(existing:Fixture[],inputs:(Omit<Fixture,'slot'>|null)[],baseline:Baseline,excludedSeeds:string[],total:number):Fixture[]{
 const fixtures=[...existing],seeds=new Set([...excludedSeeds,...existing.map(f=>String(f.seed))]);
 for(const input of inputs){
  if(fixtures.length>=total)break;
  if(!input||seeds.has(String(input.seed)))continue;
  const slot=fixtureSeat(fixtures.length),roster=[...input.roster],hashes=[...input.hashes];
  roster[slot]=baseline.versionId;hashes[slot]=baseline.sourceHash;
  fixtures.push({...input,roster,hashes,slot});seeds.add(String(input.seed));
 }
 return fixtures;
}

/** New, precommitted random seeds on recorded league lineups. These are not
 * historical episode replays. Each ten-fixture block covers every subject seat. */
export function freshSeedFixtures(campaignId:string,cycle:number,templates:Omit<Fixture,'slot'>[],baseline:Baseline,excludedSeeds:string[],total:number):Fixture[]{
 if(!templates.length)throw Error('No compatible league templates');
 const fixtures:Fixture[]=[],used=new Set([...excludedSeeds,...templates.map(t=>String(t.seed))]);
 for(let nonce=0;fixtures.length<total;nonce++){
  const seed=parseInt(hashObject({generator:'preston-fresh-seeds-v1',campaignId,cycle,nonce}).slice(0,8),16)%2147483647;
  if(used.has(String(seed)))continue;
  const index=fixtures.length,template=templates[Math.floor(index/10)%templates.length],slot=fixtureSeat(index);
  const roster=[...template.roster],hashes=[...template.hashes];
  roster[slot]=baseline.versionId;hashes[slot]=baseline.sourceHash;
  fixtures.push({...template,episodeId:`generated_${hashObject({campaignId,cycle,seed})}`,templateEpisodeId:template.episodeId,
   seed,slot,roster,hashes,config:{...template.config,seed}});
  used.add(String(seed));
 }
 return fixtures;
}
