/**
 * Copyright (c) 2026 ByteDance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 *
 * Process-local registry that binds an active Feishu progress card
 * controller to the current OpenClaw session/run.
 */

import type { TaskProgressCardController } from './task-progress-controller';

const bySessionKey = new Map<string, TaskProgressCardController>();
const byRunId = new Map<string, TaskProgressCardController>();

export function registerProgressController(sessionKey: string | undefined, controller: TaskProgressCardController): void {
  if (!sessionKey) return;
  bySessionKey.set(sessionKey, controller);
}

export function bindProgressRun(sessionKey: string | undefined, runId: string | undefined): void {
  if (!sessionKey || !runId) return;
  const controller = bySessionKey.get(sessionKey);
  if (!controller) return;
  byRunId.set(runId, controller);
}

export function unregisterProgressController(sessionKey?: string, runId?: string): void {
  if (sessionKey) {
    const controller = bySessionKey.get(sessionKey);
    bySessionKey.delete(sessionKey);
    if (controller) {
      for (const [id, candidate] of byRunId.entries()) {
        if (candidate === controller) {
          byRunId.delete(id);
        }
      }
    }
  }

  if (runId) {
    byRunId.delete(runId);
  }
}

export function getProgressController(
  sessionKey?: string,
  runId?: string,
): TaskProgressCardController | null {
  if (runId && byRunId.has(runId)) {
    return byRunId.get(runId) ?? null;
  }

  if (sessionKey && bySessionKey.has(sessionKey)) {
    return bySessionKey.get(sessionKey) ?? null;
  }

  return null;
}
