/**
 * Copyright (c) 2026 ByteDance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 *
 * Progress-only Feishu card controller.
 *
 * This controller is separate from the final reply card. It exists to
 * acknowledge the message immediately and keep a compact progress view
 * updated throughout the run.
 */

import type { ClawdbotConfig } from 'openclaw/plugin-sdk';
import { larkLogger } from '../core/lark-logger';
import { sendCardFeishu, updateCardFeishu } from '../messaging/outbound/send';
import { FlushController } from './flush-controller';
import { buildTaskProgressCard } from './task-progress-builder';
import type {
  TaskExecutionStage,
  TaskProgressNode,
  TaskProgressNodeKind,
  TaskProgressState,
} from './task-progress-builder';

const log = larkLogger('card/task-progress');
const PATCH_THROTTLE_MS = 1200;

interface TaskProgressCardDeps {
  cfg: ClawdbotConfig;
  sessionKey: string;
  chatId: string;
  replyToMessageId: string;
  accountId?: string;
  replyInThread?: boolean;
}

type NodeInput =
  | string
  | {
      summary: string;
      details?: string[];
    };

export class TaskProgressCardController {
  readonly deps: TaskProgressCardDeps;
  private readonly state: TaskProgressState = {
    execution: {
      stage: 'received',
      message: '已接收请求，准备开始处理',
      startedAt: Date.now(),
      updatedAt: Date.now(),
    },
    currentNode: null,
  };
  private cardMessageId: string | null = null;
  private readonly flush: FlushController;
  private disposed = false;

  constructor(deps: TaskProgressCardDeps) {
    this.deps = deps;
    this.flush = new FlushController(async () => {
      if (!this.cardMessageId || this.disposed) return;
      await updateCardFeishu({
        cfg: this.deps.cfg,
        messageId: this.cardMessageId,
        card: buildTaskProgressCard(this.state),
        accountId: this.deps.accountId,
      });
    });
  }

  async ensureCardCreated(): Promise<void> {
    if (this.cardMessageId || this.disposed) return;

    const result = await sendCardFeishu({
      cfg: this.deps.cfg,
      to: this.deps.chatId,
      card: buildTaskProgressCard(this.state),
      replyToMessageId: this.deps.replyToMessageId,
      replyInThread: this.deps.replyInThread,
      accountId: this.deps.accountId,
    });

    this.cardMessageId = result.messageId;
    this.flush.setCardMessageReady(true);
    log.info('progress card created', {
      sessionKey: this.deps.sessionKey,
      messageId: this.cardMessageId,
    });
  }

  get messageId(): string | null {
    return this.cardMessageId;
  }

  async setExecution(stage: TaskExecutionStage, message?: string): Promise<void> {
    if (this.disposed) return;

    this.state.execution = {
      ...this.state.execution,
      stage,
      message: message?.trim() || this.state.execution.message,
      updatedAt: Date.now(),
    };

    await this.scheduleUpdate();
  }

  async ingestPlannerTodos(todos: unknown[]): Promise<void> {
    if (this.disposed || !Array.isArray(todos) || todos.length === 0) return;
    await this.pushNode('status', `执行编排已更新：${String(todos.length)} 项`);
  }

  async handleToolStart(toolName: string, params: Record<string, unknown>): Promise<void> {
    if (this.disposed) return;

    if (toolName === 'TodoWrite') {
      await this.setExecution('planning', '正在更新执行编排');
      return;
    }

    await this.setExecution('executing', `正在调用工具：${humanizeToolName(toolName)}`);
    await this.pushNode('tool', buildToolCallNode(toolName, params));
  }

  async handleSkillStart(skillName: string): Promise<void> {
    if (this.disposed) return;
    await this.setExecution('executing', `正在加载 skill：${skillName}`);
    await this.pushNode('skill', {
      summary: `调用 skill：${skillName}`,
      details: [],
    });
  }

  async handleToolFinish(toolName: string, error?: string, result?: unknown): Promise<void> {
    if (this.disposed) return;

    if (toolName === 'TodoWrite') {
      await this.setExecution('planning', '执行编排已更新');
      return;
    }

    if (error?.trim()) {
      const message = truncate(error.trim(), 80);
      await this.setExecution('failed', message);
      await this.pushNode('error', buildToolErrorNode(toolName, error.trim()));
      return;
    }

    await this.setExecution('executing', `工具执行完成：${humanizeToolName(toolName)}`);
    await this.pushNode('done', buildToolResultNode(toolName, result));
  }

  async handleModelCall(provider: string, model: string, prompt: string): Promise<void> {
    if (this.disposed) return;
    const modelLabel = [provider, model].filter(Boolean).join(' / ');
    await this.setExecution('executing', `正在调用大模型：${modelLabel || '默认模型'}`);
    await this.pushNode('model', buildModelCallNode(modelLabel || '默认模型', prompt));
  }

  async handleModelReply(provider: string, model: string, assistantTexts: string[]): Promise<void> {
    if (this.disposed) return;
    const modelLabel = [provider, model].filter(Boolean).join(' / ');
    await this.setExecution('summarizing', '大模型已返回结果，正在整理回复');
    await this.pushNode('done', buildModelReplyNode(modelLabel || '默认模型', assistantTexts));
  }

