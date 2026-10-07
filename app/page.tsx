import league from "../league.json";
import { StudentApp } from "../components/student-app";
import { LeagueExplorer } from "../components/league-explorer";
import { leagueIdSchema } from "../lib/league-catalog";
export default async function Home({searchParams}:{searchParams:Promise<{league?:string}>}) {
  const query=await searchParams;
  if(query.league && query.league!==league.id){
    const id=leagueIdSchema.safeParse(query.league);
    return id.success?<LeagueExplorer key={id.data} leagueId={id.data}/>:<main className="shell"><h1>League not found</h1><a href="/">Open Gods of the Arena ↗</a></main>;
  }
  return <StudentApp league={league}/>;
}
