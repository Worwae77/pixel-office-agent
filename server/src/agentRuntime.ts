/**
 * AgentRuntime: shared agent lifecycle core for VS Code and standalone modes.
 *
 * Owns all infrastructure that both PixelAgentsViewProvider (VS Code) and the
 * standalone CLI need: timer Maps, file watchers, HookEventHandler, DismissalTracker,
 * session scanning, and agent removal. Adapters (VS Code, CLI) create an instance
 * and register platform-specific lifecycle callbacks.
 *
 * This is the single source of truth for agent lifecycle wiring. No duplication.
 */

import * as fs from 'fs';
import * as path from 'path';

import type { HookProvider } from '../../core/src/provider.js';
import type { AgentStateStore } from './agentStateStore.js';
import { DismissalTracker } from './dismissalTracker.js';
import {
  adoptExternalSessionFromHook,
  ensureProjectScan,
  isTrackedProjectDir,
  reassignAgentToFile,
  scanForTeammateFiles,
  setAgentRemovalCallback,
  setDismissalTracker,
  setHookProvider as setFileWatcherHookProvider,
  setTeammateRemovalCallback,
  setTeamProvider,
  startExternalSessionScanning,
  startFileWatching,
  startStaleExternalAgentCheck,
} from './fileWatcher.js';
import type { HookEvent } from './hookEventHandler.js';
import { HookEventHandler } from './hookEventHandler.js';
import { ProviderRegistry } from './providers/providerRegistry.js';
import type { AgentRoster, AgentRosterEntry } from './roster.js';
import { SessionRouter } from './sessionRouter.js';
import { cancelPermissionTimer, cancelWaitingTimer } from './timerManager.js';
import { setHookProvider } from './transcriptParser.js';
import type { AgentState } from './types.js';

/** Callbacks that adapters register for platform-specific behavior. */
export interface RuntimeLifecycleCallbacks {
  /** Called after an agent is removed. Adapters use this to dismiss JSONL files, etc. */
  onAgentRemoved?: (agentId: number, agent: AgentState) => void;
  /** Called when a teammate is removed. */
  onTeammateRemoved?: (teammateId: number, agent: AgentState, source: string) => void;
}

export class AgentRuntime {
  // Per-agent timer Maps (shared by all fileWatcher/hookEventHandler operations)
  readonly fileWatchers = new Map<number, fs.FSWatcher>();
  readonly pollingTimers = new Map<number, ReturnType<typeof setInterval>>();
  readonly waitingTimers = new Map<number, ReturnType<typeof setTimeout>>();
  readonly permissionTimers = new Map<number, ReturnType<typeof setTimeout>>();
  readonly jsonlPollTimers = new Map<number, ReturnType<typeof setInterval>>();

  // Scanning state
  readonly knownJsonlFiles = new Set<string>();
  readonly projectScanTimer = { current: null as ReturnType<typeof setInterval> | null };
  readonly activeAgentId = { current: null as number | null };
  private externalScanTimer: ReturnType<typeof setInterval> | null = null;
  private staleCheckTimer: ReturnType<typeof setInterval> | null = null;

  // Configuration refs (mutable, shared with scanners)
  readonly watchAllSessions = { current: false };
  readonly hooksEnabled = { current: true };

  // Dependencies
  readonly dismissalTracker = new DismissalTracker();
  private readonly hookEventHandlers = new Map<string, HookEventHandler>();
  private readonly trackedWorkspaces = new Set<string>();
  private lifecycleCallbacks: RuntimeLifecycleCallbacks = {};

  constructor(
    private readonly store: AgentStateStore,
    readonly providers: ProviderRegistry,
    public roster?: AgentRoster,
  ) {
    const provider = this.providers.primary;

    // Wire module-level dependencies
    setDismissalTracker(this.dismissalTracker);
    setHookProvider(provider);
    setFileWatcherHookProvider(provider);
    if (provider.team) {
      setTeamProvider(provider.team);
    }
    setAgentRemovalCallback((id) => this.removeAgent(id));
    setTeammateRemovalCallback((id) => this.removeTeammate(id, 'team-config'));

    for (const registeredProvider of this.providers.values()) {
      const handler = new HookEventHandler(
        store,
        this.waitingTimers,
        this.permissionTimers,
        registeredProvider,
        new SessionRouter(),
        this.watchAllSessions,
      );
      this.hookEventHandlers.set(registeredProvider.id, handler);
      this.configureHookLifecycle(registeredProvider, handler);
    }
  }

