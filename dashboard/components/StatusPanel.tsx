"use client";

import { motion } from "framer-motion";

interface Props {
  online: boolean;
  connected: boolean;
  paused: boolean;
  currentStage: string;
  lastProcessedJob: string | null;
  wsUrl: string;
  onPause: () => void;
  onResume: () => void;
  onRestart: () => void;
}

export function StatusPanel(props: Props) {
  const {
    online,
    connected,
    paused,
    currentStage,
    lastProcessedJob,
    wsUrl,
    onPause,
    onResume,
    onRestart,
  } = props;

  return (
    <motion.section
      initial={{ opacity: 0, y: -14 }}
      animate={{ opacity: 1, y: 0 }}
      className="glass-panel rounded-2xl p-5"
    >
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="font-[var(--font-orbitron)] text-xs uppercase tracking-[0.3em] text-neon-cyan/80">
            Agent Status
          </p>
          <h2 className="mt-2 text-xl font-bold text-neon-cyan">Seed Agent Online Monitor</h2>
          <p className="text-sm text-slate-200/70">WS endpoint: {wsUrl}</p>
        </div>

        <div className="flex items-center gap-3 text-sm">
          <Badge label={online ? "ONLINE" : "OFFLINE"} color={online ? "lime" : "pink"} />
          <Badge label={connected ? "STREAM LIVE" : "DISCONNECTED"} color={connected ? "cyan" : "pink"} />
          <Badge label={paused ? "POLLING PAUSED" : "POLLING ACTIVE"} color={paused ? "pink" : "cyan"} />
        </div>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-[1fr_auto]">
        <div className="rounded-xl border border-neon-cyan/25 bg-black/30 p-3 text-sm">
          <p className="text-slate-300">Current stage: <span className="text-neon-lime">{currentStage || "idle"}</span></p>
          <p className="text-slate-300">Last processed job: <span className="text-neon-lime">{lastProcessedJob || "none"}</span></p>
        </div>

        <div className="flex flex-wrap gap-2">
          <button onClick={paused ? onResume : onPause} className="rounded-lg border border-neon-cyan/40 bg-neon-cyan/15 px-3 py-2 text-sm text-neon-cyan hover:bg-neon-cyan/25">
            {paused ? "Resume Polling" : "Pause Polling"}
          </button>
          <button onClick={onRestart} className="rounded-lg border border-neon-pink/45 bg-neon-pink/15 px-3 py-2 text-sm text-neon-pink hover:bg-neon-pink/25">
            Restart Agent
          </button>
        </div>
      </div>
    </motion.section>
  );
}

function Badge({ label, color }: { label: string; color: "cyan" | "pink" | "lime" }) {
  const className =
    color === "cyan"
      ? "border-neon-cyan/45 text-neon-cyan"
      : color === "lime"
      ? "border-neon-lime/45 text-neon-lime"
      : "border-neon-pink/45 text-neon-pink";

  return <span className={`rounded-full border px-3 py-1 text-xs font-bold ${className}`}>{label}</span>;
}
