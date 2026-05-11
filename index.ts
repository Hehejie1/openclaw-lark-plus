/**
 * Copyright (c) 2026 ByteDance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 *
 * OpenClaw Lark/Feishu plugin entry point.
 *
 * Registers the Feishu channel and all tool families:
 * doc, wiki, drive, perm, bitable, task, calendar.
 */

import type { OpenClawPluginApi } from 'openclaw/plugin-sdk';
import { emptyPluginConfigSchema } from 'openclaw/plugin-sdk';
import { LarkClient } from './src/core/lark-client';
import { registerOapiTools } from './src/tools/oapi/index';
import { registerFeishuMcpDocTools } from './src/tools/mcp/doc/index';
import { registerFeishuOAuthTool } from './src/tools/oauth';
import { registerFeishuOAuthBatchAuthTool } from './src/tools/oauth-batch-auth';
import { registerAskUserQuestionTool } from './src/tools/ask-user-question';
import {
  analyzeTrace,
  formatDiagReportCli,
  formatTraceOutput,
  runDiagnosis,
  traceByMessageId,
} from './src/commands/diagnose';
import { registerCommands } from './src/commands/index';
import { larkLogger } from './src/core/lark-logger';
import { emitSecurityWarnings } from './src/core/security-check';
import { recordToolUseEnd, recordToolUseStart } from './src/card/tool-use-trace-store';
import { sanitizeParamsForLog } from './src/card/reasoning-utils';
import { TaskProgressCardController } from './src/card/task-progress-controller';
import {
  bindProgressRun,
  getProgressController,
  registerProgressController,
  unregisterProgressController,
} from './src/card/task-progress-registry';

const log = larkLogger('plugin');

// ---------------------------------------------------------------------------
// Re-exports for external consumers
// ---------------------------------------------------------------------------

export { monitorFeishuProvider } from './src/channel/monitor';
export { sendMessageFeishu, sendCardFeishu, updateCardFeishu, editMessageFeishu } from './src/messaging/outbound/send';
export { getMessageFeishu } from './src/messaging/outbound/fetch';
export {
  uploadImageLark,
  uploadFileLark,
  sendImageLark,
  sendFileLark,
  sendAudioLark,
  uploadAndSendMediaLark,
} from './src/messaging/outbound/media';
export {
  sendTextLark,
  sendCardLark,
  sendMediaLark,
  type SendTextLarkParams,
  type SendCardLarkParams,
  type SendMediaLarkParams,
} from './src/messaging/outbound/deliver';
export { type FeishuChannelData } from './src/messaging/outbound/outbound';
export { probeFeishu } from './src/channel/probe';
export {
  addReactionFeishu,
  removeReactionFeishu,
  listReactionsFeishu,
  FeishuEmoji,
  VALID_FEISHU_EMOJI_TYPES,
} from './src/messaging/outbound/reactions';
export { forwardMessageFeishu } from './src/messaging/outbound/forward';
export {
  updateChatFeishu,
  addChatMembersFeishu,
  removeChatMembersFeishu,
  listChatMembersFeishu,
} from './src/messaging/outbound/chat-manage';
export { feishuMessageActions } from './src/messaging/outbound/actions';
export {
  mentionedBot,
  nonBotMentions,
  extractMessageBody,
  formatMentionForText,
  formatMentionForCard,
  formatMentionAllForText,
  formatMentionAllForCard,
  buildMentionedMessage,
  buildMentionedCardContent,
  type MentionInfo,
} from './src/messaging/inbound/mention';
export { feishuPlugin } from './src/channel/plugin';
export type {
  MessageContext,
  RawMessage,
  RawSender,
  FeishuMessageContext,
  FeishuReactionCreatedEvent,
} from './src/messaging/types';
export { handleFeishuReaction } from './src/messaging/inbound/reaction-handler';
export { parseMessageEvent } from './src/messaging/inbound/parse';
export { checkMessageGate } from './src/messaging/inbound/gate';
export { isMessageExpired } from './src/messaging/inbound/dedup';

// ---------------------------------------------------------------------------
// Plugin definition
// ---------------------------------------------------------------------------

