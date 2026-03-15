import { WebSocketServer, WebSocket } from "ws";
import type {
  AgentLifecycleEvent,
  DashboardControlMessage,
  DashboardControlAction,
} from "../types/index.js";
import { logger } from "../utils/logger.js";

interface MonitorSnapshot {
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

interface MonitorOutboundMessage {
  kind: "event" | "snapshot";
  event?: AgentLifecycleEvent;
  snapshot?: MonitorSnapshot;
}

interface StageUpdateMessage {
  type: "stage_update";
  stage: "watcher" | "brain" | "critic" | "builder" | "packer" | "submit";
}

function isControlMessage(data: unknown): data is DashboardControlMessage {
  if (!data || typeof data !== "object") {
    return false;
  }

  const maybe = data as Record<string, unknown>;
  if (maybe.type !== "control") {
    return false;
  }

  return (
    maybe.action === "pause-polling" ||
    maybe.action === "resume-polling" ||
    maybe.action === "restart-agent"
  );
}

export class AgentMonitorWsServer {
  private wss: WebSocketServer | null = null;
  private readonly port: number;
  private readonly onControl: (action: DashboardControlAction) => void;

  private snapshot: MonitorSnapshot = {
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

  constructor(port: number, onControl: (action: DashboardControlAction) => void) {
    this.port = port;
    this.onControl = onControl;
  }

  start(): void {
    if (this.wss) {
      return;
    }

    const port = Number(process.env.PORT || process.env.DASHBOARD_WS_PORT || this.port || 7071);

    this.wss = new WebSocketServer({
      port,
    });

    this.wss.on("connection", (socket) => this.handleConnection(socket));

    this.wss.on("listening", () => {
      logger.info(`Monitoring WebSocket listening on port ${port}`);
    });

    this.wss.on("error", (error) => {
      const err = error as NodeJS.ErrnoException;
      if (err.code === "EADDRINUSE") {
        logger.warn(`Monitoring WebSocket disabled: port ${port} is already in use`);
        this.wss?.close();
        this.wss = null;
        return;
      }

      logger.error("Monitoring WebSocket error:", error);
    });
  }

  stop(): void {
    if (!this.wss) {
      return;
    }

    for (const client of this.wss.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.close();
      }
    }

    this.wss.close();
    this.wss = null;
    this.snapshot.online = false;
  }

  setOnline(online: boolean): void {
    this.snapshot.online = online;
    this.broadcastSnapshot();
  }

  setPaused(paused: boolean): void {
    this.snapshot.paused = paused;
    this.broadcastSnapshot();
  }

  broadcastStageUpdate(stage: StageUpdateMessage["stage"]): void {
    this.snapshot.currentStage = stage;
    this.broadcast({ type: "stage_update", stage });
    this.broadcastSnapshot();
  }

  applyLifecycleEvent(event: AgentLifecycleEvent): void {
    switch (event.type) {
      case "agent:started":
        this.snapshot.online = true;
        this.snapshot.currentStage = "watcher";
        break;
      case "agent:polling":
        this.snapshot.currentStage = "watcher";
        break;
      case "job:detected":
        this.snapshot.currentStage = "brain";
        if (typeof event.payload?.jobId === "string") {
          this.snapshot.lastProcessedJob = event.payload.jobId;
        }
        break;
      case "generation:start":
        this.snapshot.currentStage = "brain";
        break;
      case "generation:complete":
        this.snapshot.currentStage = "critic";
        if (typeof event.payload?.durationMs === "number") {
          this.snapshot.generationDurationsMs.push(event.payload.durationMs);
          if (this.snapshot.generationDurationsMs.length > 200) {
            this.snapshot.generationDurationsMs.shift();
          }
        }
        break;
      case "build:start":
        this.snapshot.currentStage = "builder";
        break;
      case "build:complete":
        this.snapshot.currentStage = "builder";
        break;
      case "zip:start":
        this.snapshot.currentStage = "packer";
        break;
      case "zip:complete":
        this.snapshot.currentStage = "packer";
        break;
      case "submission:success":
        this.snapshot.currentStage = "submit";
        this.snapshot.totalJobs += 1;
        this.snapshot.submissions.success += 1;
        break;
      case "submission:error":
        this.snapshot.currentStage = "submit";
        this.snapshot.submissions.error += 1;
        break;
    }

    this.broadcast({ kind: "event", event });
    this.broadcastSnapshot();
  }

  private handleConnection(socket: WebSocket): void {
    this.send(socket, {
      kind: "snapshot",
      snapshot: this.snapshot,
    });

    socket.on("message", (raw) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw.toString());
      } catch {
        return;
      }

      if (!isControlMessage(parsed)) {
        return;
      }

      this.onControl(parsed.action);
    });
  }

  private broadcastSnapshot(): void {
    this.broadcast({ kind: "snapshot", snapshot: this.snapshot });
  }

  private broadcast(message: MonitorOutboundMessage | StageUpdateMessage): void {
    if (!this.wss) {
      return;
    }

    for (const client of this.wss.clients) {
      if (client.readyState === WebSocket.OPEN) {
        this.send(client, message);
      }
    }
  }

  private send(socket: WebSocket, message: MonitorOutboundMessage | StageUpdateMessage): void {
    try {
      socket.send(JSON.stringify(message));
    } catch (error) {
      logger.debug("Failed to send monitor payload", error);
    }
  }
}

export default AgentMonitorWsServer;
