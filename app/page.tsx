import league from "../league.json";
import { StudentApp } from "../components/student-app";

export default function Home() {
  return <StudentApp league={league} />;
}
