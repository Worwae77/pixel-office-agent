import { describe, expect, it } from 'vitest';

import { createCompatibleHookProvider } from '../src/providers/hook/compatible.js';

const provider = createCompatibleHookProvider({ id: 'test', displayName: 'Test' });

describe('compatible hook provider', () => {
  it('normalizes Codex/Gemini/Qwen lifecycle hook fields', () => {
    expect(
      provider.normalizeHookEvent({
        hook_event_name: 'PreToolUse',
        session_id: 'session-1',
        tool_name: 'Read',
        tool_use_id: 'tool-1',
        tool_input: { file_path: '/tmp/example.ts' },
      }),
    ).toEqual({
      sessionId: 'session-1',
      event: {
        kind: 'toolStart',
        toolId: 'tool-1',
        toolName: 'Read',
        input: { file_path: '/tmp/example.ts' },
        runInBackground: false,
      },
    });
  });

  it('normalizes Hermes-style event aliases and camelCase fields', () => {
    expect(
      provider.normalizeHookEvent({
        eventName: 'pre_tool_call',
        conversationId: 'conversation-1',
        functionName: 'run_shell_command',
        callId: 'call-1',
        arguments: { command: 'npm test' },
      }),
    ).toMatchObject({
      sessionId: 'conversation-1',
      event: {
        kind: 'toolStart',
        toolId: 'call-1',
        toolName: 'run_shell_command',
      },
    });
  });

  it('normalizes hooks-only session starts', () => {
    expect(
      provider.normalizeHookEvent({
        event: 'on_session_start',
        threadId: 'thread-1',
        workingDirectory: '/workspace',
      }),
    ).toEqual({
      sessionId: 'thread-1',
      event: {
        kind: 'sessionStart',
        source: undefined,
        transcriptPath: undefined,
        cwd: '/workspace',
      },
    });
  });

  it('ignores payloads without a stable session identifier', () => {
    expect(provider.normalizeHookEvent({ hook_event_name: 'Stop' })).toBeNull();
  });
});
