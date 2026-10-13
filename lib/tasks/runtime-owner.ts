/** Opaque identity of one durable Eve/Workflow world, set by the server operator.
 * This is not a hostname, deployment ID, task argument, or credential. Keep it
 * across a restart/deploy only when that runtime can attach the original sessions.
 * Unset preserves migration rollout compatibility; explicit bad config fails shut. */
export function runtimeOwner(env:NodeJS.ProcessEnv=process.env):string|null {
 const owner=env.PRESTON_RUNTIME_OWNER;
 if(owner===undefined)return null;
 if(typeof owner!=='string'||!/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,159}$/.test(owner))throw Error('Invalid PRESTON_RUNTIME_OWNER configuration');
 return owner;
}
