"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type {
  AgentMonitorState,
  ControlAction,
  JobHistoryItem,
  LifecycleEvent,
  MonitorState,
  MonitorSnapshot,
  PreviewFile,
  TimelineEntry,
} from "./types";

const DEFAULT_SNAPSHOT: MonitorSnapshot = {
  online: false,
  paused: false,
  currentStage: "idle",
  lastProcessedJob: null,
  totalJobs: 0,
  generationDurationsMs: [],
  submissions: {
    success: 0,
    error: 0,
  },
};

function makeDefaultAgentState(stage = "watcher"): AgentMonitorState {
  return {
    currentStage: stage,
    logs: [],
    timeline: [],
    online: true,
  };
}

export function useAgentStream() {
  const [state, setState] = useState<MonitorState>({
    connected: false,
    snapshot: DEFAULT_SNAPSHOT,
    logs: [],
    jobs: [],
    files: [],
    activeFile: null,
    stageLogs: {},
    timeline: [],
    agents: {},
  });

  const socketRef = useRef<WebSocket | null>(null);

  const wsUrl = useMemo(
    () => process.env.NEXT_PUBLIC_AGENT_WS_URL || "ws://localhost:7071",
    []
  );

  const downloadBaseUrl = useMemo(() => {
    try {
      const parsed = new URL(wsUrl);
      const httpProtocol = parsed.protocol === "wss:" ? "https:" : "http:";
      return `${httpProtocol}//${parsed.host}`;
    } catch {
      return "";
    }
  }, [wsUrl]);

  useEffect(() => {
    let shouldReconnect = true;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    const connect = () => {
      const socket = new WebSocket(wsUrl);
      socketRef.current = socket;

      socket.onopen = () => {
        setState((prev) => ({ ...prev, connected: true }));
      };

      socket.onclose = () => {
        setState((prev) => {
          const nextAgents: Record<string, AgentMonitorState> = {};
          for (const [agentId, agent] of Object.entries(prev.agents)) {
            nextAgents[agentId] = {
              ...agent,
              online: false,
            };
          }

          return {
            ...prev,
            connected: false,
            agents: nextAgents,
          };
        });
        if (shouldReconnect) {
          reconnectTimer = setTimeout(connect, 1500);
        }
      };

      socket.onerror = () => {
        socket.close();
      };

      socket.onmessage = (event) => {
        let payload: unknown;
        try {
          payload = JSON.parse(event.data);
        } catch {
          return;
        }

        if (isJobPreviewMessage(payload)) {
          const normalizedFiles = payload.files.map((file) => ({
            name: file.name,
            content: file.content,
          }));

          setState((prev) => ({
            ...prev,
            files: normalizedFiles,
            activeFile:
              prev.activeFile && normalizedFiles.some((f) => f.name === prev.activeFile)
                ? prev.activeFile
                : normalizedFiles[0]?.name ?? null,
          }));

          return;
        }

        if (isStageUpdateMessage(payload)) {
          const now = new Date().toISOString();
          const timelineEntry: TimelineEntry = {
            stage: payload.stage,
            message: `${payload.stage} started`,
            time: now,
          };

          setState((prev) => {
            const existingAgent = prev.agents[payload.agentId] || makeDefaultAgentState(payload.stage);
            const updatedAgent: AgentMonitorState = {
              ...existingAgent,
              currentStage: payload.stage,
              online: true,
              timeline: [...existingAgent.timeline.slice(-299), timelineEntry],
            };

            return {
              ...prev,
              snapshot: {
                ...prev.snapshot,
                currentStage: payload.stage,
              },
              timeline: [...prev.timeline.slice(-299), timelineEntry],
              agents: {
                ...prev.agents,
                [payload.agentId]: updatedAgent,
              },
            };
          });

          return;
        }

        if (isAgentLogMessage(payload)) {
          const timelineEntry: TimelineEntry = {
            stage: payload.stage,
            message: payload.message,
            time: new Date().toISOString(),
          };

          setState((prev) => {
            const existing = prev.stageLogs[payload.stage] || [];
            const nextLogsForStage = [...existing.slice(-119), payload.message];
            const existingAgent = prev.agents[payload.agentId] || makeDefaultAgentState(payload.stage);
            const nextAgentLogs = [...existingAgent.logs.slice(-119), payload.message];
            const nextAgentTimeline = [...existingAgent.timeline.slice(-299), timelineEntry];

            return {
              ...prev,
              stageLogs: {
                ...prev.stageLogs,
                [payload.stage]: nextLogsForStage,
              },
              timeline: [...prev.timeline.slice(-299), timelineEntry],
              agents: {
                ...prev.agents,
                [payload.agentId]: {
                  ...existingAgent,
                  currentStage: payload.stage,
                  logs: nextAgentLogs,
                  timeline: nextAgentTimeline,
                  online: true,
                },
              },
            };
          });

          return;
        }

        if (!isMonitorEnvelope(payload)) {
          return;
        }

        if (payload.kind === "snapshot" && payload.snapshot) {
          const nextSnapshot = payload.snapshot;
          setState((prev) => ({
            ...prev,
            snapshot: nextSnapshot,
          }));
          return;
        }

        if (payload.kind === "event" && payload.event) {
          const nextEvent = payload.event;
          setState((prev) => {
            const nextLogs = [...prev.logs.slice(-119), nextEvent];
            const nextState: MonitorState = {
              ...prev,
              logs: nextLogs,
            };

            if (nextEvent.type === "submission:success") {
              const rawJobId = nextEvent.payload?.jobId;
              const jobId =
                typeof rawJobId === "string" || typeof rawJobId === "number"
                  ? String(rawJobId)
                  : null;

              if (jobId) {
                const downloadUrl = `${downloadBaseUrl}/download/${encodeURIComponent(jobId)}`;
                const newJob: JobHistoryItem = {
                  jobId,
                  completedAt: nextEvent.timestamp,
                  downloadUrl,
                };

                nextState.jobs = [
                  newJob,
                  ...prev.jobs.filter((job) => job.jobId !== jobId),
                ].slice(0, 25);
              }
            }

            return nextState;
          });
        }
      };
    };

    connect();

    return () => {
      shouldReconnect = false;
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
      }
      socketRef.current?.close();
    };
  }, [wsUrl]);

  const sendControl = (action: ControlAction) => {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      return;
    }

    socket.send(
      JSON.stringify({
        type: "control",
        action,
      })
    );
  };

  const setActiveFile = (fileName: string) => {
    setState((prev) => {
      if (!prev.files.some((file) => file.name === fileName)) {
        return prev;
      }

      return {
        ...prev,
        activeFile: fileName,
      };
    });
  };

  const avgGenerationMs = useMemo(() => {
    const values = state.snapshot.generationDurationsMs;
    if (values.length === 0) return 0;
    return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
  }, [state.snapshot.generationDurationsMs]);

  const submissionSuccessRate = useMemo(() => {
    const total = state.snapshot.submissions.success + state.snapshot.submissions.error;
    if (total === 0) return 100;
    return Math.round((state.snapshot.submissions.success / total) * 100);
  }, [state.snapshot.submissions]);

  return {
    state,
    wsUrl,
    sendControl,
    setActiveFile,
    metrics: {
      totalJobs: state.snapshot.totalJobs,
      avgGenerationMs,
      submissionSuccessRate,
    },
  };
}

