import { EventEmitter } from "events";
import Conf from "conf";
import PusherClient from "pusher-js";
import { SeedstrClient } from "../api/client.js";
import { getLLMClient } from "../llm/client.js";
import { getConfig, configStore } from "../config/index.js";
import { logger } from "../utils/logger.js";
import { buildProject, cleanupProject } from "../tools/projectBuilder.js";
import { AgentMonitorWsServer } from "../monitoring/wsServer.js";
import type {
  Job,
  AgentEvent,
  WebSocketJobEvent,
  AgentLifecycleEvent,
  AgentLifecycleEventName,
  DashboardControlAction,
} from "../types/index.js";

interface TypedEventEmitter {
  on(event: "event", listener: (event: AgentEvent) => void): this;
  emit(event: "event", data: AgentEvent): boolean;
}

const jobStore = new Conf<{ processedJobs: string[] }>({
  projectName: "seed-agent",
  projectVersion: "1.0.0",
  configName: "jobs",
  defaults: {
    processedJobs: [],
  },
});

export class AgentRunner extends EventEmitter implements TypedEventEmitter {
  private client: SeedstrClient;
  private running = false;
  private pollTimer: NodeJS.Timeout | null = null;
  private processingJobs: Set<string> = new Set();
  private processedJobs: Set<string>;
  private pusher: PusherClient | null = null;
  private wsConnected = false;
  private monitorServer: AgentMonitorWsServer | null = null;
  private pollingPaused = false;
  private stats = {
    jobsProcessed: 0,
    jobsSkipped: 0,
    errors: 0,
    startTime: Date.now(),
    totalPromptTokens: 0,
    totalCompletionTokens: 0,
    totalTokens: 0,
    totalCost: 0,
  };

  constructor() {
    super();
    this.client = new SeedstrClient();
    const stored = jobStore.get("processedJobs") || [];
    this.processedJobs = new Set(stored);
    logger.debug(`Loaded ${this.processedJobs.size} previously processed jobs`);
  }

  private markJobProcessed(jobId: string): void {
    this.processedJobs.add(jobId);

    const jobArray = Array.from(this.processedJobs);
    if (jobArray.length > 1000) {
      this.processedJobs = new Set(jobArray.slice(-1000));
    }

    jobStore.set("processedJobs", Array.from(this.processedJobs));
  }

  private emitEvent(event: AgentEvent): void {
    this.emit("event", event);
  }

  private emitLifecycleEvent(type: AgentLifecycleEventName, payload?: Record<string, unknown>): void {
    const event: AgentLifecycleEvent = {
      type,
      timestamp: new Date().toISOString(),
      payload,
    };

    this.emit(type, event);
    this.monitorServer?.applyLifecycleEvent(event);
  }

  private handleDashboardControl = (action: DashboardControlAction): void => {
    switch (action) {
      case "pause-polling":
        this.pausePolling();
        break;
      case "resume-polling":
        this.resumePolling();
        break;
      case "restart-agent":
        this.restart().catch((error) => {
          const message = error instanceof Error ? error.message : String(error);
          logger.error("Failed to restart agent from dashboard control:", message);
        });
        break;
    }
  };

  private connectWebSocket(): void {
    const config = getConfig();

    if (!config.useWebSocket || !config.pusherKey) {
      return;
    }

    const agentId = configStore.get("agentId");
    if (!agentId) {
      logger.warn("Agent ID not found — cannot subscribe to WebSocket channel");
      return;
    }

    try {
      this.pusher = new PusherClient(config.pusherKey, {
        cluster: config.pusherCluster,
        channelAuthorization: {
          endpoint: `${config.seedstrApiUrlV2}/pusher/auth`,
          transport: "ajax",
          headers: {
            Authorization: `Bearer ${config.seedstrApiKey}`,
          },
        },
      });

      this.pusher.connection.bind("connected", () => {
        this.wsConnected = true;
        this.emitEvent({ type: "websocket_connected" });
      });

      this.pusher.connection.bind("disconnected", () => {
        this.wsConnected = false;
        this.emitEvent({ type: "websocket_disconnected", reason: "disconnected" });
      });

      this.pusher.connection.bind("error", () => {
        this.wsConnected = false;
        this.emitEvent({ type: "websocket_disconnected", reason: "error" });
      });

      const channel = this.pusher.subscribe(`private-agent-${agentId}`);
      channel.bind("job:new", (data: WebSocketJobEvent) => {
        this.emitEvent({ type: "websocket_job", jobId: data.jobId });
        this.handleWebSocketJob(data);
      });
    } catch (error) {
      logger.error("Failed to initialize Pusher:", error);
    }
  }

  private disconnectWebSocket(): void {
    if (this.pusher) {
      this.pusher.disconnect();
      this.pusher = null;
      this.wsConnected = false;
    }
  }

