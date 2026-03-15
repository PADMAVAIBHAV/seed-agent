"use client";

import { Fragment } from "react";
import { motion } from "framer-motion";

const STAGES = ["watcher", "brain", "critic", "builder", "packer", "submit"];
const LABELS: Record<string, string> = {
  watcher: "Watcher",
  brain: "Brain",
  critic: "Critic",
  builder: "Builder",
  packer: "Packer",
  submit: "Submit",
};

interface Props {
  currentStage: string;
  selectedStage?: string | null;
  onStageSelect?: (stage: string) => void;
}

export function PipelineVisualization({ currentStage, selectedStage, onStageSelect }: Props) {
  const activeStage = STAGES.includes(currentStage as (typeof STAGES)[number])
    ? currentStage
    : "watcher";
  const activeIndex = STAGES.indexOf(activeStage);

  return (
    <section className="glass-panel rounded-2xl p-5">
      <p className="font-[var(--font-orbitron)] text-xs uppercase tracking-[0.3em] text-neon-cyan/80">
        Pipeline
      </p>
      <div className="mt-4 flex items-center gap-2 overflow-x-auto pb-2">
        {STAGES.map((stage, index) => {
          const stageState =
            index < activeIndex ? "completed" : index === activeIndex ? "active" : "idle";
          const connectorState =
            index < activeIndex ? "completed" : index === activeIndex ? "active" : "idle";
          const isSelected = selectedStage === stage;

          return (
            <Fragment key={stage}>
              <motion.button
                type="button"
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.08 * index }}
                onClick={() => onStageSelect?.(stage)}
                className={`pipeline-stage pipeline-stage-${stageState} ${
                  isSelected ? "pipeline-stage-selected" : ""
                }`}
              >
                <p className="text-xs uppercase tracking-[0.2em]">{LABELS[stage]}</p>
              </motion.button>

              {index < STAGES.length - 1 && (
                <div
                  aria-hidden="true"
                  className={`pipeline-connector ${
                    connectorState === "active"
                      ? "active"
                      : connectorState === "completed"
                        ? "completed"
                        : ""
                  }`}
                />
              )}
            </Fragment>
          );
        })}
      </div>
    </section>
  );
}
