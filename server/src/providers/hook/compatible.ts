import * as path from 'path';

import type { AgentEvent, HookProvider } from '../../../../core/src/provider.js';
import {
  BASH_COMMAND_DISPLAY_MAX_LENGTH,
  TASK_DESCRIPTION_DISPLAY_MAX_LENGTH,
} from '../../constants.js';

export interface CompatibleHookProviderOptions {
  id: string;
  displayName: string;
  command?: string;
  commandArgs?: string[];
  terminalNamePrefix?: string;
}

function firstString(raw: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = raw[key];
    if (typeof value === 'string' && value.length > 0) return value;
  }
  return undefined;
}

function normalizedEventName(raw: Record<string, unknown>): string {
  return (
    firstString(raw, 'hook_event_name', 'hookEventName', 'event_name', 'eventName', 'event', 'type') ??
    ''
  )
    .replace(/[^a-z0-9]/gi, '')
    .toLowerCase();
}

function normalizeHookEvent(
  raw: Record<string, unknown>,
): { sessionId: string; event: AgentEvent } | null {
  const eventName = normalizedEventName(raw);
  const sessionId = firstString(
    raw,
    'session_id',
    'sessionId',
    'thread_id',
    'threadId',
    'conversation_id',
    'conversationId',
  );
  if (!eventName || !sessionId) return null;

  const toolName = firstString(raw, 'tool_name', 'toolName', 'function_name', 'functionName') ?? '';
  const toolInput =
    (raw.tool_input ?? raw.toolInput ?? raw.arguments ?? raw.input) as unknown;
  const input = typeof toolInput === 'object' && toolInput !== null ? toolInput : {};
  const toolId =
    firstString(raw, 'tool_use_id', 'toolUseId', 'tool_id', 'toolId', 'call_id', 'callId') ??
    `hook-${Date.now()}`;

  switch (eventName) {
    case 'sessionstart':
    case 'onsessionstart':
      return {
        sessionId,
        event: {
          kind: 'sessionStart',
          source: firstString(raw, 'source', 'reason'),
          transcriptPath: firstString(raw, 'transcript_path', 'transcriptPath'),
          cwd: firstString(raw, 'cwd', 'working_directory', 'workingDirectory'),
        },
      };

    case 'sessionend':
    case 'onsessionend':
      return {
        sessionId,
        event: { kind: 'sessionEnd', reason: firstString(raw, 'reason', 'source') },
      };

    case 'pretooluse':
    case 'pretoolcall':
    case 'beforetool':
    case 'beforetooluse':
      return {
        sessionId,
        event: {
          kind: 'toolStart',
          toolId,
          toolName,
          input,
          runInBackground:
            (input as Record<string, unknown>).run_in_background === true ||
            (input as Record<string, unknown>).runInBackground === true,
        },
      };

    case 'posttooluse':
    case 'posttoolusefailure':
    case 'posttoolcall':
    case 'aftertool':
    case 'aftertooluse':
      return { sessionId, event: { kind: 'toolEnd', toolId } };

    case 'permissionrequest':
    case 'onpermissionrequest':
      return { sessionId, event: { kind: 'permissionRequest' } };

    case 'stop':
    case 'afteragent':
    case 'agentend':
    case 'turnend':
      return { sessionId, event: { kind: 'turnEnd' } };

    case 'notification': {
      const notificationType =
        firstString(raw, 'notification_type', 'notificationType', 'reason') ?? '';
      if (notificationType === 'permission_prompt') {
        return { sessionId, event: { kind: 'permissionRequest' } };
      }
      if (notificationType === 'idle_prompt') {
        return { sessionId, event: { kind: 'turnEnd', awaitingInput: true } };
      }
      return null;
    }

    case 'subagentstart':
    case 'onsubagentstart':
      return {
        sessionId,
        event: {
          kind: 'subagentStart',
          parentToolId: firstString(raw, 'parent_tool_id', 'parentToolId') ?? 'current',
          toolId,
          toolName: firstString(raw, 'agent_type', 'agentType') ?? (toolName || 'subagent'),
          input: raw,
          runInBackground: raw.run_in_background === true || raw.runInBackground === true,
        },
      };

    case 'subagentstop':
    case 'onsubagentstop':
      return {
        sessionId,
        event: {
          kind: 'subagentEnd',
          parentToolId: firstString(raw, 'parent_tool_id', 'parentToolId') ?? 'current',
          toolId,
        },
      };

    default:
      return null;
  }
}

function formatToolStatus(toolName: string, input?: unknown): string {
  const value = (input ?? {}) as Record<string, unknown>;
  const file = firstString(value, 'file_path', 'filePath', 'path');
  const base = file ? path.basename(file) : '';
  const normalized = toolName.toLowerCase();

  if (['read', 'readfile', 'read_file'].includes(normalized)) return `Reading ${base}`.trim();
  if (['edit', 'write', 'writefile', 'write_file', 'apply_patch'].includes(normalized)) {
    return `${normalized === 'edit' ? 'Editing' : 'Writing'} ${base}`.trim();
  }
  if (['grep', 'glob', 'search', 'searchfiles', 'search_files'].includes(normalized)) {
    return 'Searching code';
  }
  if (['webfetch', 'websearch', 'web_fetch', 'web_search'].includes(normalized)) {
    return 'Researching the web';
  }
  if (['bash', 'shell', 'runcommand', 'run_shell_command'].includes(normalized)) {
    const command = firstString(value, 'command', 'cmd') ?? '';
    const shown =
      command.length > BASH_COMMAND_DISPLAY_MAX_LENGTH
        ? `${command.slice(0, BASH_COMMAND_DISPLAY_MAX_LENGTH)}…`
        : command;
    return shown ? `Running: ${shown}` : 'Running command';
  }
  if (['task', 'agent', 'subagent'].includes(normalized)) {
    const description = firstString(value, 'description', 'prompt') ?? '';
    const shown =
      description.length > TASK_DESCRIPTION_DISPLAY_MAX_LENGTH
        ? `${description.slice(0, TASK_DESCRIPTION_DISPLAY_MAX_LENGTH)}…`
        : description;
    return shown ? `Subtask: ${shown}` : 'Running subtask';
  }
  return toolName ? `Using ${toolName}` : 'Working';
}

const noOp = async (): Promise<void> => undefined;

export function createCompatibleHookProvider(
  options: CompatibleHookProviderOptions,
): HookProvider {
  return {
    kind: 'hook',
    id: options.id,
    displayName: options.displayName,
    protocolVersion: 1,
    normalizeHookEvent,
    installHooks: noOp,
    uninstallHooks: noOp,
    areHooksInstalled: async () => false,
    formatToolStatus,
    permissionExemptTools: new Set(['Task', 'Agent', 'AskUserQuestion']),
    subagentToolNames: new Set(['Task', 'Agent', 'task', 'agent', 'subagent']),
    readingTools: new Set([
      'Read',
      'Grep',
      'Glob',
      'WebFetch',
      'WebSearch',
      'read_file',
      'search_files',
      'web_fetch',
      'web_search',
    ]),
    terminalNamePrefix: options.terminalNamePrefix,
    buildLaunchCommand:
      options.command === undefined
        ? undefined
        : (_sessionId, cwd) => ({
            command: options.command!,
            args: [...(options.commandArgs ?? [])],
            env: { PWD: cwd },
          }),
  };
}