interface MonitorEnvelope {
  kind: "event" | "snapshot";
  event?: LifecycleEvent;
  snapshot?: MonitorSnapshot;
}

interface JobPreviewMessage {
  type: "job_preview";
  jobId: string;
  files: PreviewFile[];
}

interface StageUpdateMessage {
  type: "stage_update";
  agentId: string;
  stage: string;
}

interface AgentLogMessage {
  type: "agent_log";
  agentId: string;
  stage: string;
  message: string;
}

function isMonitorEnvelope(value: unknown): value is MonitorEnvelope {
  if (!value || typeof value !== "object") {
    return false;
  }

  const maybe = value as { kind?: unknown };
  return maybe.kind === "event" || maybe.kind === "snapshot";
}

function isJobPreviewMessage(value: unknown): value is JobPreviewMessage {
  if (!value || typeof value !== "object") {
    return false;
  }

  const maybe = value as { type?: unknown; files?: unknown };
  return maybe.type === "job_preview" && Array.isArray(maybe.files);
}

function isStageUpdateMessage(value: unknown): value is StageUpdateMessage {
  if (!value || typeof value !== "object") {
    return false;
  }

  const maybe = value as { type?: unknown; agentId?: unknown; stage?: unknown };
  return (
    maybe.type === "stage_update" &&
    typeof maybe.agentId === "string" &&
    typeof maybe.stage === "string"
  );
}

function isAgentLogMessage(value: unknown): value is AgentLogMessage {
  if (!value || typeof value !== "object") {
    return false;
  }

  const maybe = value as { type?: unknown; agentId?: unknown; stage?: unknown; message?: unknown };
  return (
    maybe.type === "agent_log" &&
    typeof maybe.agentId === "string" &&
    typeof maybe.stage === "string" &&
    typeof maybe.message === "string"
  );
}