  private configureHookLifecycle(provider: HookProvider, handler: HookEventHandler): void {
    handler.setLifecycleCallbacks({
      onExternalSessionDetected: (sessionId, transcriptPath, cwd) => {
        const projectDir = transcriptPath ? path.dirname(transcriptPath) : cwd;
        const rosterEntry = this.roster?.forProvider(provider.id);
        if (
          !rosterEntry &&
          !isTrackedProjectDir(projectDir) &&
          !this.isTrackedWorkspace(cwd) &&
          !this.watchAllSessions.current
        ) {
          return;
        }

        const persistentAgent = rosterEntry
          ? [...this.store.values()].find((agent) => agent.agentKey === rosterEntry.id)
          : undefined;
        if (persistentAgent && rosterEntry) {
          this.unregisterAgent(persistentAgent.sessionId, provider.id);
          persistentAgent.sessionId = sessionId;
          persistentAgent.projectDir = cwd || projectDir;
          persistentAgent.jsonlFile = transcriptPath ?? '';
          persistentAgent.hooksOnly = !transcriptPath;
          persistentAgent.hookDelivered = true;
          persistentAgent.isWaiting = false;
          this.applyRosterIdentity(persistentAgent, rosterEntry);
          handler.registerAgent(sessionId, persistentAgent.id);
          this.store.persist();
          return;
        }

        adoptExternalSessionFromHook(
          sessionId,
          transcriptPath,
          cwd,
          this.knownJsonlFiles,
          this.store.nextAgentId,
          this.store,
          this.fileWatchers,
          this.pollingTimers,
          this.waitingTimers,
          this.permissionTimers,
          () => this.store.persist(),
          (agent) => {
            agent.providerId = provider.id;
            if (rosterEntry) {
              this.applyRosterIdentity(agent, rosterEntry);
            } else {
              agent.displayName = provider.displayName;
              this.store.broadcast({
                type: 'agentIdentityInfo',
                id: agent.id,
                providerId: agent.providerId,
                displayName: agent.displayName,
              });
            }
            this.registerAgent(agent.sessionId, agent.id, provider.id);
          },
        );
      },
      onSessionClear: (agentId, newSessionId, newTranscriptPath) => {
        if (newTranscriptPath) {
          this.knownJsonlFiles.add(newTranscriptPath);
          reassignAgentToFile(
            agentId,
            newTranscriptPath,
            this.store,
            this.fileWatchers,
            this.pollingTimers,
            this.waitingTimers,
            this.permissionTimers,
            () => this.store.persist(),
          );
        }
        const agent = this.store.get(agentId);
        if (agent) {
          this.unregisterAgent(agent.sessionId, provider.id);
          agent.sessionId = newSessionId;
          this.registerAgent(agent.sessionId, agent.id, provider.id);
        }
      },
      onSessionResume: (transcriptPath) => {
        this.dismissalTracker.clearDismissal(transcriptPath);
        this.dismissalTracker.clearSeededMtime(transcriptPath);
        this.knownJsonlFiles.delete(transcriptPath);
      },
      onTeammateDetected: (parentAgentId, sessionId, _agentType) => {
        const parentAgent = this.store.get(parentAgentId);
        if (!parentAgent) return;
        scanForTeammateFiles(
          parentAgent.projectDir,
          sessionId,
          parentAgentId,
          this.store.nextAgentId,
          this.store,
          this.fileWatchers,
          this.pollingTimers,
          this.waitingTimers,
          this.permissionTimers,
          () => this.store.persist(),
          // Don't register inline teammates: they share the lead's sessionId
          // and registering them would overwrite the lead in the session router.
          undefined,
        );
      },
      onTeammateRemoved: (teammateAgentId) => {
        this.removeTeammate(teammateAgentId, 'hooks');
      },
      onSessionEnd: (agentId) => {
        const agent = this.store.get(agentId);
        if (!agent) return;
        if (agent.agentKey) {
          this.unregisterAgent(agent.sessionId, provider.id);
          agent.sessionId = `roster:${agent.agentKey}`;
          agent.isWaiting = true;
          agent.hookDelivered = false;
          agent.activeToolIds.clear();
          agent.activeToolStatuses.clear();
          agent.activeToolNames.clear();
          this.store.broadcast({ type: 'agentStatus', id: agent.id, status: 'waiting' });
          this.store.persist();
          return;
        }
        this.dismissalTracker.clearSeededMtime(agent.jsonlFile);
        this.dismissalTracker.dismiss(agent.jsonlFile);
        if (agent.isTeamLead) {
          this.removeTeammates(agentId);
        }
        if (agent.isExternal) {
          this.unregisterAgent(agent.sessionId, provider.id);
          this.removeAgent(agentId);
        }
      },
    });
  }