const plugin = {
  id: 'openclaw-lark-plus',
  name: 'Feishu Progress Plus',
  description: 'Lark/Feishu enhancement plugin with immediate progress cards and key execution traces',
  configSchema: emptyPluginConfigSchema(),
  register(api: OpenClawPluginApi): void {
    LarkClient.setRuntime(api.runtime);
    // The built-in OpenClaw Feishu channel remains the active messaging channel.
    // This plugin augments the runtime with immediate progress cards, extra tools
    // and diagnostics, but intentionally does not register another Feishu channel.

    // ========================================

    // Register OAPI tools (calendar, task - using Feishu Open API directly)
    registerOapiTools(api);

    // Register MCP doc tools (using Model Context Protocol)
    registerFeishuMcpDocTools(api);

    // Register OAuth tool (UAT device flow authorization)
    registerFeishuOAuthTool(api);

    // Register OAuth batch auth tool (batch authorization for all app scopes)
    registerFeishuOAuthBatchAuthTool(api);

    // Register AskUserQuestion tool (interactive card-based user prompting)
    registerAskUserQuestionTool(api);

    api.on('reply_dispatch', async (event, ctx) => {
      const channel = event.originatingChannel ?? event.ctx?.OriginatingChannel;
      if (channel !== 'feishu') return;

      const sessionKey = event.sessionKey ?? event.ctx?.SessionKey;
      if (!sessionKey) return;

      let controller = getProgressController(sessionKey, event.runId);

      if (!controller) {
        const replyToMessageId =
          event.ctx?.ReplyToIdFull ?? event.ctx?.ReplyToId ?? event.ctx?.MessageSidFull ?? event.ctx?.MessageSid;
        const to = event.originatingTo ?? event.ctx?.OriginatingTo ?? event.ctx?.To;
        const accountId =
          event.ctx?.AccountId ??
          (
            ctx.cfg as {
              channels?: {
                feishu?: {
                  defaultAccountId?: string;
                };
              };
            }
          ).channels?.feishu?.defaultAccountId;

        if (!replyToMessageId || !to) {
          log.warn('progress hook skipped due to missing routing context', {
            sessionKey,
            runId: event.runId,
            channel,
            hasTo: Boolean(to),
            hasReplyTo: Boolean(replyToMessageId),
          });
        } else {
          try {
            controller = new TaskProgressCardController({
              cfg: ctx.cfg,
              sessionKey,
              accountId,
              chatId: to,
              replyToMessageId,
              replyInThread: resolveReplyInThread(event.ctx),
            });
            await controller.ensureCardCreated();
            await controller.setExecution('analyzing', '正在分析用户请求');
            await controller.pushNode('status', '已收到请求');
            await controller.setExecution('planning', '正在准备执行');
            registerProgressController(sessionKey, controller);
            log.info('progress card created from reply_dispatch', {
              sessionKey,
              runId: event.runId,
              to,
              replyToMessageId,
              accountId,
            });
          } catch (error) {
            log.error(`progress card setup failed: ${String(error)}`);
          }
        }
      }

      bindProgressRun(event.sessionKey, event.runId);
    });

    api.on('agent_end', async (event, ctx) => {
      const controller = getProgressController(ctx.sessionKey, ctx.runId);
      if (!controller) return;

      try {
        if (event.success) {
          await controller.markSummarizing();
          await controller.markCompleted();
        } else {
          await controller.markFailed(event.error || '执行失败');
        }
      } finally {
        unregisterProgressController(ctx.sessionKey, ctx.runId);
        controller.dispose();
      }
    });

    api.on('before_tool_call', (event, ctx) => {
      const controller = getProgressController(ctx.sessionKey, ctx.runId ?? event.runId);
      void (async () => {
        if (controller) {
          if (event.toolName === 'Skill') {
            const skillName = typeof event.params.name === 'string' ? event.params.name : 'unknown';
            await controller.handleSkillStart(skillName);
          }
          if (event.toolName === 'TodoWrite') {
            const todos = Array.isArray(event.params.todos) ? event.params.todos : [];
            await controller.ingestPlannerTodos(todos);
          }
          if (event.toolName !== 'Skill') {
            await controller.handleToolStart(event.toolName, event.params);
          }
        }
      })().catch((error: unknown) => {
        log.error(`progress before_tool_call hook failed: ${String(error)}`);
      });

      recordToolUseStart({
        sessionKey: ctx.sessionKey,
        toolName: event.toolName,
        toolParams: event.params,
        toolCallId: event.toolCallId ?? ctx.toolCallId,
        runId: event.runId ?? ctx.runId,
      });
      if (!event.toolName.startsWith('feishu_')) return;
      const paramsPreview = sanitizeParamsForLog(event.params);
      log.info(`tool call: ${event.toolName} session=${ctx.sessionKey ?? '-'} params=${paramsPreview}`);
    });

    api.on('after_tool_call', (event, ctx) => {
      const controller = getProgressController(ctx.sessionKey, ctx.runId ?? event.runId);
      void controller?.handleToolFinish(event.toolName, event.error, event.result).catch((error: unknown) => {
        log.error(`progress after_tool_call hook failed: ${String(error)}`);
      });

      recordToolUseEnd({
        sessionKey: ctx.sessionKey,
        toolName: event.toolName,
        toolParams: event.params,
        toolCallId: event.toolCallId ?? ctx.toolCallId,
        runId: event.runId ?? ctx.runId,
        result: event.result,
        error: event.error,
        durationMs: event.durationMs,
      });
      if (!event.toolName.startsWith('feishu_')) return;
      if (event.error) {
        log.error(
          `tool fail: ${event.toolName} session=${ctx.sessionKey ?? '-'} ${event.error} (${event.durationMs ?? 0}ms)`,
        );
      } else {
        log.info(`tool done: ${event.toolName} session=${ctx.sessionKey ?? '-'} ok (${event.durationMs ?? 0}ms)`);
      }
    });

    api.on('llm_input', async (event, ctx) => {
      const controller = getProgressController(ctx.sessionKey, ctx.runId ?? event.runId);
      await controller?.handleModelCall(event.provider, event.model, event.prompt);
    });

    api.on('llm_output', async (event, ctx) => {
      const controller = getProgressController(ctx.sessionKey, ctx.runId ?? event.runId);
      await controller?.handleModelReply(event.provider, event.model, event.assistantTexts);
    });

    api.on('before_model_resolve', async (_event, ctx) => {
      const controller = getProgressController(ctx.sessionKey, ctx.runId);
      await controller?.pushNode('status', '开始选择大模型');
    });

    api.on('before_prompt_build', async (_event, ctx) => {
      const controller = getProgressController(ctx.sessionKey, ctx.runId);
      await controller?.pushNode('status', '开始构建提示词');
    });

    api.on('before_agent_reply', async (_event, ctx) => {
      const controller = getProgressController(ctx.sessionKey, ctx.runId);
      await controller?.pushNode('status', '开始生成回复');
    });

    // ---- Diagnostic commands ----

    // CLI: openclaw feishu-diagnose [--trace <messageId>]
    api.registerCli(
      (ctx) => {
        ctx.program
          .command('feishu-diagnose')
          .description('运行飞书插件诊断，检查配置、连通性和权限状态')
          .option('--trace <messageId>', '按 message_id 追踪完整处理链路')
          .option('--analyze', '分析追踪日志（需配合 --trace 使用）')
          .action(async (opts: { trace?: string; analyze?: boolean }) => {
            try {
              if (opts.trace) {
                const lines = await traceByMessageId(opts.trace);
                // eslint-disable-next-line no-console -- CLI 命令直接输出到终端
                console.log(formatTraceOutput(lines, opts.trace));
                if (opts.analyze && lines.length > 0) {
                  // eslint-disable-next-line no-console -- CLI 命令直接输出到终端
                  console.log(analyzeTrace(lines, opts.trace));
                }
              } else {
                const report = await runDiagnosis({
                  config: ctx.config,
                  logger: ctx.logger,
                });
                // eslint-disable-next-line no-console -- CLI 命令直接输出到终端
                console.log(formatDiagReportCli(report));
                if (report.overallStatus === 'unhealthy') {
                  process.exitCode = 1;
                }
              }
            } catch (err) {
              ctx.logger.error(`诊断命令执行失败: ${err}`);
              process.exitCode = 1;
            }
          });
      },
      { commands: ['feishu-diagnose'] },
    );

    // Chat commands: /feishu_diagnose, /feishu_doctor, /feishu_auth, /feishu
    registerCommands(api);

    // ---- Multi-account security checks ----
    if (api.config) {
      emitSecurityWarnings(api.config, api.logger);
    }
  },
};

export default plugin;

function resolveReplyInThread(ctx: { ReplyThreading?: unknown } | undefined): boolean {
  if (!ctx) return false;
  const dynamicCtx = ctx as {
    ReplyThreading?: { kind?: string } | null;
    ReplyInThread?: unknown;
  };
  return dynamicCtx.ReplyThreading?.kind === 'thread' || dynamicCtx.ReplyInThread === true;
}
