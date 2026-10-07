import { db } from '../db';
import type { OpponentResearchStatus } from './model';

/** Read only research presence; full notebooks are loaded when a row opens. */
export async function opponentResearchStatus(student: string, leagueId: string): Promise<OpponentResearchStatus[]> {
  const policies = await Promise.all(['opponent_notes', 'opponent_models'].map(async table => {
    const ids = new Set<string>();
    let after: string | undefined;
    for (;;) {
      let query = db().from(table).select('policy_id').eq('student_id', student).eq('league_id', leagueId)
        .order('policy_id', { ascending: true }).limit(500);
      if (after) query = query.gt('policy_id', after);
      const { data, error } = await query;
      if (error) throw Error('Opponent research status could not be loaded');
      for (const row of data ?? []) ids.add(row.policy_id);
      if (!data || data.length < 500) return ids;
      // We need presence, so skip any remaining records for the last policy in this page.
      after = data[data.length - 1].policy_id;
    }
  }));
  const [notes, models] = policies;
  return [...new Set([...notes, ...models])].map(policyId => ({ policyId, hasNotes: notes.has(policyId), hasModel: models.has(policyId) }));
}
