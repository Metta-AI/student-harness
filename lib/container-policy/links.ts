const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const league=/^league_[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

/** Link identity is reconstructed from the receipt, never from a tool-supplied
 * arbitrary URL. The destination still independently checks account ownership. */
export function containerOperationHref(kind:unknown,id:unknown,leagueId:unknown):string|null{
 if((kind!=='build'&&kind!=='upload'&&kind!=='practice')||typeof id!=='string'||!uuid.test(id)||typeof leagueId!=='string'||!league.test(leagueId))return null;
 return `/container-policy/${id}?kind=${kind}&leagueId=${leagueId}`;
}

export function containerOperationLink(value:unknown):string|null{
 if(!value||typeof value!=='object'||Array.isArray(value))return null;
 const row=value as Record<string,unknown>;
 const kind=row.kind??(typeof row.practice_id==='string'?'practice':typeof row.upload_id==='string'?'upload':typeof row.build_id==='string'?'build':null);
 return containerOperationHref(kind,row.id??(kind==='practice'?row.practice_id:kind==='upload'?row.upload_id:row.build_id),row.leagueId??row.league_id);
}
