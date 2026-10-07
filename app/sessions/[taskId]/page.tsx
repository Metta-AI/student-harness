import { notFound } from 'next/navigation';
import { z } from 'zod';
import league from '../../../league.json';
import { StudentApp } from '../../../components/student-app';
export default async function SessionPage({params}:{params:Promise<{taskId:string}>}) {
 const {taskId}=await params;
 if(!z.uuid().safeParse(taskId).success)notFound();
 return <StudentApp league={league} initialTaskId={taskId}/>;
}
