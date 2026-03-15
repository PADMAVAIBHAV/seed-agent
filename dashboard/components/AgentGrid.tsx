"use client";

import { motion } from "framer-motion";
import type { AgentMonitorState } from "../lib/types";

interface Props {
  agents: Record<string, AgentMonitorState>;
  selectedAgentId: string | null;
  onSelectAgent: (agentId: string) => void;
}

export function AgentGrid({ agents, selectedAgentId, onSelectAgent }: Props) {
  const entries = Object.entries(agents);

  return (
    <section className="glass-panel rounded-2xl p-5">
      <p className="font-[var(--font-orbitron)] text-xs uppercase tracking-[0.3em] text-neon-cyan/80">
        Active Agents
      </p>

      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {entries.length === 0 ? (
          <p className="text-sm text-slate-400">No agents connected yet.</p>
        ) : (
          entries.map(([agentId, agent], index) => {
            const selected = selectedAgentId === agentId;
            return (
              <motion.button
                key={agentId}
                type="button"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.03 * index }}
                onClick={() => onSelectAgent(agentId)}
                className={`rounded-xl border p-3 text-left transition ${
                  selected
                    ? "border-neon-lime/70 bg-neon-lime/10"
                    : "border-neon-cyan/25 bg-black/25 hover:border-neon-cyan/45"
                }`}
              >
                <p className="truncate text-sm font-semibold text-neon-cyan">{agentId}</p>
                <p className="mt-1 text-xs text-slate-300">
                  Stage: <span className="text-neon-lime">{agent.currentStage || "watcher"}</span>
                </p>
                <p className="mt-1 text-xs">
                  Status:{" "}
                  <span className={agent.online ? "text-emerald-300" : "text-rose-300"}>
                    {agent.online ? "ONLINE" : "OFFLINE"}
                  </span>
                </p>
              </motion.button>
            );
          })
        )}
      </div>
    </section>
  );
}
