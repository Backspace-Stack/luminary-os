# Extending Luminary

Keep the current contracts and Kernel composition root. Registration is explicit; there is no external plugin installer or automatic directory loader.

## A small plugin

Create `backend/src/plugins/hello/HelloPlugin.ts`:

```ts
import { BasePlugin } from '../BasePlugin';
import type { PluginAction, PluginManifest, PluginResult } from '../../core/types/IPlugin';

export class HelloPlugin extends BasePlugin {
  readonly manifest: PluginManifest = {
    id: 'hello-plugin', name: 'Hello', version: '0.1.0',
    description: 'A minimal read-only example.',
    capabilities: [{
      action: 'hello', description: 'Return a greeting for a supplied name.',
      inputSchema: { type: 'object', properties: { name: {type:'string'} }, required: ['name'] },
    }],
  };
  protected async onInitialize(): Promise<void> {}
  async execute(action: PluginAction): Promise<PluginResult> {
    if (action.action !== 'hello') return this.notImplemented(action.action);
    const name = action.payload.name;
    if (typeof name !== 'string' || name.length > 100) return {success:false,error:'A name up to 100 characters is required.'};
    return {success:true,data:{greeting:`Hello, ${name}.`}};
  }
}
```

Register `new HelloPlugin()` in `Kernel.registerPlugins()` and add its id to an agent's `allowedPlugins`. Capability names must be unique among the plugins exposed by that agent. JSON schema tells the model how to call the tool; it does not validate incoming arguments at runtime. Validate inside `execute()` as the example does. A mutating or sensitive capability must set `requiresConfirmation: true`; the agent loop then parks its exact payload for approval. Do not directly call a mutating plugin from an unauthenticated route.

## An agent

Extend `BaseAgent` following `CodingAgent` or `ResearchAgent`. Define id/name/role, system prompt, capabilities/trigger keywords, `canHandle`, and narrow `allowedPlugins`. Register the concrete class in Kernel. Model selection uses existing assignments and provider discovery; do not hardcode fictional installed models. Tests should exercise both provider tool availability and unavailable-tool behavior.

## A provider

Implement `IModelProvider` and register it in Kernel's model registration. Required methods cover health, discovery, load/unload, completion and embeddings. Streaming and structured tool calling are optional contracts: implement `supportsTools` and `chatWithTools` together only when supported. Normalize real model ids/status, propagate upstream failures, honor abort signals, and never fabricate token counts, models or responses.

Keep credentials in `SecretsService`, do not log them, and document the data sent to the provider. Add mocked HTTP-boundary tests so CI requires no credentials or upstream server. The abstraction is an internal TypeScript extension interface, not a stable packaged SDK.
