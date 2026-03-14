export type LifecycleEventName =
  | "agent:started"
  | "agent:polling"
  | "job:detected"
  | "generation:start"
  | "generation:complete"
  | "build:start"
  | "build:complete"
  | "zip:start"
  | "zip:complete"
  | "submission:success"
  | "submission:error";

export interface LifecycleEvent {
  type: LifecycleEventName;
  timestamp: string;
  payload?: Record<string, unknown>;
}

export interface MonitorSnapshot {
  online: boolean;
  paused: boolean;
  currentStage: string;
  lastProcessedJob: string | null;
  totalJobs: number;
  generationDurationsMs: number[];
  submissions: {
    success: number;
    error: number;
  };
}

export interface MonitorState {
  connected: boolean;
  snapshot: MonitorSnapshot;
  logs: LifecycleEvent[];
}

export type ControlAction = "pause-polling" | "resume-polling" | "restart-agent";
