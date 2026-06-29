/**
 * Provider registry: re-exports all bundled providers.
 *
 * Adding a new CLI provider:
 *   1. Create `server/src/providers/hook/<cli>/<cli>.ts` implementing HookProvider.
 *      (File-based and stream-based provider types will land when the first such
 *       provider ships.)
 *   2. Add an export line below.
 *
 * The adapter (VS Code extension, standalone CLI, etc.) imports from here rather
 * than reaching into each provider directory directly.
 */

export { claudeProvider } from './hook/claude/claude.js';
export { copyHookScript } from './hook/claude/claudeHookInstaller.js';
export { createCompatibleHookProvider } from './hook/compatible.js';
export { ProviderRegistry } from './providerRegistry.js';

import { claudeProvider } from './hook/claude/claude.js';
import { createCompatibleHookProvider } from './hook/compatible.js';
import { ProviderRegistry } from './providerRegistry.js';

export const codexProvider = createCompatibleHookProvider({
  id: 'codex',
  displayName: 'Codex',
  command: 'codex',
  terminalNamePrefix: 'Codex',
});

export const geminiProvider = createCompatibleHookProvider({
  id: 'gemini',
  displayName: 'Gemini CLI',
  command: 'gemini',
  terminalNamePrefix: 'Gemini',
});

export const qwenProvider = createCompatibleHookProvider({
  id: 'qwen',
  displayName: 'Qwen Code',
  command: 'qwen',
  terminalNamePrefix: 'Qwen',
});

export const hermesProvider = createCompatibleHookProvider({
  id: 'hermes',
  displayName: 'Hermes Agent',
  command: 'hermes',
  terminalNamePrefix: 'Hermes',
});

export const deepseekProvider = createCompatibleHookProvider({
  id: 'deepseek',
  displayName: 'DeepSeek Worker',
});

export const glmProvider = createCompatibleHookProvider({
  id: 'glm',
  displayName: 'GLM Worker',
});

export function createProviderRegistry(): ProviderRegistry {
  return new ProviderRegistry([
    claudeProvider,
    hermesProvider,
    codexProvider,
    geminiProvider,
    qwenProvider,
    deepseekProvider,
    glmProvider,
  ], 'claude');
}

