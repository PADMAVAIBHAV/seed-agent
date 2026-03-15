"use client";

import { motion } from "framer-motion";
import type { PreviewFile } from "../lib/types";

interface Props {
  files: PreviewFile[];
  activeFile: string | null;
  onSelectFile: (name: string) => void;
}

export function CodePreviewPanel({ files, activeFile, onSelectFile }: Props) {
  const selected = files.find((file) => file.name === activeFile) ?? files[0] ?? null;

  return (
    <section className="glass-panel rounded-2xl p-5">
      <p className="font-[var(--font-orbitron)] text-xs uppercase tracking-[0.3em] text-neon-cyan/80">
        Code Preview
      </p>

      {files.length === 0 ? (
        <p className="mt-4 text-sm text-slate-400">Waiting for a job preview event...</p>
      ) : (
        <div className="mt-4 grid gap-3 lg:grid-cols-[220px_1fr]">
          <div className="max-h-80 space-y-2 overflow-auto rounded-xl border border-neon-pink/25 bg-black/25 p-2">
            {files.map((file, index) => {
              const isActive = file.name === selected?.name;
              return (
                <motion.button
                  key={file.name}
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.02 * index }}
                  onClick={() => onSelectFile(file.name)}
                  className={`w-full rounded-lg px-3 py-2 text-left text-sm transition ${
                    isActive
                      ? "border border-neon-lime/50 bg-neon-lime/15 text-neon-lime"
                      : "border border-neon-cyan/20 bg-black/30 text-slate-200 hover:border-neon-cyan/40 hover:text-neon-cyan"
                  }`}
                >
                  <span className="block truncate">{file.name}</span>
                </motion.button>
              );
            })}
          </div>

          <div className="overflow-hidden rounded-xl border border-neon-cyan/30 bg-black/35">
            <div className="border-b border-neon-cyan/20 px-3 py-2 text-xs text-neon-cyan">
              {selected?.name || "No file selected"}
            </div>
            <pre className="max-h-80 overflow-auto p-3 text-xs leading-relaxed text-slate-200">
              <code>{selected?.content || ""}</code>
            </pre>
          </div>
        </div>
      )}
    </section>
  );
}
