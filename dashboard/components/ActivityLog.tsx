"use client";

import { motion } from "framer-motion";
import type { LifecycleEvent } from "../lib/types";

const EVENT_COLORS: Record<string, string> = {
  "agent:started": "text-neon-lime",
  "agent:polling": "text-neon-cyan",
  "job:detected": "text-neon-cyan",
  "generation:start": "text-yellow-300",
  "generation:complete": "text-neon-lime",
  "build:start": "text-neon-pink",
  "build:complete": "text-neon-pink",
  "zip:start": "text-fuchsia-300",
  "zip:complete": "text-fuchsia-200",
  "submission:success": "text-emerald-300",
  "submission:error": "text-red-400",
};

export function ActivityLog({ events }: { events: LifecycleEvent[] }) {
  const recent = [...events].reverse().slice(0, 16);

  return (
    <section className="glass-panel rounded-2xl p-5">
      <p className="font-[var(--font-orbitron)] text-xs uppercase tracking-[0.3em] text-neon-cyan/80">
        Live Activity Log
      </p>
      <div className="mt-4 max-h-72 space-y-2 overflow-auto pr-2">
        {recent.length === 0 ? (
          <p className="text-sm text-slate-400">Waiting for stream data...</p>
        ) : (
          recent.map((event, index) => (
            (() => {
              const rawJobId = event.payload?.jobId;
              const jobId =
                typeof rawJobId === "string" || typeof rawJobId === "number"
                  ? String(rawJobId)
                  : null;

              return (
                <motion.div
                  key={`${event.timestamp}-${index}`}
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  className="flex flex-wrap items-center gap-2 rounded-lg border border-neon-cyan/20 bg-black/30 px-3 py-2 text-sm"
                >
                  <span className="text-xs text-slate-400">
                    {new Date(event.timestamp).toLocaleTimeString()}
                  </span>
                  <span className={EVENT_COLORS[event.type] || "text-slate-100"}>{event.type}</span>
                  {jobId && <span className="text-xs text-slate-300">job: {jobId}</span>}
                </motion.div>
              );
            })()
          ))
        )}
      </div>
    </section>
  );
}
