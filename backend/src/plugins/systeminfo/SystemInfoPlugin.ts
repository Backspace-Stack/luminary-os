// ============================================================
// SystemInfoPlugin — On-demand access to SystemInfoService.
//
// A thin wrapper: agents that already use tools can call getStatus()
// mid-loop to check CURRENT state (e.g. DB size right now) rather than
// only what was true at the start of the turn. Read-only, non-
// destructive — requiresConfirmation is always false.
// ============================================================

import { BasePlugin } from '../BasePlugin';
import type { PluginAction, PluginResult, PluginManifest } from '../../core/types/IPlugin';
import { systemInfoService } from '../../services/SystemInfoService';

export class SystemInfoPlugin extends BasePlugin {
  readonly manifest: PluginManifest = {
    id: 'systeminfo-plugin',
    name: 'System Info Plugin',
    version: '0.1.0',
    description: "Report real, verified facts about Lumen's current configuration and state — never estimates.",
    capabilities: [
      {
        action: 'getStatus',
        description:
          'Return real, current system status: memory row count and database size, ' +
          'automatic-recall configuration (top-K and similarity floor), registered agents ' +
          'and their tools, and process uptime.',
        inputSchema: { type: 'object', properties: {} },
        requiresConfirmation: false,
      },
    ],
  };

  protected async onInitialize(): Promise<void> {
    this.logger.info('SystemInfoPlugin ready (getStatus)');
  }

  async execute(action: PluginAction): Promise<PluginResult> {
    if (action.action !== 'getStatus') return this.notImplemented(action.action);

    try {
      const status = await systemInfoService.getStatus();
      this.logger.debug('getStatus called', { requestId: action.requestId, agentId: action.agentId });
      return { success: true, data: status };
    } catch (err) {
      return { success: false, error: `Failed to read system status: ${err instanceof Error ? err.message : String(err)}` };
    }
  }
}
