import { MessageNodeConfig } from './MessageNodeConfig';
import { ConditionNodeConfig } from './ConditionNodeConfig';
import { AddTagNodeConfig } from './AddTagNodeConfig';
import { DelayNodeConfig } from './DelayNodeConfig';
import { WebhookNodeConfig } from './WebhookNodeConfig';
import { AINodeConfig } from './AINodeConfig';
import { NoConfigNodeConfig } from './NoConfigNodeConfig';
import type { NodeConfiguratorComponent } from './types';

export const NODE_CONFIGURATOR_MAP: Record<string, NodeConfiguratorComponent> = {
  START: NoConfigNodeConfig,
  END: NoConfigNodeConfig,
  MESSAGE: MessageNodeConfig,
  SEND_TEMPLATE: NoConfigNodeConfig,
  CREATE_LEAD: NoConfigNodeConfig,
  CONDITION: ConditionNodeConfig,
  DELAY: DelayNodeConfig,
  ADD_TAG: AddTagNodeConfig,
  AGENT_TRANSFER: NoConfigNodeConfig,
  AI_RESPONSE: AINodeConfig,
  WEBHOOK: WebhookNodeConfig,
  WAIT_FOR_REPLY: NoConfigNodeConfig,
  SWITCH: NoConfigNodeConfig,
  FILTER: NoConfigNodeConfig,
  AI_CLASSIFY_INTENT: AINodeConfig,
  AI_SUMMARIZE: AINodeConfig,
  AI_EXTRACT_DATA: AINodeConfig,
  AI_TRANSLATE: AINodeConfig,
  AI_COMPLIANCE_CHECK: AINodeConfig,
};

export function getNodeConfigurator(nodeType: string): NodeConfiguratorComponent {
  return NODE_CONFIGURATOR_MAP[nodeType] || NoConfigNodeConfig;
}
