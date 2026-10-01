import { defineSchedule } from "eve/schedules";
import { listOpenExperiments, reconcileGame, retryCanceledBaseline } from "../../lib/reconcile-games";
import { studentToken } from "../../lib/db";

export default defineSchedule({
  cron: "0 2 * * *",
  async run() {
    const games = await listOpenExperiments(100);
    for (const game of games) {
      const token = await studentToken(game.student_id);
      if (game.status === "canceled" || game.status === "cancelled") {
        await retryCanceledBaseline(game.student_id, token, game);
        continue;
      }
      const { experience } = await reconcileGame(game, token);
      if (experience.status === "canceled" || experience.status === "cancelled") await retryCanceledBaseline(game.student_id, token, { ...game, status: experience.status });
    }
  },
});
