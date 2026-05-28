// Hybrid backtest-job watcher: WebSocket push (happy path) + slow polling
// safety net. Whichever resolves first wins.
//
// Why both: the WS path delivers completion in <1s and works for jobs that
// run far longer than any reasonable poll budget (10yr × all-stocks
// backtests). Polling stays as a tripwire so the run still succeeds if the
// WS connection drops, the auth token misroutes, or the broadcast race-
// conditions with backend dispatch.

import type { BacktestJobStatus } from "@/lib/api/strategies";

interface WsTokenResponse {
  token: string;
  ws_url: string;
  expires_in: number;
}

interface JobUpdateMessage {
  type: "job_update";
  job_kind: "backtest";
  job_id: string;
  status: "completed" | "failed";
  strategy_id: number;
  backtest_id?: number;
  error?: string;
}

// Slow-poll cadence: 5s × 60 attempts = 5-minute fallback budget. The WS
// path should resolve well before this for any normal-shaped backtest.
const POLL_INTERVAL_MS = 5000;
const POLL_MAX_ATTEMPTS = 60;
const POLL_MAX_CONSECUTIVE_FAILURES = 4;

export async function watchBacktestJob(
  stratId: number,
  jobId: string,
): Promise<BacktestJobStatus> {
  const controller = new AbortController();

  const wsPromise = openWsAndAwait(stratId, jobId, controller.signal).catch(
    (err) => {
      // WS failures fall through to polling — don't reject the race.
      console.warn("backtest WS watcher failed, polling will handle it:", err);
      return new Promise<BacktestJobStatus>(() => {});
    },
  );

  const pollPromise = slowPoll(stratId, jobId, controller.signal);

  try {
    const winner = await Promise.race([wsPromise, pollPromise]);
    return winner;
  } finally {
    controller.abort();
  }
}

async function openWsAndAwait(
  stratId: number,
  jobId: string,
  signal: AbortSignal,
): Promise<BacktestJobStatus> {
  const tokenRes = await fetch("/api/auth/ws-token", {
    cache: "no-store",
    signal,
  });
  if (!tokenRes.ok) {
    throw new Error(`ws-token fetch failed (${tokenRes.status})`);
  }
  const { token, ws_url } = (await tokenRes.json()) as WsTokenResponse;

  const url = `${ws_url}?token=${encodeURIComponent(token)}`;
  const ws = new WebSocket(url);

  const onAbort = () => {
    try {
      ws.close();
    } catch {}
  };
  signal.addEventListener("abort", onAbort);

  try {
    return await new Promise<BacktestJobStatus>((resolve, reject) => {
      ws.onmessage = (ev) => {
        let msg: JobUpdateMessage;
        try {
          msg = JSON.parse(ev.data as string) as JobUpdateMessage;
        } catch {
          return;
        }
        if (
          msg.type !== "job_update" ||
          msg.job_kind !== "backtest" ||
          msg.job_id !== jobId
        ) {
          return;
        }
        if (msg.status === "completed" || msg.status === "failed") {
          resolve({
            status: msg.status,
            strategy_id: msg.strategy_id ?? stratId,
            job_id: msg.job_id,
            backtest_id: msg.backtest_id ?? null,
            error: msg.error ?? null,
          });
        }
      };
      ws.onerror = () => reject(new Error("WebSocket error"));
      ws.onclose = (ev) => {
        if (!ev.wasClean) reject(new Error(`WS closed (${ev.code})`));
      };
    });
  } finally {
    signal.removeEventListener("abort", onAbort);
    try {
      ws.close();
    } catch {}
  }
}

async function slowPoll(
  stratId: number,
  jobId: string,
  signal: AbortSignal,
): Promise<BacktestJobStatus> {
  let consecutiveFailures = 0;
  let lastError = "Poll failed";

  for (let i = 0; i < POLL_MAX_ATTEMPTS; i++) {
    await sleep(POLL_INTERVAL_MS, signal);
    if (signal.aborted) throw new DOMException("aborted", "AbortError");

    let transient = false;
    try {
      const res = await fetch(
        `/api/strategies/${stratId}/backtest/job/${jobId}`,
        { signal },
      );
      if (!res.ok) {
        if (res.status >= 400 && res.status < 500) {
          throw new Error(`Poll failed (${res.status})`);
        }
        lastError = `Poll failed (${res.status})`;
        transient = true;
      } else {
        consecutiveFailures = 0;
        const status = (await res.json()) as BacktestJobStatus;
        if (status.status === "completed" || status.status === "failed") {
          return status;
        }
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") throw err;
      if (err instanceof Error && /^Poll failed \(4/.test(err.message)) {
        throw err;
      }
      lastError = err instanceof Error ? err.message : "Poll failed";
      transient = true;
    }

    if (transient) {
      consecutiveFailures += 1;
      if (consecutiveFailures >= POLL_MAX_CONSECUTIVE_FAILURES) {
        throw new Error(lastError);
      }
    }
  }

  throw new Error("Backtest taking longer than expected — try again later.");
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException("aborted", "AbortError"));
      return;
    }
    const t = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(t);
      reject(new DOMException("aborted", "AbortError"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}
