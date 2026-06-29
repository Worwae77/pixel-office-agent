import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

export interface AgentRosterEntry {
  id: string;
  displayName: string;
  role: string;
  providerId: string;
  model?: string;
}

interface AgentRosterConfig {
  version: 1;
  agents: AgentRosterEntry[];
}

export const DEFAULT_AGENT_ROSTER: readonly AgentRosterEntry[] = [
  {
    id: 'hermes',
    displayName: 'Hermes',
    role: 'Chief of Staff',
    providerId: 'hermes',
    model: 'hermes',
  },
  {
    id: 'codex',
    displayName: 'Codex',
    role: 'Software Engineer',
    providerId: 'codex',
    model: 'codex',
  },
  {
    id: 'gemini',
    displayName: 'Gemini',
    role: 'Researcher',
    providerId: 'gemini',
    model: 'gemini',
  },
  {
    id: 'qwen',
    displayName: 'Qwen',
    role: 'Test Engineer',
    providerId: 'qwen',
    model: 'qwen',
  },
  {
    id: 'deepseek',
    displayName: 'DeepSeek',
    role: 'Reviewer',
    providerId: 'deepseek',
    model: 'deepseek',
  },
  {
    id: 'glm',
    displayName: 'GLM',
    role: 'Technical Writer',
    providerId: 'glm',
    model: 'glm',
  },
];

function validateRoster(value: unknown): AgentRosterEntry[] {
  if (typeof value !== 'object' || value === null) throw new Error('Roster must be an object');
  const config = value as Partial<AgentRosterConfig>;
  if (config.version !== 1 || !Array.isArray(config.agents)) {
    throw new Error('Roster requires version=1 and an agents array');
  }

  const ids = new Set<string>();
  const providerIds = new Set<string>();
  return config.agents.map((raw, index) => {
    if (typeof raw !== 'object' || raw === null) {
      throw new Error(`Roster agent at index ${index} must be an object`);
    }
    const entry = raw as Partial<AgentRosterEntry>;
    for (const key of ['id', 'displayName', 'role', 'providerId'] as const) {
      if (typeof entry[key] !== 'string' || entry[key]!.trim().length === 0) {
        throw new Error(`Roster agent at index ${index} requires ${key}`);
      }
    }
    if (ids.has(entry.id!)) throw new Error(`Duplicate roster agent id: ${entry.id}`);
    if (providerIds.has(entry.providerId!)) {
      throw new Error(`Duplicate roster provider id: ${entry.providerId}`);
    }
    ids.add(entry.id!);
    providerIds.add(entry.providerId!);
    return {
      id: entry.id!,
      displayName: entry.displayName!,
      role: entry.role!,
      providerId: entry.providerId!,
      model: typeof entry.model === 'string' ? entry.model : undefined,
    };
  });
}

export class AgentRoster {
  private readonly byProvider = new Map<string, AgentRosterEntry>();

  constructor(readonly entries: readonly AgentRosterEntry[]) {
    for (const entry of entries) this.byProvider.set(entry.providerId, entry);
  }

  forProvider(providerId: string): AgentRosterEntry | undefined {
    return this.byProvider.get(providerId);
  }
}

export function loadAgentRoster(filePath?: string): AgentRoster {
  const configuredPath =
    filePath ??
    process.env.PIXEL_OFFICE_ROSTER ??
    path.join(os.homedir(), '.pixel-agents', 'roster.json');

  if (!fs.existsSync(configuredPath)) {
    return new AgentRoster(DEFAULT_AGENT_ROSTER);
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(configuredPath, 'utf-8')) as unknown;
    return new AgentRoster(validateRoster(parsed));
  } catch (error) {
    throw new Error(
      `Invalid Pixel Office roster at ${configuredPath}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