  private async handleWebSocketJob(event: WebSocketJobEvent): Promise<void> {
    const config = getConfig();

    if (this.pollingPaused) {
      return;
    }

    if (this.processingJobs.has(event.jobId) || this.processedJobs.has(event.jobId)) {
      return;
    }

    if (this.processingJobs.size >= config.maxConcurrentJobs) {
      return;
    }

    const effectiveBudget = event.jobType === "SWARM" && event.budgetPerAgent
      ? event.budgetPerAgent
      : event.budget;

    if (effectiveBudget < config.minBudget) {
      this.markJobProcessed(event.jobId);
      this.stats.jobsSkipped++;
      return;
    }

    try {
      const job = await this.client.getJobV2(event.jobId);
      this.emitLifecycleEvent("job:detected", {
        jobId: job.id,
        budget: job.budget,
        jobType: job.jobType || "STANDARD",
      });
      this.emitEvent({ type: "job_found", job });

      if (job.jobType === "SWARM") {
        await this.acceptAndProcessSwarmJob(job);
      } else {
        this.processJob(job).catch((error) => {
          this.emitEvent({
            type: "error",
            message: `Failed to process job ${job.id}`,
            error: error instanceof Error ? error : new Error(String(error)),
          });
        });
      }
    } catch (error) {
      logger.error(`[WS] Failed to handle job ${event.jobId}:`, error);
      this.stats.errors++;
    }
  }

  async start(): Promise<void> {
    if (this.running) {
      return;
    }

    this.running = true;
    this.pollingPaused = false;
    this.stats.startTime = Date.now();
    this.emitEvent({ type: "startup" });
    this.emitLifecycleEvent("agent:started");

    const config = getConfig();
    if (config.dashboardWsEnabled && !this.monitorServer) {
      this.monitorServer = new AgentMonitorWsServer(
        config.dashboardWsHost,
        config.dashboardWsPort,
        this.handleDashboardControl
      );
      this.monitorServer.start();
      this.monitorServer.setOnline(true);
      this.monitorServer.setPaused(false);
    }

    this.connectWebSocket();
    await this.poll();
  }

  async stop(): Promise<void> {
    this.running = false;
    this.pollingPaused = false;

    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }

    this.disconnectWebSocket();

    if (this.monitorServer) {
      this.monitorServer.setOnline(false);
      this.monitorServer.stop();
      this.monitorServer = null;
    }

