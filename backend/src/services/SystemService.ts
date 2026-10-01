// ============================================================
// SystemService — Live system status aggregation.
//
// Pulls data from all registries, services, and the Kernel
// to produce a single cohesive status snapshot for the UI.
// ============================================================

import os from 'os';
import { execFile } from 'child_process';
import { agentRegistry } from '../core/registry/AgentRegistry';
import { pluginRegistry } from '../core/registry/PluginRegistry';
import { modelRegistry } from '../core/registry/ModelRegistry';
import { kernel } from '../core/kernel/Kernel';
import { deviceService } from './DeviceService';
import { memoryService } from './MemoryService';

// ── Real resource metrics (no fabricated numbers) ─────────────

/** CPU busy % computed from os.cpus() time deltas between calls. */
let prevCpuTimes = os.cpus().map((c) => c.times);
function sampleCpuPercent(): number {
  const current = os.cpus().map((c) => c.times);
  let busy = 0;
  let total = 0;
  for (let i = 0; i < current.length && i < prevCpuTimes.length; i++) {
    const prev = prevCpuTimes[i];
    const cur = current[i];
    const dIdle = cur.idle - prev.idle;
    const dTotal = (cur.user - prev.user) + (cur.nice - prev.nice) +
                   (cur.sys - prev.sys) + (cur.irq - prev.irq) + dIdle;
    busy += dTotal - dIdle;
    total += dTotal;
  }
  prevCpuTimes = current;
  return total > 0 ? Math.round((busy / total) * 100) : 0;
}

/**
 * GPU utilization from Windows performance counters (real GPU
 * engine busy %, works for NVIDIA/AMD/Intel). Sampled in the
 * background because typeperf takes ~1s; snapshot reads the
 * latest completed sample. Unknown until the first valid sample lands,
 * or when the counter source becomes unavailable.
 */
let gpuPercentCache: number | null = null;
let gpuSampleInFlight = false;
let gpuLastSampledAt = 0;

/** Parse typeperf's quoted CSV without treating absent/invalid values as idle. */
export function parseGpuPercent(stdout: string): number | null {
  const lines = stdout.replace(/^\uFEFF/, '').split(/\r?\n/).map(line => line.trim());
  const fields = (line: string): string[] | null => {
    if (!/^"(?:[^"]|"")*"(?:,"(?:[^"]|"")*")*$/.test(line)) return null;
    return [...line.matchAll(/"((?:[^"]|"")*)"(?:,|$)/g)].map(match => match[1].replace(/""/g, '"'));
  };
  const headerIndex = lines.findIndex(line => line.includes('(PDH-CSV'));
  if (headerIndex < 0) return null;
  const header = fields(lines[headerIndex]);
  if (!header || header.length < 2 || !header.slice(1).every(name => /\\GPU Engine\(.+\)\\Utilization Percentage$/i.test(name))) return null;
  const sample = fields(lines[headerIndex + 1] ?? '');
  if (!sample || sample.length !== header.length) return null;
  const values = sample.slice(1).map(value => {
    const text = value.trim();
    return /^(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(text) ? Number(text) : NaN;
  });
  if (values.some(value => !Number.isFinite(value) || value < 0 || value > 100)) return null;
  return Math.min(100, Math.round(values.reduce((sum, value) => sum + value, 0)));
}

function refreshGpuPercent(): void {
  if (gpuSampleInFlight || Date.now() - gpuLastSampledAt < 5_000) return;
  gpuSampleInFlight = true;
  if (process.platform !== 'win32') { gpuPercentCache = null; gpuSampleInFlight = false; return; }
  execFile(
    'typeperf',
    ['\\GPU Engine(*engtype_3D)\\Utilization Percentage', '-sc', '1'],
    { timeout: 8_000, windowsHide: true },
    (err, stdout) => {
      gpuSampleInFlight = false;
      gpuLastSampledAt = Date.now();
      gpuPercentCache = err ? null : parseGpuPercent(stdout);
    },
  );
}

export interface SystemSnapshot {
  version: string;
  uptime: string;
  uptimeMs: number;
  agents: {
    total: number;
    active: number;
    activeAgentName: string | null;
    activeModelName: string | null;
  };
  tasks: {
    running: number;
    total: number;
  };
  plugins: {
    total: number;
    active: number;
  };
  devices: {
    total: number;
    online: number;
    offline: number;
  };
  memory: {
    total: number;
    providerStatus: string;
  };
  providers: {
    total: number;
    defaultId: string | null;
  };
  resources: {
    cpuPercent: number;
    gpuPercent: number | null;
    ramUsedGB: number;
    ramTotalGB: number;
  };
}

function formatUptime(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  const d = Math.floor(h / 24);
  if (d > 0) return `${d}d ${h % 24}h ${m % 60}m`;
  if (h > 0) return `${h}h ${m % 60}m`;
  return `${m}m ${s % 60}s`;
}

export class SystemService {

  async getSnapshot(): Promise<SystemSnapshot> {
    const uptimeMs = kernel.getUptimeMs();
    const agents = agentRegistry.getAll();
    const activeAgents = agents.filter((a) => a.getStatus() !== 'idle' && a.getStatus() !== 'disabled');
    const plugins = pluginRegistry.getAll();
    const deviceStats = deviceService.stats();
    const memStats = await memoryService.stats();
    const providers = modelRegistry.getAll();

    // Active agent = first non-idle agent (future: track by session)
    const primaryActive = activeAgents[0] ?? null;
    const primaryMeta = primaryActive?.getMetadata() ?? null;

    // Running tasks = sum of activeTasks across all agents
    const runningTasks = agents.reduce((sum, a) => sum + (a.getMetadata().activeTasks ?? 0), 0);

    return {
      version: '0.1.0',
      uptime: formatUptime(uptimeMs),
      uptimeMs,
      agents: {
        total: agents.length,
        active: activeAgents.length,
        activeAgentName: primaryMeta?.name ?? null,
        activeModelName: primaryMeta?.defaultModel || null,
      },
      tasks: {
        running: runningTasks,
        total: runningTasks, // future: track queued separately
      },
      plugins: {
        total: plugins.length,
        active: plugins.filter((p) => p.isAvailable()).length,
      },
      devices: deviceStats,
      memory: {
        total: memStats.total,
        providerStatus: memStats.providerHealth.status,
      },
      providers: {
        total: providers.length,
        defaultId: providers[0]?.id ?? null,
      },
      // Real OS metrics — CPU from time deltas, RAM from the OS,
      // GPU from Windows performance counters (async-sampled).
      resources: this.realResources(),
    };
  }

  private realResources(): SystemSnapshot['resources'] {
    refreshGpuPercent(); // kick background sample; read latest below
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    return {
      cpuPercent: sampleCpuPercent(),
      gpuPercent: gpuPercentCache,
      ramUsedGB: Math.round(((totalMem - freeMem) / 1024 ** 3) * 10) / 10,
      ramTotalGB: Math.round((totalMem / 1024 ** 3) * 10) / 10,
    };
  }
}

export const systemService = new SystemService();
