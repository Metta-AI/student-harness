import { defaultLeagueId } from "../league-catalog";
import { db, experimentByXp, latestPolicyVersion, policyVersionByRevision } from "../db";
import { presentationInputSchema } from "./presentation";
export async function preparePresentation(studentId: string, input: unknown) {
  const parsed = presentationInputSchema.parse(input);
  if(parsed.experimentId && !(await experimentByXp(studentId,parsed.experimentId))) throw new Error("Experiment unavailable in this workspace.");
  if(parsed.view==='custom') {
    if(!parsed.artifactId)throw new Error('Missing saved view');
    const {data,error}=await db().from('preston_views').select('id').eq('student_id',studentId).eq('league_id',defaultLeagueId).eq('id',parsed.artifactId).maybeSingle();
    if(error||!data)throw new Error('View unavailable');
  }
  if (parsed.revision || parsed.branchId) {
    const version = parsed.revision ? await policyVersionByRevision(studentId, parsed.revision) : await latestPolicyVersion(studentId);
    if (!version) throw new Error("That saved revision is unavailable in this workspace.");
    if (parsed.branchId && !(version.ir as { strategy: { id: string }[] }).strategy.some(rule => rule.id === parsed.branchId)) throw new Error("That strategy branch is unavailable in this revision.");
  }
  if (parsed.cycleId) {
    const { data, error } = await db().from("research_cycles").select("id").eq("student_id", studentId).eq("id", parsed.cycleId).maybeSingle();
    if (error || !data) throw new Error("That investigation is unavailable in this workspace.");
  }
  return { status: "prepared", presentation: parsed, note: "Prepared as an additional workspace tab. The browser may reject an outdated request. It does not change the human's view. The next client context contains the display receipt." };
}