    this.emitEvent({ type: "shutdown" });
  }

  pausePolling(): void {
    this.pollingPaused = true;
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
    this.monitorServer?.setPaused(true);
  }

  resumePolling(): void {
    if (!this.running || !this.pollingPaused) {
      return;
    }

    this.pollingPaused = false;
    this.monitorServer?.setPaused(false);
    void this.poll();
  }

  async restart(): Promise<void> {
    await this.stop();
    await this.start();
  }

  private async poll(): Promise<void> {
    if (!this.running || this.pollingPaused) {
      return;
    }

    const config = getConfig();

    try {
      this.emitEvent({ type: "polling", jobCount: this.processingJobs.size });
      this.emitLifecycleEvent("agent:polling", {
        activeJobs: this.processingJobs.size,
      });

      const response = await this.client.listJobsV2(20, 0);

      for (const job of response.jobs) {
        if (this.processingJobs.has(job.id) || this.processedJobs.has(job.id)) {
          continue;
        }

        if (this.processingJobs.size >= config.maxConcurrentJobs) {
          break;
        }

        const effectiveBudget = job.jobType === "SWARM" && job.budgetPerAgent
          ? job.budgetPerAgent
          : job.budget;

        if (effectiveBudget < config.minBudget) {
          this.emitEvent({
            type: "job_skipped",
            job,
            reason: `Budget $${effectiveBudget} below minimum $${config.minBudget}`,
          });
          this.markJobProcessed(job.id);
          this.stats.jobsSkipped++;
          continue;
        }

        this.emitLifecycleEvent("job:detected", {
          jobId: job.id,
          budget: job.budget,
          jobType: job.jobType || "STANDARD",
        });
        this.emitEvent({ type: "job_found", job });

        if (job.jobType === "SWARM") {
          this.acceptAndProcessSwarmJob(job).catch((error) => {
            this.emitEvent({
              type: "error",
              message: `Failed to process swarm job ${job.id}`,
              error: error instanceof Error ? error : new Error(String(error)),
            });
          });
        } else {
          this.processJob(job).catch((error) => {
            this.emitEvent({
              type: "error",
              message: `Failed to process job ${job.id}`,
              error: error instanceof Error ? error : new Error(String(error)),
            });
          });
        }
      }
    } catch (error) {
      this.emitEvent({
        type: "error",
        message: "Failed to poll for jobs",
        error: error instanceof Error ? error : new Error(String(error)),
      });
      this.stats.errors++;
    }

    if (this.running && !this.pollingPaused) {
      const interval = this.wsConnected
        ? config.pollInterval * 3 * 1000
        : config.pollInterval * 1000;
      this.pollTimer = setTimeout(() => this.poll(), interval);
    }
  }

  private async acceptAndProcessSwarmJob(job: Job): Promise<void> {
    try {
      const result = await this.client.acceptJob(job.id);

      this.emitEvent({
        type: "job_accepted",
        job,
        budgetPerAgent: result.acceptance.budgetPerAgent,
      });

      await this.processJob(job, true);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);

      if (msg.includes("job_full") || msg.includes("All agent slots")) {
        this.markJobProcessed(job.id);
        this.stats.jobsSkipped++;
      } else if (!msg.includes("already accepted")) {
        throw error;
      }
    }
  }

  private async processJob(job: Job, useV2Submit = false): Promise<void> {
    this.processingJobs.add(job.id);
    this.emitEvent({ type: "job_processing", job });
    this.emitLifecycleEvent("generation:start", { jobId: job.id });
    const generationStartedAt = Date.now();

    try {
      const llm = getLLMClient();
      const generated = await llm.generateCode(job.prompt);
      const improved = await llm.reviewAndImprove(generated);

      this.emitEvent({
        type: "response_generated",
        job,
        preview: `Generated ${improved.files.length} files for React + Tailwind project`,
      });
      this.emitLifecycleEvent("generation:complete", {
        jobId: job.id,
        durationMs: Date.now() - generationStartedAt,
        hasProjectBuild: improved.files.length > 0,
      });

      this.emitLifecycleEvent("build:start", {
        jobId: job.id,
        fileCount: improved.files.length,
      });

      const projectName = `job-${job.id.slice(0, 8)}`;
      const buildResult = await buildProject(projectName, improved.files);

      if (!buildResult.success) {
        throw new Error(`Project build failed: ${buildResult.error || "unknown error"}`);
      }

      this.emitEvent({
        type: "project_built",
        job,
        files: buildResult.files,
        zipPath: buildResult.zipPath,
      });
      this.emitLifecycleEvent("build:complete", {
        jobId: job.id,
        fileCount: buildResult.files.length,
        zipPath: buildResult.zipPath,
      });

      this.emitLifecycleEvent("zip:start", {
        jobId: job.id,
        zipPath: buildResult.zipPath,
      });
      this.emitEvent({ type: "files_uploading", job, fileCount: 1 });

      const uploadedFile = await this.client.uploadFile(buildResult.zipPath);

      this.emitEvent({ type: "files_uploaded", job, files: [uploadedFile] });
      this.emitLifecycleEvent("zip:complete", {
        jobId: job.id,
        fileName: uploadedFile.name,
        fileSize: uploadedFile.size,
      });

      const responseContent = "Autonomous AI-generated web application responding to the prompt.";
      const submitResult = useV2Submit
        ? await this.client.submitResponseV2(job.id, responseContent, "FILE", [uploadedFile])
        : await this.client.submitResponse(job.id, responseContent);

      this.emitEvent({
        type: "response_submitted",
        job,
        responseId: submitResult.response.id,
        hasFiles: true,
      });
      this.emitLifecycleEvent("submission:success", {
        jobId: job.id,
        responseId: submitResult.response.id,
        hasFiles: true,
      });

      cleanupProject(buildResult.projectDir, buildResult.zipPath);
      this.stats.jobsProcessed++;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      if (errorMessage.includes("already submitted")) {
        logger.debug(`Already responded to job ${job.id}, skipping`);
      } else {
        this.emitLifecycleEvent("submission:error", {
          jobId: job.id,
          error: errorMessage,
        });
        this.emitEvent({
          type: "error",
          message: `Error processing job ${job.id}: ${errorMessage}`,
          error: error instanceof Error ? error : new Error(String(error)),
        });
        this.stats.errors++;
      }
    } finally {
      this.processingJobs.delete(job.id);
      this.markJobProcessed(job.id);
    }
  }

  getStats() {
    return {
      ...this.stats,
      uptime: Date.now() - this.stats.startTime,
      activeJobs: this.processingJobs.size,
      wsConnected: this.wsConnected,
      avgTokensPerJob: this.stats.jobsProcessed > 0
        ? Math.round(this.stats.totalTokens / this.stats.jobsProcessed)
        : 0,
      avgCostPerJob: this.stats.jobsProcessed > 0
        ? this.stats.totalCost / this.stats.jobsProcessed
        : 0,
    };
  }

  isRunning(): boolean {
    return this.running;
  }

  isPollingPaused(): boolean {
    return this.pollingPaused;
  }
}

export default AgentRunner;
