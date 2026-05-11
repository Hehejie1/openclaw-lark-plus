/**
 * Copyright (c) 2026 ByteDance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 *
 * Build Feishu cards for the progress-only execution view.
 *
 * The card intentionally shows a compact runtime view only:
 * 1. OpenClaw execution status
 * 2. Key execution nodes
 */

import { optimizeMarkdownStyle } from './markdown-style';

export type TaskExecutionStage =
  | 'received'
  | 'analyzing'
  | 'planning'
  | 'executing'
  | 'summarizing'
  | 'completed'
  | 'failed'
  | 'aborted';

export type TaskProgressNodeKind = 'status' | 'model' | 'tool' | 'skill' | 'error' | 'done';

export interface TaskProgressNode {
  kind: TaskProgressNodeKind;
  summary: string;
  details: string[];
}

export interface TaskProgressState {
  execution: {
    stage: TaskExecutionStage;
    message: string;
    startedAt: number;
    updatedAt: number;
  };
  currentNode: TaskProgressNode | null;
}

interface ExecutionStageLabel {
  zh: string;
  en: string;
}

interface CardElement {
  tag: string;
  [key: string]: unknown;
}

const EXECUTION_STAGE_TEXT: Record<TaskExecutionStage, ExecutionStageLabel> = {
  received: { zh: '已接收', en: 'Received' },
  analyzing: { zh: '分析中', en: 'Analyzing' },
  planning: { zh: '规划中', en: 'Planning' },
  executing: { zh: '执行中', en: 'Executing' },
  summarizing: { zh: '整理结果', en: 'Summarizing' },
  completed: { zh: '已完成', en: 'Completed' },
  failed: { zh: '已失败', en: 'Failed' },
  aborted: { zh: '已停止', en: 'Stopped' },
};

const NODE_ICON: Record<TaskProgressNodeKind, string> = {
  status: '📍',
  model: '🧠',
  tool: '🛠️',
  skill: '📦',
  error: '❌',
  done: '✅',
};

export function buildTaskProgressCard(state: TaskProgressState): Record<string, unknown> {
  const stageText = EXECUTION_STAGE_TEXT[state.execution.stage] ?? EXECUTION_STAGE_TEXT.received;

  const executionLines = [
    '**OpenClaw 执行状态**',
    `当前状态：${stageText.zh}`,
  ];

  if (state.execution.message.trim()) {
    executionLines.push(`说明：${state.execution.message.trim()}`);
  }

  const elements: CardElement[] = [
    {
      tag: 'markdown',
      content: executionLines.join('\n'),
    },
    {
      tag: 'markdown',
      content: '**关键执行节点**',
    },
  ];

  if (!state.currentNode?.summary.trim()) {
    elements.push({
      tag: 'markdown',
      content: '⏳ 等待关键节点事件',
    });
  } else {
    const icon = NODE_ICON[state.currentNode.kind] ?? NODE_ICON.status;

    elements.push({
      tag: 'collapsible_panel',
      expanded: false,
      direction: 'vertical',
      padding: '8px',
      margin: '0px',
      vertical_spacing: '8px',
      background_color: 'default',
      header: {
        title: {
          tag: 'markdown',
          content: `${icon} ${state.currentNode.summary}`,
        },
        width: 'fill',
        vertical_align: 'center',
        padding: '4px 8px 4px 8px',
        icon_position: 'right',
        icon_expanded_angle: -180,
      },
      elements:
        state.currentNode.details.length > 0
          ? state.currentNode.details.map((detail, index) => ({
              tag: 'markdown',
              element_id: `current_node_detail_${index + 1}`,
              content: detail,
            }))
          : [
              {
                tag: 'markdown',
                content: '当前节点没有更多明细。',
              },
            ],
    });
  }

  const summaryText =
    state.execution.stage === 'completed'
      ? '执行完成'
      : state.execution.stage === 'failed'
        ? '执行失败'
        : state.execution.stage === 'aborted'
          ? '执行已停止'
          : '执行中';

  return {
    schema: '2.0',
    config: {
      wide_screen_mode: true,
      update_multi: true,
      locales: ['zh_cn', 'en_us'],
      summary: { content: summaryText },
    },
    header: {
      title: {
        tag: 'plain_text',
        content: 'OpenClaw 执行进度',
      },
      template: resolveHeaderTemplate(state.execution.stage),
    },
    body: {
      elements: elements.map((element) =>
        element.tag === 'markdown'
          ? {
              ...element,
              content: optimizeMarkdownStyle(String(element.content ?? '')),
            }
          : {
              ...element,
              header: element.header
                ? {
                    ...element.header,
                    title:
                      typeof element.header === 'object' &&
                      element.header &&
                      typeof (element.header as { title?: unknown }).title === 'object' &&
                      (element.header as { title?: { tag?: string; content?: string } }).title?.tag === 'markdown'
                        ? {
                            ...(element.header as { title: { tag: string; content: string } }).title,
                            content: optimizeMarkdownStyle(
                              (element.header as { title: { content: string } }).title.content,
                            ),
                          }
                        : (element.header as Record<string, unknown>).title,
                  }
                : undefined,
              elements: Array.isArray(element.elements)
                ? element.elements.map((child) =>
                    child.tag === 'markdown'
                      ? {
                          ...child,
                          content: optimizeMarkdownStyle(String(child.content ?? '')),
                        }
                      : child,
                  )
                : element.elements,
            },
      ),
    },
  };
}

function resolveHeaderTemplate(stage: TaskExecutionStage): string {
  switch (stage) {
    case 'completed':
      return 'green';
    case 'failed':
      return 'red';
    case 'aborted':
      return 'grey';
    default:
      return 'blue';
  }
}