  async markSummarizing(): Promise<void> {
    if (this.disposed) return;
    await this.setExecution('summarizing', '正在整理最终结果');
    await this.pushNode('status', {
      summary: '开始整理最终结果',
      details: [],
    });
  }

  async markCompleted(): Promise<void> {
    if (this.disposed) return;
    await this.setExecution('completed', '全部任务已完成');
    await this.pushNode('done', {
      summary: '全部任务已完成',
      details: [],
    });
    this.flush.cancelPendingFlush();
    await this.flush.flush();
    this.flush.complete();
    await this.flush.waitForFlush();
  }

  async markFailed(error?: string): Promise<void> {
    if (this.disposed) return;
    const message = truncate(error?.trim() || '执行失败', 80);
    await this.setExecution('failed', message);
    await this.pushNode('error', {
      summary: `执行失败：${message}`,
      details: [buildCodeBlock('错误信息', error?.trim() || '执行失败', 'text')],
    });
    this.flush.cancelPendingFlush();
    await this.flush.flush();
    this.flush.complete();
    await this.flush.waitForFlush();
  }

  async abort(): Promise<void> {
    if (this.disposed) return;
    await this.setExecution('aborted', '用户已中止当前执行');
    await this.pushNode('status', {
      summary: '用户已中止当前执行',
      details: [],
    });
    this.flush.cancelPendingFlush();
    await this.flush.flush();
    this.flush.complete();
    await this.flush.waitForFlush();
  }

  async pushNode(kind: TaskProgressNodeKind, node: NodeInput): Promise<void> {
    if (this.disposed) return;

    const normalized = normalizeNode(kind, node);
    if (!normalized?.summary) return;

    if (
      this.state.currentNode?.summary === normalized.summary &&
      this.state.currentNode.kind === kind &&
      JSON.stringify(this.state.currentNode.details) === JSON.stringify(normalized.details)
    ) {
      return;
    }

    this.state.currentNode = normalized;
    await this.scheduleUpdate();
  }

  async scheduleUpdate(): Promise<void> {
    if (!this.cardMessageId || this.disposed) return;
    await this.flush.throttledUpdate(PATCH_THROTTLE_MS);
  }

  dispose(): void {
    this.disposed = true;
    this.flush.cancelPendingFlush();
    this.flush.complete();
  }
}

function normalizeNode(kind: TaskProgressNodeKind, node: NodeInput): TaskProgressNode | null {
  if (!node) return null;

  if (typeof node === 'string') {
    const summary = node.trim();
    return summary ? { kind, summary, details: [] } : null;
  }

  const summary = typeof node.summary === 'string' ? node.summary.trim() : '';
  if (!summary) return null;

  const details = Array.isArray(node.details)
    ? node.details
        .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
        .map((item) => item.trim())
    : [];

  return { kind, summary, details };
}

function humanizeToolName(toolName: string): string {
  if (!toolName) return '工具任务';
  return toolName.replace(/[_-]+/g, ' ');
}

function buildModelCallNode(modelLabel: string, prompt: string): NodeInput {
  return {
    summary: `调用大模型：${modelLabel}`,
    details: [buildCodeBlock('输入 Prompt', prompt.trim() ? prompt : '(空)', 'text')],
  };
}

function buildModelReplyNode(modelLabel: string, assistantTexts: string[]): NodeInput {
  const joined = Array.isArray(assistantTexts) ? assistantTexts.filter(Boolean).join('\n\n') : '';
  return {
    summary: `模型返回：${modelLabel}`,
    details: [buildCodeBlock('输出内容', joined || '(空)', 'markdown')],
  };
}

function buildToolCallNode(toolName: string, params: unknown): NodeInput {
  const payload = stringifyPayloadDetailed(params);
  return {
    summary: `调用工具：${humanizeToolName(toolName)}`,
    details: [buildCodeBlock('输入参数', payload.text, payload.language)],
  };
}

function buildToolResultNode(toolName: string, result: unknown): NodeInput {
  const payload = stringifyPayloadDetailed(result);
  return {
    summary: `工具完成：${humanizeToolName(toolName)}`,
    details: [buildCodeBlock('输出结果', payload.text, payload.language)],
  };
}

function buildToolErrorNode(toolName: string, errorText: string): NodeInput {
  return {
    summary: `工具异常：${humanizeToolName(toolName)}`,
    details: [buildCodeBlock('错误信息', errorText || '(空)', 'text')],
  };
}

function stringifyPayloadDetailed(value: unknown): { text: string; language: string } {
  if (value === undefined) return { text: '(空)', language: 'text' };
  if (typeof value === 'string') return { text: value, language: 'text' };

  try {
    return { text: JSON.stringify(value, null, 2), language: 'json' };
  } catch {
    return { text: String(value), language: 'text' };
  }
}

function buildCodeBlock(title: string, content: string, language: string): string {
  const body = content.length > 0 ? content : '(空)';
  return `**${title}**\n\`\`\`${language}\n${escapeTripleBackticks(body)}\n\`\`\``;
}

function escapeTripleBackticks(text: string): string {
  return String(text).replace(/```/g, '``\\`');
}

function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(0, maxLength - 3))}...`;
}
