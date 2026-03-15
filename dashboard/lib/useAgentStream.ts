"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type {
  ControlAction,
  JobHistoryItem,
  LifecycleEvent,
  MonitorState,
  MonitorSnapshot,
  PreviewFile,
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

export function useAgentStream() {
  const [state, setState] = useState<MonitorState>({
    connected: false,
    snapshot: DEFAULT_SNAPSHOT,
    logs: [],
    jobs: [],
    files: [],
    activeFile: null,
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
        setState((prev) => ({ ...prev, connected: false }));
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