  /** Register adapter-specific lifecycle callbacks. */
  setLifecycleCallbacks(callbacks: RuntimeLifecycleCallbacks): void {
    this.lifecycleCallbacks = callbacks;
  }

  /** Mark a workspace root as eligible for hooks-only session adoption. */
  trackWorkspace(workspacePath: string): void {
    this.trackedWorkspaces.add(path.resolve(workspacePath).toLowerCase());
  }

  private isTrackedWorkspace(workspacePath?: string): boolean {
    if (!workspacePath) return false;
    return this.trackedWorkspaces.has(path.resolve(workspacePath).toLowerCase());
  }

  private applyRosterIdentity(agent: AgentState, entry: AgentRosterEntry): void {
    agent.providerId = entry.providerId;
    agent.agentKey = entry.id;
    agent.displayName = entry.displayName;
    agent.role = entry.role;
    agent.model = entry.model;
    this.store.broadcast({
      type: 'agentIdentityInfo',
      id: agent.id,
      providerId: agent.providerId,
      agentKey: agent.agentKey,
      displayName: agent.displayName,
      role: agent.role,
      model: agent.model,
    });
  }

  /** Ensure every configured roster entry has a persistent character in the office. */
  seedRosterAgents(projectDir: string): void {
    if (!this.roster) return;
    this.trackWorkspace(projectDir);

    for (const entry of this.roster.entries) {
      const existing = [...this.store.values()].find((agent) => agent.agentKey === entry.id);
      if (existing) {
        this.applyRosterIdentity(existing, entry);
        continue;
      }

      const id = this.store.nextAgentId.current++;
      const agent: AgentState = {
        id,
        sessionId: `roster:${entry.id}`,
        terminalRef: undefined,
        isExternal: true,
        projectDir,
        jsonlFile: '',
        fileOffset: 0,
        lineBuffer: '',
        activeToolIds: new Set(),
        activeToolStatuses: new Map(),
        activeToolNames: new Map(),
        activeSubagentToolIds: new Map(),
        activeSubagentToolNames: new Map(),
        backgroundAgentToolIds: new Set(),
        isWaiting: true,
        permissionSent: false,
        hadToolsInTurn: false,
        lastDataAt: 0,
        linesProcessed: 0,
        seenUnknownRecordTypes: new Set(),
        hookDelivered: false,
        hooksOnly: true,
        providerId: entry.providerId,
        agentKey: entry.id,
        displayName: entry.displayName,
        role: entry.role,
        model: entry.model,
        inputTokens: 0,
        outputTokens: 0,
      };
      this.store.set(id, agent);
    }
    this.store.persist();
  }

  // ── Hook event routing ──

  /** Route an incoming hook event to the appropriate agent. */
  handleHookEvent(providerId: string, event: Record<string, unknown>): void {
    const handler = this.hookEventHandlers.get(providerId);
    if (!handler) {
      console.warn(`[Pixel Agents] Ignoring hook event for unknown provider: ${providerId}`);
      return;
    }
    handler.handleEvent(providerId, event as HookEvent);
  }

  /** Register an agent with the hook event handler for session->agent mapping. */
  registerAgent(sessionId: string, agentId: number, providerId?: string): void {
    const agent = this.store.get(agentId);
    const resolvedProviderId = providerId ?? agent?.providerId ?? this.providers.primaryProviderId;
    this.hookEventHandlers.get(resolvedProviderId)?.registerAgent(sessionId, agentId);
  }

