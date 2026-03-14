"use client";

import { motion } from "framer-motion";

interface Props {
  totalJobs: number;
  avgGenerationMs: number;
  submissionSuccessRate: number;
}

export function MetricsPanel({ totalJobs, avgGenerationMs, submissionSuccessRate }: Props) {
  const cards = [
    { label: "Total Jobs", value: totalJobs.toString(), accent: "text-neon-cyan" },
    { label: "Avg Generation", value: `${(avgGenerationMs / 1000).toFixed(1)}s`, accent: "text-neon-lime" },
    { label: "Submission Success", value: `${submissionSuccessRate}%`, accent: "text-neon-pink" },
  ];

  return (
    <section className="grid gap-3 md:grid-cols-3">
      {cards.map((card, index) => (
        <motion.article
          key={card.label}
          initial={{ opacity: 0, y: -12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.05 * index }}
          className="glass-panel rounded-xl p-4"
        >
          <p className="text-xs uppercase tracking-[0.24em] text-slate-300/70">{card.label}</p>
          <p className={`mt-2 text-3xl font-[var(--font-orbitron)] ${card.accent}`}>{card.value}</p>
        </motion.article>
      ))}
    </section>
  );
}
