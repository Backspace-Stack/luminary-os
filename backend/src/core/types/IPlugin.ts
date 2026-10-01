// ============================================================
// IPlugin — Core contract for all Luminary OS plugins.
//
// Plugins extend agent capabilities with access to external
// systems: browsers, OS file systems, terminals, IoT devices.
// They are discovered and registered automatically by the
// PluginRegistry at boot time.
// ============================================================

export type PluginStatus = 'active' | 'inactive' | 'error' | 'initialising';

export interface PluginCapability {
  /** e.g. "screenshot", "file-read", "shell-exec" */
  action: string;
  description: string;
  /** JSON Schema describing the expected input payload */
  inputSchema?: Record<string, unknown>;
  /** JSON Schema describing the output payload */
  outputSchema?: Record<string, unknown>;
  /**
   * When true, the agent loop must pause and get explicit user approval
   * before this action runs (e.g. writes, deletes). Read-only actions
   * leave it false/undefined and execute without interruption.
   */
  requiresConfirmation?: boolean;
}

export interface PluginAction {
  /** Which capability to invoke */
  action: string;
  /** Action-specific payload */
  payload: Record<string, unknown>;
  /** Request context for audit logging */
  requestId: string;
  agentId: string;
}

export interface PluginResult {
  success: boolean;
  data?: unknown;
  error?: string;
  durationMs?: number;
}

export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  description: string;
  author?: string;
  capabilities: PluginCapability[];
  requiresConfig?: string[];
}

/**
 * IPlugin — Every plugin must implement this interface.
 *
 * Agents obtain plugin instances from the PluginRegistry and
 * call execute() with a typed PluginAction. Plugins are
 * responsible for their own initialisation and teardown.
 */
export interface IPlugin {
  readonly manifest: PluginManifest;

  /** Called by the Kernel during boot. Set up connections, verify deps. */
  initialize(): Promise<void>;

  /** Clean up open handles, connections, etc. */
  shutdown(): Promise<void>;

  /** Whether this plugin is ready to accept actions. */
  isAvailable(): boolean;

  /** Current runtime status for observability. */
  getStatus(): PluginStatus;

  /** Execute a capability action. */
  execute(action: PluginAction): Promise<PluginResult>;
}
