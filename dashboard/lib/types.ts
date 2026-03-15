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

export interface JobHistoryItem {
  jobId: string;
  completedAt: string;
  downloadUrl: string;
}

export interface PreviewFile {
  name: string;
  content: string;
}

export interface TimelineEntry {
  stage: string;
  message: string;
  time: string;
}

export interface AgentMonitorState {
  currentStage: string;
  logs: string[];
  timeline: TimelineEntry[];
  online: boolean;
}

export interface MonitorState {
  connected: boolean;
  snapshot: MonitorSnapshot;
  logs: LifecycleEvent[];
  jobs: JobHistoryItem[];
  files: PreviewFile[];
  activeFile: string | null;
  stageLogs: Record<string, string[]>;
  timeline: TimelineEntry[];
  agents: Record<string, AgentMonitorState>;
}

export type ControlAction = "pause-polling" | "resume-polling" | "restart-agent";