  /** Unregister an agent from the hook event handler. */
  unregisterAgent(sessionId: string, providerId?: string): void {
    if (providerId) {
      this.hookEventHandlers.get(providerId)?.unregisterAgent(sessionId);
      return;
    }
    for (const handler of this.hookEventHandlers.values()) handler.unregisterAgent(sessionId);
  }

  // ── Agent removal (shared cleanup) ──

  /** Remove an agent: stop watchers, cancel timers, delete from store. */
  removeAgent(id: number): void {
    const agent = this.store.get(id);
    if (!agent) return;

    // Stop JSONL poll timer
    const jpTimer = this.jsonlPollTimers.get(id);
    if (jpTimer) {
      clearInterval(jpTimer);
    }
    this.jsonlPollTimers.delete(id);

    // Stop file watching
    this.fileWatchers.get(id)?.close();
    this.fileWatchers.delete(id);
    const pt = this.pollingTimers.get(id);
    if (pt) {
      clearInterval(pt);
    }
    this.pollingTimers.delete(id);

    // Cancel timers
    cancelWaitingTimer(id, this.waitingTimers);
    cancelPermissionTimer(id, this.permissionTimers);

    // Notify adapter before deleting from store
    this.lifecycleCallbacks.onAgentRemoved?.(id, agent);

    // Remove from store (fires agentRemoved event) and persist
    this.store.delete(id);
    this.store.persist();
  }

  /** Remove a single teammate agent. */
  removeTeammate(teammateId: number, source: string): void {
    const agent = this.store.get(teammateId);
    if (!agent) return;
    console.log(`[Pixel Agents] Removing teammate ${teammateId} (source: ${source})`);
    this.dismissalTracker.dismiss(agent.jsonlFile);
    this.unregisterAgent(agent.sessionId);
    this.lifecycleCallbacks.onTeammateRemoved?.(teammateId, agent, source);
    this.removeAgent(teammateId);
  }

  /** Remove all teammates of a lead agent. */
  removeTeammates(leadId: number): void {
    const teammates: number[] = [];
    for (const [id, agent] of this.store) {
      if (agent.leadAgentId === leadId) {
        teammates.push(id);
      }
    }
    for (const id of teammates) {
      const agent = this.store.get(id);
      if (agent) {
        console.log(`[Pixel Agents] Removing teammate ${id} (lead ${leadId} closed)`);
        this.dismissalTracker.dismiss(agent.jsonlFile);
        this.unregisterAgent(agent.sessionId);
        this.removeAgent(id);
      }
    }
  }

  // ── Scanning ──

  /** Start project-level scanning for a directory. */
  startProjectScan(projectDir: string, onAgentCreated?: (agent: AgentState) => void): void {
    ensureProjectScan(
      projectDir,
      this.knownJsonlFiles,
      this.projectScanTimer,
      this.activeAgentId,
      this.store.nextAgentId,
      this.store,
      this.fileWatchers,
      this.pollingTimers,
      this.waitingTimers,
      this.permissionTimers,
      () => this.store.persist(),
      onAgentCreated ?? ((agent) => this.registerAgent(agent.sessionId, agent.id)),
      this.hooksEnabled,
    );
  }

  /** Start external session scanning (detects sessions from other terminals). */
  startExternalScanning(projectDir: string): void {
    if (this.externalScanTimer) return;

    this.externalScanTimer = startExternalSessionScanning(
      projectDir,
      this.knownJsonlFiles,
      this.store.nextAgentId,
      this.store,
      this.fileWatchers,
      this.pollingTimers,
      this.waitingTimers,
      this.permissionTimers,
      this.jsonlPollTimers,
      () => this.store.persist(),
      this.watchAllSessions,
      this.hooksEnabled,
    );
  }

  /** Start stale external agent check (removes agents whose JSONL files are deleted). */
  startStaleCheck(): void {
    if (this.staleCheckTimer) return;

    this.staleCheckTimer = startStaleExternalAgentCheck(
      this.store,
      this.knownJsonlFiles,
      this.hooksEnabled,
    );
  }

