"use client";

import { motion } from "framer-motion";
import type { JobHistoryItem } from "../lib/types";

interface Props {
  jobs: JobHistoryItem[];
}

export function JobHistoryPanel({ jobs }: Props) {
  return (
    <section className="glass-panel rounded-2xl p-5">
      <p className="font-[var(--font-orbitron)] text-xs uppercase tracking-[0.3em] text-neon-cyan/80">
        Recent Jobs
      </p>

      <div className="mt-4 max-h-80 space-y-2 overflow-auto pr-2">
        {jobs.length === 0 ? (
          <p className="text-sm text-slate-400">No completed jobs yet.</p>
        ) : (
          jobs.map((job, index) => (
            <motion.div
              key={job.jobId}
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.03 * index }}
              className="flex items-center justify-between gap-3 rounded-lg border border-neon-cyan/25 bg-black/30 px-3 py-2"
            >
              <div className="min-w-0">
                <p className="truncate text-sm text-neon-lime">{job.jobId}</p>
                <p className="text-xs text-slate-400">
                  Completed {new Date(job.completedAt).toLocaleTimeString()}
                </p>
              </div>

              <a
                href={job.downloadUrl}
                target="_blank"
                rel="noreferrer"
                className="shrink-0 rounded-lg border border-neon-cyan/40 bg-neon-cyan/15 px-3 py-1.5 text-xs font-semibold text-neon-cyan hover:bg-neon-cyan/25"
              >
                Download
              </a>
            </motion.div>
          ))
        )}
      </div>
    </section>
  );
}
