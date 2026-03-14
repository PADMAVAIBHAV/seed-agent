"use client";

import { motion } from "framer-motion";

export function RadarScanner() {
  return (
    <section className="glass-panel pink-panel rounded-2xl p-5">
      <p className="font-[var(--font-orbitron)] text-xs uppercase tracking-[0.3em] text-neon-pink/80">
        Radar Scanner
      </p>
      <div className="relative mx-auto mt-6 h-56 w-56 rounded-full border border-neon-cyan/40 bg-black/30">
        <div className="absolute inset-4 rounded-full border border-neon-cyan/20" />
        <div className="absolute inset-10 rounded-full border border-neon-cyan/20" />
        <div className="absolute inset-16 rounded-full border border-neon-cyan/20" />

        <motion.div
          className="absolute left-1/2 top-1/2 h-[2px] w-1/2 origin-left bg-gradient-to-r from-neon-cyan to-transparent"
          animate={{ rotate: 360 }}
          transition={{ duration: 2.2, repeat: Infinity, ease: "linear" }}
          style={{ transformOrigin: "left center" }}
        />

        <motion.div
          className="absolute left-1/2 top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-neon-pink"
          animate={{ boxShadow: ["0 0 8px #FF2EC4", "0 0 18px #2EE6FF", "0 0 8px #FF2EC4"] }}
          transition={{ duration: 1.8, repeat: Infinity }}
        />
      </div>
      <p className="mt-4 text-center text-sm text-slate-300/75">Scanning incoming prompts in real time...</p>
    </section>
  );
}
