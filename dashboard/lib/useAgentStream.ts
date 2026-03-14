"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { ControlAction, LifecycleEvent, MonitorState, MonitorSnapshot } from "./types";

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
  });

  const socketRef = useRef<WebSocket | null>(null);

  const wsUrl = useMemo(
    () => process.env.NEXT_PUBLIC_AGENT_WS_URL || "ws://localhost:7071",
    []
  );

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
        const payload = JSON.parse(event.data) as {
          kind: "event" | "snapshot";
          event?: LifecycleEvent;
          snapshot?: MonitorSnapshot;
        };

        if (payload.kind === "snapshot" && payload.snapshot) {
          setState((prev) => ({
            ...prev,
            snapshot: payload.snapshot as MonitorSnapshot,
          }));
          return;
        }

        if (payload.kind === "event" && payload.event) {
          setState((prev) => ({
            ...prev,
            logs: [...prev.logs.slice(-119), payload.event as LifecycleEvent],
          }));
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
    metrics: {
      totalJobs: state.snapshot.totalJobs,
      avgGenerationMs,
      submissionSuccessRate,
    },
  };
}
