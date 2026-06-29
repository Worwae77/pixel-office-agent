# Pixel Office Agent architecture

## Goal

Run the Pixel Agents browser office on a homelab and represent six persistent
workers: Hermes, Codex, Gemini, Qwen, DeepSeek, and GLM. Each worker has a stable
identity and role even when its underlying model or CLI changes.

## Required separation

The implementation must keep these concepts independent:

1. **Agent identity**: stable ID, display name, sprite, seat, and role.
2. **Execution runtime**: Hermes CLI, Codex CLI, Gemini CLI, Qwen Code, or a
   generic worker process.
3. **Model backend**: cloud API, Ollama, vLLM, or another OpenAI-compatible
   endpoint. DeepSeek and GLM commonly belong here rather than being treated as
   lifecycle protocols.
4. **Event adapter**: converts runtime-specific lifecycle events into the
   existing canonical `AgentEvent` union.

This prevents a model change from deleting an employee's history or changing
its office identity.

## Target data flow

```text
Agent runtime / CLI
        |
        | lifecycle hook, JSONL tail, or event stream
        v
Provider adapter
        |
        | canonical AgentEvent
        v
AgentRuntime -> AgentStateStore -> WebSocket -> browser office
```

## Initial role map

| Agent | Default role | Runtime integration |
| --- | --- | --- |
| Hermes | Chief of staff / task router | Hermes lifecycle hooks |
| Codex | Software engineer | Codex CLI notification/event adapter |
| Gemini | Researcher | Gemini CLI hooks |
| Qwen | Test engineer | Qwen Code HTTP hooks |
| DeepSeek | Reviewer | Generic worker using an OpenAI-compatible model endpoint |
| GLM | Technical writer | Generic worker using an OpenAI-compatible model endpoint |

The role map is a default, not an authorization boundary. Tool permissions and
filesystem scopes must be configured independently.

## Delivery phases

### Phase 1: self-hosted baseline

- Build and serve the existing Fastify/browser application.
- Bind to `0.0.0.0` only when protected by the homelab reverse proxy.
- Persist `~/.pixel-agents` across restarts.
- Keep the health endpoint available to the container orchestrator.

### Phase 2: provider registry

- Change `AgentRuntime` from one `HookProvider` to a registry keyed by provider
  ID.
- Give each provider its own normalizer and session router.
- Persist `providerId`, `agentKey`, and `role` with every agent.
- Reject hook events for unknown providers instead of normalizing all payloads
  as Claude events.

### Phase 3: roster and orchestration

- Load a validated roster file based on `config/agents.example.json`.
- Map new sessions to stable roster entries.
- Add a task queue and explicit assignment API; do not let agents select work
  merely because they are idle.
- Add per-role tool policies and workspace allowlists.

### Phase 4: operations and security

- Put the browser behind TLS and homelab SSO or an authenticated reverse proxy.
- Rotate the hook bearer token and never expose it to the browser URL.
- Add audit logs for task assignment, permission requests, and tool execution.
- Add backups for layout, roster, and task history.

## Container limitation

The office container can serve the UI and receive hook events, but it cannot
automatically install hooks into CLIs running on the Docker host. Host-side
agent runtimes must be configured to post to the published office endpoint, or
their configuration directories must be mounted intentionally. Avoid mounting
the Docker socket or the entire home directory. Container startup uses
`--no-manage-hooks` so it never writes a misleading in-container CLI config.
