"use client";

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

export function PipelineVisualization({ currentStage }: { currentStage: string }) {
  return (
    <section className="glass-panel rounded-2xl p-5">
      <p className="font-[var(--font-orbitron)] text-xs uppercase tracking-[0.3em] text-neon-cyan/80">
        Pipeline
      </p>
      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
        {STAGES.map((stage, index) => {
          const active = currentStage === stage;
          return (
            <motion.div
              key={stage}
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.08 * index }}
              className={`relative rounded-xl border p-4 text-center ${
                active
                  ? "border-neon-lime bg-neon-lime/10 text-neon-lime shadow-glow"
                  : "border-neon-cyan/25 bg-black/25 text-slate-200"
              }`}
            >
              <p className="text-xs uppercase tracking-[0.2em]">{LABELS[stage]}</p>
              {active && (
                <motion.div
                  layoutId="activeStage"
                  className="pointer-events-none absolute inset-0 rounded-xl border border-neon-lime/60"
                />
              )}
            </motion.div>
          );
        })}
      </div>
    </section>
  );
}
