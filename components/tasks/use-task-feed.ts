"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Task, TaskWorker } from "../../lib/tasks/model";

export const taskStatuses: Record<Task["status"], string> = { queued: "Queued", running: "Working", waiting: "Waiting for game", paused: "Paused", needs_input: "Needs you", completed: "Completed", failed: "Failed", canceled: "Canceled" };
export const taskPhases: Record<Task["phase"], string> = { propose: "Compare proposals", select: "Review proposals", save: "Save change", upload: "Upload policy", request_game: "Run hosted game", evaluate: "Review evidence", done: "Finished" };
export function workerStatus(worker: TaskWorker, task: Task) { return worker.status === "running" && task.status !== "running" ? "Interrupted" : worker.status === "running" ? "Working" : worker.status === "completed" ? "Done" : "Failed"; }

export type CampaignSummary={id:string;task_id:string;objective:string;state:string;phase:string;cycle:number};

/** One poll feeds the session rail and the selected activity, preventing divergent statuses. */
export function useTaskFeed(enabled: boolean) {
  const [campaigns,setCampaigns]=useState<CampaignSummary[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [workers, setWorkers] = useState<TaskWorker[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const sequence = useRef(0);
  const inFlight = useRef<Promise<void>|null>(null);
  const upsert = useCallback((task:Task) => {setTasks(current=>[task,...current.filter(t=>t.id!==task.id)]);setLoaded(true);}, []);
  const refresh = useCallback(():Promise<void> => {
    if (!enabled) return Promise.resolve();
    if(inFlight.current)return inFlight.current;
    const request=sequence.current;
    const work=(async()=>{
      try {
        const response=await fetch("/api/tasks",{cache:"no-store",signal:AbortSignal.timeout(15000)});
        const body=await response.json();
        if(!response.ok)throw new Error(body.error||"Sessions could not be loaded.");
        if(request!==sequence.current)return;
        setCampaigns(body.campaigns??[]);setTasks(body.tasks);setWorkers(body.workers);setLoaded(true);setError("");
      }catch(error){if(request===sequence.current)setError(error instanceof Error&&error.name!=="TimeoutError"?error.message:"Reconnecting… Last saved sessions are shown.");}
    })();
    inFlight.current=work;
    void work.finally(()=>{if(inFlight.current===work)inFlight.current=null;});
    return work;
  }, [enabled]);
  useEffect(() => {
    if (!enabled) { setCampaigns([]);setTasks([]); setWorkers([]); setLoaded(false); setError(""); return; }
    const update=()=>void refresh();window.addEventListener("background-work-updated",update);
    void refresh();
    const timer = setInterval(() => { if (document.visibilityState === "visible") void refresh(); }, 5000);
    return () => { clearInterval(timer); window.removeEventListener("background-work-updated",update); sequence.current++; inFlight.current=null; };
  }, [enabled, refresh]);
  return { tasks, workers, campaigns, loaded, error, refresh, upsert };
}
export type TaskFeed = ReturnType<typeof useTaskFeed>;
