import { describe, expect, it, vi } from 'vitest';

import { AgentRuntime } from '../src/agentRuntime.js';
import { AgentStateStore } from '../src/agentStateStore.js';
import { createCompatibleHookProvider } from '../src/providers/hook/compatible.js';
import { ProviderRegistry } from '../src/providers/providerRegistry.js';
import { AgentRoster, DEFAULT_AGENT_ROSTER } from '../src/roster.js';

describe('multi-provider AgentRuntime', () => {
  const providers = DEFAULT_AGENT_ROSTER.map((entry) =>
    createCompatibleHookProvider({ id: entry.providerId, displayName: entry.displayName }),
  );

  it('seeds six persistent agents and routes a provider session to its stable identity', () => {
    const store = new AgentStateStore();
    const runtime = new AgentRuntime(store, new ProviderRegistry(providers, providers[0].id), new AgentRoster(DEFAULT_AGENT_ROSTER));
    runtime.seedRosterAgents('/workspace');

    expect(store.size).toBe(6);
    const gemini = [...store.values()].find((agent) => agent.agentKey === 'gemini');
    expect(gemini).toMatchObject({
      displayName: 'Gemini',
      role: 'Researcher',
      providerId: 'gemini',
      sessionId: 'roster:gemini',
    });

    runtime.handleHookEvent('gemini', {
      hook_event_name: 'SessionStart',
      session_id: 'gemini-session',
      cwd: '/workspace',
      source: 'startup',
    });
    runtime.handleHookEvent('gemini', {
      hook_event_name: 'PreToolUse',
      session_id: 'gemini-session',
      tool_name: 'WebSearch',
      tool_use_id: 'search-1',
      tool_input: { query: 'provider contracts' },
    });

    expect(store.size).toBe(6);
    expect(gemini).toMatchObject({ sessionId: 'gemini-session', hookDelivered: true });
    expect(gemini?.currentHookToolName).toBe('WebSearch');
    expect(gemini?.isWaiting).toBe(false);
    runtime.dispose();
  });

  it('rejects unknown provider IDs', () => {
    const store = new AgentStateStore();
    const runtime = new AgentRuntime(store, new ProviderRegistry(providers, providers[0].id), new AgentRoster(DEFAULT_AGENT_ROSTER));
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    runtime.handleHookEvent('unknown', { hook_event_name: 'Stop', session_id: 'x' });
    expect(warning).toHaveBeenCalledWith(expect.stringContaining('unknown provider'));
    warning.mockRestore();
    runtime.dispose();
  });
});
