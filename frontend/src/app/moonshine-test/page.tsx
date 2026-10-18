"use client";

/**
 * /moonshine-test — isolated feasibility test for
 * @moonshine-ai/moonshine-wasm.
 *
 * This route is intentionally NOT linked from the CallFlow workflow and does
 * not touch the existing record → upload → Gemini transcription path. It only
 * demonstrates that Moonshine can capture the microphone and transcribe
 * locally in a cross-origin-isolated tab.
 */

import React, {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

// MicTranscriber needs a streaming architecture; the non-streaming Tiny/Base
// models are only usable through Transcriber.transcribe(buffer).
type ArchName = "TinyStreaming" | "SmallStreaming" | "MediumStreaming";

type MoonshineModule = typeof import("@moonshine-ai/moonshine-wasm");

type MicHandle = {
  stop: () => Promise<void>;
  close: () => void;
};

const MODEL_LABELS: Record<ArchName, string> = {
  TinyStreaming: "Tiny Streaming (~51 MB)",
  SmallStreaming: "Small Streaming (~165 MB)",
  MediumStreaming: "Medium Streaming (~305 MB, package default)",
};

export default function MoonshineTestPage() {
  const [arch, setArch] = useState<ArchName>("TinyStreaming");
  const [running, setRunning] = useState(false);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [progressFile, setProgressFile] = useState("");
  const [liveText, setLiveText] = useState("");
  const [lines, setLines] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  // Read the cross-origin-isolation flag without a setState-in-effect (which
  // would also desync the server render from the client).
  const isolated = useSyncExternalStore(
    () => () => {},
    () => typeof window !== "undefined" && window.crossOriginIsolated === true,
    () => null
  );
  const [useLocalModel, setUseLocalModel] = useState(false);
  const [elapsed, setElapsed] = useState(0);

  const micRef = useRef<MicHandle | null>(null);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      micRef.current?.stop().catch(() => {});
      micRef.current?.close();
    };
  }, []);

  const handleStart = useCallback(async () => {
    setError(null);
    setLoading(true);
    setLiveText("");
    setLines([]);
    setProgress(0);
    setProgressFile("");
    const startedAt = performance.now();

    try {
      // Load the binding as a native browser module. It is copied verbatim to
      // /moonshine-wasm by scripts/copy-moonshine.mjs: Turbopack cannot bundle
      // Emscripten's Node-only imports or the 13 MB .wasm.
      const moduleUrl = "/moonshine-wasm/index.js";
      console.log("[moonshine-test] importing binding");
      const { MicTranscriber, ModelArch } = (await import(
        /* turbopackIgnore: true */ moduleUrl
      )) as MoonshineModule;
      console.log("[moonshine-test] binding imported");

      const mic = new MicTranscriber().modelArch(ModelArch[arch]);
      if (useLocalModel && arch === "TinyStreaming") {
        // Files downloaded once into public/models/tiny-streaming (gitignored).
        mic.modelsFrom("/models/tiny-streaming/");
      }
      mic
        .onProgress((fraction, file) => {
          setProgress(fraction);
          setProgressFile(file);
        })
        .onText((text) => setLiveText(text))
        .onLine((line) => {
          console.log(
            `[moonshine-test] line at ${Math.round(performance.now() - startedAt)}ms:`,
            line.text
          );
          setLines((prev) => [...prev, line.text]);
        })
        .onError((err) => setError(err.message));

      console.log("[moonshine-test] mic.load() start");
      await mic.load();
      console.log(
        `[moonshine-test] mic.load() done at ${Math.round(performance.now() - startedAt)}ms`
      );
      await mic.start();
      console.log(
        `[moonshine-test] mic.start() done at ${Math.round(performance.now() - startedAt)}ms`
      );

      micRef.current = {
        stop: () => mic.stop(),
        close: () => mic.close(),
      };
      setRunning(true);
      setElapsed(0);
      timerRef.current = setInterval(() => setElapsed((s) => s + 1), 1000);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [arch, useLocalModel]);

  const handleStop = useCallback(async () => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
    try {
      await micRef.current?.stop();
      micRef.current?.close();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      micRef.current = null;
      setRunning(false);
    }
  }, []);

  return (
    <main className="mx-auto max-w-3xl space-y-5 p-6">
      <header>
        <h1 className="text-lg font-bold text-white">
          Moonshine WASM — microphone test
        </h1>
        <p className="mt-1 text-xs text-slate-400">
          Isolated feasibility route. Audio is processed by the WASM module in
          this tab and is never uploaded to the CallFlow backend.
        </p>
      </header>

      <section className="rounded border border-[#233554] bg-[#0b132b] p-4 text-xs text-slate-300">
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2">
            <span>Model</span>
            <select
              value={arch}
              disabled={running || loading}
              onChange={(e) => setArch(e.target.value as ArchName)}
              className="rounded border border-[#233554] bg-[#070d1e] px-2 py-1 text-xs"
            >
              {Object.entries(MODEL_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-1.5">
            <input
              type="checkbox"
              checked={useLocalModel}
              disabled={running || loading || arch !== "TinyStreaming"}
              onChange={(e) => setUseLocalModel(e.target.checked)}
            />
            <span>Local model files</span>
          </label>
          {!running ? (
            <button
              type="button"
              disabled={loading}
              onClick={handleStart}
              className="rounded bg-[#0062ff] px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
            >
              {loading ? "Loading model…" : "Request mic & start"}
            </button>
          ) : (
            <button
              type="button"
              onClick={handleStop}
              className="rounded border border-rose-500/40 bg-rose-950/30 px-3 py-1.5 text-xs font-semibold text-rose-300"
            >
              Stop
            </button>
          )}
          <span className="text-slate-400">
            crossOriginIsolated:{" "}
            <strong className={isolated ? "text-emerald-400" : "text-rose-400"}>
              {String(isolated)}
            </strong>
          </span>
          {running && (
            <span className="font-mono text-rose-400">REC {elapsed}s</span>
          )}
        </div>

        {(loading || progress > 0) && (
          <div className="mt-3 space-y-1">
            <div className="h-1.5 w-full overflow-hidden rounded bg-[#070d1e]">
              <div
                className="h-full bg-[#0062ff] transition-all"
                style={{ width: `${Math.round(progress * 100)}%` }}
              />
            </div>
            <p className="text-[10px] text-slate-500">
              {Math.round(progress * 100)}% {progressFile}
            </p>
          </div>
        )}

        {error && (
          <p className="mt-3 rounded border border-rose-500/30 bg-rose-950/20 p-2 text-rose-300">
            {error}
          </p>
        )}
      </section>

      <section className="rounded border border-[#233554] bg-[#0b132b] p-4">
        <h2 className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
          Live text
        </h2>
        <p className="mt-2 min-h-6 text-sm text-white">{liveText || "—"}</p>
      </section>

      <section className="rounded border border-[#233554] bg-[#0b132b] p-4">
        <h2 className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
          Finalized lines
        </h2>
        {lines.length === 0 ? (
          <p className="mt-2 text-xs text-slate-500">No lines yet.</p>
        ) : (
          <ol className="mt-2 list-decimal space-y-1 pl-5 text-xs text-slate-200">
            {lines.map((line, i) => (
              <li key={i}>{line}</li>
            ))}
          </ol>
        )}
      </section>

      <p className="text-[10px] text-slate-500">
        The first run downloads model files from download.moonshine.ai; they are
        cached by the browser for later runs. Microphone audio never leaves this
        page.
      </p>
    </main>
  );
}
