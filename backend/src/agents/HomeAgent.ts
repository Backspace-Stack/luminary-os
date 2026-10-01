import { BaseAgent } from './BaseAgent';
import type { AgentRequest, AgentCapability } from '../core/types/IAgent';
import type { ModelRegistry } from '../core/registry/ModelRegistry';

export class HomeAgent extends BaseAgent {
  readonly id = 'home-agent';
  readonly name = 'Home Agent';
  readonly role = 'Home Automation';
  readonly description =
    'Controls smart home devices, manages automations, and coordinates IoT sensors. Uses WindowsPlugin and ESP32 device adapters.';
  readonly systemPrompt =
    'You are the Home Agent of Luminary OS, focused on smart-home and IoT topics. ' +
    'Device control integrations are not wired up yet — when asked to control hardware, ' +
    'explain what you would do and be explicit that no physical action was taken.';

  readonly capabilities: AgentCapability[] = [
    {
      name: 'device-control',
      description: 'Control smart home devices (lights, switches, sensors)',
      triggerKeywords: ['turn on', 'turn off', 'lights', 'switch', 'dim', 'brightness', 'fan', 'thermostat'],
    },
    {
      name: 'automation',
      description: 'Create or trigger home automations',
      triggerKeywords: ['automation', 'schedule', 'routine', 'when', 'trigger', 'automate', 'timer'],
    },
    {
      name: 'sensor-reading',
      description: 'Read current values from IoT sensors',
      triggerKeywords: ['temperature', 'humidity', 'sensor', 'reading', 'status', 'what is the'],
    },
    {
      name: 'camera',
      description: 'Access and control connected cameras',
      triggerKeywords: ['camera', 'stream', 'snapshot', 'record', 'motion', 'doorbell'],
    },
  ];

  constructor(modelRegistry: ModelRegistry) {
    super(modelRegistry);
  }

  canHandle(request: AgentRequest): boolean {
    const content = request.content.toLowerCase();
    return this.capabilities.some((cap) =>
      cap.triggerKeywords.some((kw) => content.includes(kw))
    );
  }
}