  // ── Restore persisted external agents (standalone) ──

  /**
   * Re-create external agents from the adapter's persistence on startup.
   * Only external agents are restorable here (no terminal to rebind).
   * VS Code uses its own restoreAgents() in agentManager.ts to also handle
   * terminal agents via vscode.window.terminals.
   */
  restoreExternalAgents(): void {
    const adapter = this.store.getAdapter();
    if (!adapter) return;
    const persisted = adapter.loadAgents();
    if (persisted.length === 0) return;

    let maxId = 0;

    for (const p of persisted) {
      if (!p.isExternal) continue;
      const hasTranscript = p.jsonlFile.length > 0;
      try {
        if (hasTranscript && !fs.existsSync(p.jsonlFile)) continue;
        if (!hasTranscript && !p.hooksOnly && !p.agentKey) continue;
      } catch {
        continue;
      }
      if (this.store.has(p.id)) {
        if (hasTranscript) this.knownJsonlFiles.add(p.jsonlFile);
        if (p.id > maxId) maxId = p.id;
        continue;
      }

      const agent: AgentState = {
        id: p.id,
        sessionId: p.sessionId || path.basename(p.jsonlFile, '.jsonl'),
        terminalRef: undefined,
        isExternal: true,
        projectDir: p.projectDir,
        jsonlFile: p.jsonlFile,
        fileOffset: 0,
        lineBuffer: '',
        activeToolIds: new Set(),
        activeToolStatuses: new Map(),
        activeToolNames: new Map(),
        activeSubagentToolIds: new Map(),
        activeSubagentToolNames: new Map(),
        backgroundAgentToolIds: new Set(),
        isWaiting: p.agentKey !== undefined,
        permissionSent: false,
        hadToolsInTurn: false,
        lastDataAt: 0,
        linesProcessed: 0,
        seenUnknownRecordTypes: new Set(),
        folderName: p.folderName,
        hookDelivered: false,
        hooksOnly: p.hooksOnly,
        providerId: p.providerId,
        agentKey: p.agentKey,
        displayName: p.displayName,
        role: p.role,
        model: p.model,
        inputTokens: 0,
        outputTokens: 0,
        teamName: p.teamName,
        agentName: p.agentName,
        isTeamLead: p.isTeamLead,
        leadAgentId: p.leadAgentId,
        teamUsesTmux: p.teamUsesTmux,
      };

      this.store.set(p.id, agent);
      if (hasTranscript) this.knownJsonlFiles.add(p.jsonlFile);

      if (hasTranscript) {
        try {
          const stat = fs.statSync(p.jsonlFile);
          agent.fileOffset = stat.size;
          startFileWatching(
            p.id,
            p.jsonlFile,
            this.store,
            this.fileWatchers,
            this.pollingTimers,
            this.waitingTimers,
            this.permissionTimers,
          );
        } catch {
          /* ignore stat errors on restore */
        }
      }

      if (!agent.sessionId.startsWith('roster:')) {
        this.registerAgent(agent.sessionId, agent.id, agent.providerId);
      }

      if (p.id > maxId) maxId = p.id;
      console.log(
        `[Pixel Agents] Restored external agent ${p.id} -> ${path.basename(p.jsonlFile)}`,
      );
    }

    if (maxId >= this.store.nextAgentId.current) {
      this.store.nextAgentId.current = maxId + 1;
    }

    this.store.persist();
  }

  // ── Cleanup ──

  /** Clean up all scanners, timers, and agents. Called on shutdown. */
  dispose(): void {
    for (const handler of this.hookEventHandlers.values()) handler.dispose();

    if (this.projectScanTimer.current) {
      clearInterval(this.projectScanTimer.current);
      this.projectScanTimer.current = null;
    }
    if (this.externalScanTimer) {
      clearInterval(this.externalScanTimer);
      this.externalScanTimer = null;
    }
    if (this.staleCheckTimer) {
      clearInterval(this.staleCheckTimer);
      this.staleCheckTimer = null;
    }

    for (const id of [...this.store.keys()]) {
      if (this.store.get(id)?.agentKey) continue;
      this.removeAgent(id);
    }
    this.store.persist();
  }
}
