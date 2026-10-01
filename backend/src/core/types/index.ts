// ============================================================
// core/types — Single import point for all Luminary OS contracts.
//
// Every module imports interfaces from here, never from
// concrete implementation files. This enforces the
// Dependency Inversion Principle throughout the codebase.
//
//   ✅  import type { IAgent } from '@core/types';
//   ❌  import { ConversationAgent } from '@agents/ConversationAgent';
// ============================================================

export type {
  AgentRequest,
  AgentResponse,
  AgentStatus,
  AgentCapability,
  AgentMetadata,
  ConversationTurn,
  IAgent,
} from './IAgent';

export type {
  ModelInfo,
  CompletionOptions,
  CompletionResponse,
  EmbeddingOptions,
  EmbeddingResponse,
  ProviderStatus,
  ProviderHealth,
  IModelProvider,
} from './IModelProvider';

export type {
  PluginStatus,
  PluginCapability,
  PluginAction,
  PluginResult,
  PluginManifest,
  IPlugin,
} from './IPlugin';

export type {
  DeviceType,
  DeviceStatus,
  DeviceCapability,
  DeviceInfo,
  DeviceCommand,
  DeviceCommandResult,
  IDevice,
} from './IDevice';

export type {
  MemoryType,
  Importance,
  MemoryEntry,
  MemoryQuery,
  MemoryWriteResult,
  IMemoryProvider,
} from './IMemoryProvider';
