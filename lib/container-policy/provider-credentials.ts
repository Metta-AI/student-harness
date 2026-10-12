/** The Sandbox SDK reads OIDC automatically, but external-host access tokens
 * must be passed explicitly on every create/get. Never serialize this object
 * into a build envelope, journal, child VM environment or log. */
export function containerProviderCredentials(env:NodeJS.ProcessEnv=process.env){
 const values=[env.VERCEL_TOKEN,env.VERCEL_TEAM_ID,env.VERCEL_PROJECT_ID];
 if(env.VERCEL_TOKEN===undefined)return {};
 if(values.some(value=>typeof value!=='string'||!value||value!==value.trim()||/[\r\n]/.test(value)))throw Error('Incomplete container provider credentials');
 return {token:env.VERCEL_TOKEN!,teamId:env.VERCEL_TEAM_ID!,projectId:env.VERCEL_PROJECT_ID!};
}
