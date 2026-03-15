"use client";

import { ActivityLog } from "../components/ActivityLog";
import { CodePreviewPanel } from "../components/CodePreviewPanel";
import { JobHistoryPanel } from "../components/JobHistoryPanel";
import { MetricsPanel } from "../components/MetricsPanel";
import { PipelineVisualization } from "../components/PipelineVisualization";
import { RadarScanner } from "../components/RadarScanner";
import { StatusPanel } from "../components/StatusPanel";
import { useAgentStream } from "../lib/useAgentStream";

export default function Home() {
  const { state, wsUrl, sendControl, setActiveFile, metrics } = useAgentStream();

  return (
    <main className="relative min-h-screen overflow-hidden px-4 py-6 md:px-8">
      <div className="cyber-grid pointer-events-none absolute inset-0 opacity-50" />

      <div className="relative mx-auto flex max-w-7xl flex-col gap-4">
        <StatusPanel
          online={state.snapshot.online}
          connected={state.connected}
          paused={state.snapshot.paused}
          currentStage={state.snapshot.currentStage}
          lastProcessedJob={state.snapshot.lastProcessedJob}
          wsUrl={wsUrl}
          onPause={() => sendControl("pause-polling")}
          onResume={() => sendControl("resume-polling")}
          onRestart={() => sendControl("restart-agent")}
        />

        <MetricsPanel
          totalJobs={metrics.totalJobs}
          avgGenerationMs={metrics.avgGenerationMs}
          submissionSuccessRate={metrics.submissionSuccessRate}
        />

        <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
          <PipelineVisualization currentStage={state.snapshot.currentStage} />
          <RadarScanner />
        </div>

        <div className="grid gap-4 lg:grid-cols-[1fr_2fr]">
          <JobHistoryPanel jobs={state.jobs} />
          <CodePreviewPanel
            files={state.files}
            activeFile={state.activeFile}
            onSelectFile={setActiveFile}
          />
        </div>

        <ActivityLog events={state.logs} />
      </div>
    </main>
  );
}
