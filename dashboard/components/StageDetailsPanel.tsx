"use client";

import { motion } from "framer-motion";
import type { TimelineEntry } from "../lib/types";

interface Props {
  selectedStage: string | null;
  logs: string[];
  timeline: TimelineEntry[];
}

export function StageDetailsPanel({ selectedStage, logs, timeline }: Props) {
  const stageLabel = (selectedStage || "watcher").toUpperCase();

  return (
    <section className="glass-panel rounded-2xl p-5">
      <p className="font-[var(--font-orbitron)] text-xs uppercase tracking-[0.3em] text-neon-cyan/80">
        Stage Details
      </p>

      <div className="mt-3 rounded-xl border border-neon-cyan/25 bg-black/30 px-3 py-2 text-sm text-slate-300">
        Stage: <span className="font-semibold text-neon-lime">{stageLabel}</span>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-neon-pink/30 bg-black/25 p-3">
          <h3 className="text-xs uppercase tracking-[0.2em] text-neon-pink">Timeline</h3>
          <div className="mt-3 max-h-72 space-y-2 overflow-auto pr-1">
            {timeline.length === 0 ? (
              <p className="text-sm text-slate-400">No timeline entries yet for this stage.</p>
            ) : (
              timeline.map((entry, index) => (
                <motion.div
                  key={`${entry.time}-${index}`}
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  className="rounded-lg border border-neon-cyan/20 bg-black/35 px-3 py-2 text-sm"
                >
                  <p className="text-xs text-slate-400">{new Date(entry.time).toLocaleTimeString()}</p>
                  <p className="text-slate-100">{entry.message}</p>
                </motion.div>
              ))
            )}
          </div>
        </div>

        <div className="rounded-xl border border-neon-cyan/30 bg-black/25 p-3">
          <h3 className="text-xs uppercase tracking-[0.2em] text-neon-cyan">Logs</h3>
          <div className="mt-3 max-h-72 space-y-2 overflow-auto pr-1">
            {logs.length === 0 ? (
              <p className="text-sm text-slate-400">No logs yet for this stage.</p>
            ) : (
              logs.map((log, index) => (
                <motion.div
                  key={`${index}-${log.slice(0, 24)}`}
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  className="rounded-lg border border-neon-lime/25 bg-black/35 px-3 py-2 text-sm"
                >
                  <span className="text-neon-lime">[INFO]</span> <span className="text-slate-100">{log}</span>
                </motion.div>
              ))
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
