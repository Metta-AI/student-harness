/** A newer background save must never silently become the parent of an older chat's working copy. */
export function needsPolicyMerge(workspaceRevision: string | null, currentRevision: string, mergedParent?: string) {
  return workspaceRevision !== currentRevision && mergedParent !== currentRevision;
}
