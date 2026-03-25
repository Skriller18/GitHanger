import os from 'node:os';
import path from 'node:path';
import { z } from 'zod';

/**
 * Default data dir. Overridable later via env/config.
 */
export function defaultDataDir() {
  return path.join(os.homedir(), '.githanger');
}

export const ProviderSchema = z.enum(['claude', 'codex', 'copilot']);
export type Provider = z.infer<typeof ProviderSchema>;

export const AgentSessionSchema = z.object({
  id: z.string(),
  name: z.string(),
  provider: ProviderSchema,
  repoPath: z.string(),
  worktreePath: z.string(),
  branch: z.string(),
  pid: z.number().nullable(),
  status: z.enum(['running', 'stopped', 'crashed']),
  startedAt: z.number(),
  endedAt: z.number().nullable(),
});
export type AgentSession = z.infer<typeof AgentSessionSchema>;

export const AgentEventSchema = z.object({
  ts: z.number(),
  sessionId: z.string(),
  kind: z.enum(['started', 'heartbeat', 'stdout', 'stderr', 'stopped', 'crashed']),
  message: z.string().optional(),
});
export type AgentEvent = z.infer<typeof AgentEventSchema>;
