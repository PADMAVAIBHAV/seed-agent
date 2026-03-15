"use client";

import { useEffect, useState } from "react";
import { ActivityLog } from "../components/ActivityLog";
import { AgentGrid } from "../components/AgentGrid";
import { CodePreviewPanel } from "../components/CodePreviewPanel";
import { JobHistoryPanel } from "../components/JobHistoryPanel";
import { MetricsPanel } from "../components/MetricsPanel";
import { PipelineVisualization } from "../components/PipelineVisualization";
import { RadarScanner } from "../components/RadarScanner";
import { StageDetailsPanel } from "../components/StageDetailsPanel";
import { StatusPanel } from "../components/StatusPanel";
import { useAgentStream } from "../lib/useAgentStream";

export default function Home() {
  const { state, wsUrl, sendControl, setActiveFile, metrics } = useAgentStream();
  const [selectedStage, setSelectedStage] = useState<string | null>(null);
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);

  useEffect(() => {
    if (selectedAgentId && state.agents[selectedAgentId]) {
      return;
    }

    const firstAgentId = Object.keys(state.agents)[0];
    if (firstAgentId) {
      setSelectedAgentId(firstAgentId);
    }
  }, [state.agents, selectedAgentId]);

  const selectedAgent = selectedAgentId ? state.agents[selectedAgentId] : undefined;
  const selectedAgentStage = selectedAgent?.currentStage || state.snapshot.currentStage;

  useEffect(() => {
    if (selectedAgentStage) {
      setSelectedStage(selectedAgentStage);
    }
  }, [selectedAgentStage]);

  return (
    <main className="relative min-h-screen overflow-hidden px-4 py-6 md:px-8">
      <div className="cyber-grid pointer-events-none absolute inset-0 opacity-50" />

      <div className="relative mx-auto flex max-w-7xl flex-col gap-4">
        <StatusPanel
          online={selectedAgent?.online ?? state.snapshot.online}
          connected={state.connected}
          paused={state.snapshot.paused}
          currentStage={selectedAgentStage}
          lastProcessedJob={state.snapshot.lastProcessedJob}
          wsUrl={wsUrl}
          onPause={() => sendControl("pause-polling")}
          onResume={() => sendControl("resume-polling")}
          onRestart={() => sendControl("restart-agent")}
        />

        <AgentGrid
          agents={state.agents}
          selectedAgentId={selectedAgentId}
          onSelectAgent={setSelectedAgentId}
        />

        <MetricsPanel
          totalJobs={metrics.totalJobs}
          avgGenerationMs={metrics.avgGenerationMs}
          submissionSuccessRate={metrics.submissionSuccessRate}
        />

        <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
          <PipelineVisualization
            currentStage={selectedAgentStage}
            selectedStage={selectedStage}
            onStageSelect={setSelectedStage}
          />
          <RadarScanner />
        </div>

        <StageDetailsPanel
          selectedStage={selectedStage}
          logs={selectedAgent?.logs || []}
          timeline={(selectedAgent?.timeline || []).filter(
            (entry) => entry.stage === (selectedStage || "")
          )}
        />

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
