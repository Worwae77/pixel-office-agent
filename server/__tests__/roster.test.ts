import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it } from 'vitest';

import { DEFAULT_AGENT_ROSTER, loadAgentRoster } from '../src/roster.js';

const created: string[] = [];

afterEach(() => {
  for (const file of created.splice(0)) fs.rmSync(file, { force: true });
});

describe('agent roster', () => {
  it('contains the requested six stable office identities', () => {
    expect(DEFAULT_AGENT_ROSTER.map((agent) => agent.id)).toEqual([
      'hermes',
      'codex',
      'gemini',
      'qwen',
      'deepseek',
      'glm',
    ]);
  });

  it('loads and validates a custom JSON roster', () => {
    const file = path.join(os.tmpdir(), `pixel-office-roster-${Date.now()}.json`);
    created.push(file);
    fs.writeFileSync(
      file,
      JSON.stringify({
        version: 1,
        agents: [
          {
            id: 'reviewer',
            displayName: 'Reviewer',
            role: 'Code Reviewer',
            providerId: 'deepseek',
          },
        ],
      }),
    );
    expect(loadAgentRoster(file).forProvider('deepseek')?.role).toBe('Code Reviewer');
  });

  it('rejects duplicate provider assignments', () => {
    const file = path.join(os.tmpdir(), `pixel-office-roster-${Date.now()}.json`);
    created.push(file);
    fs.writeFileSync(
      file,
      JSON.stringify({
        version: 1,
        agents: [
          { id: 'one', displayName: 'One', role: 'One', providerId: 'same' },
          { id: 'two', displayName: 'Two', role: 'Two', providerId: 'same' },
        ],
      }),
    );
    expect(() => loadAgentRoster(file)).toThrow('Duplicate roster provider id');
  });
});
