/**
 * Node configurator types and interfaces
 */

export interface NodeConfig {
  [key: string]: unknown;
}

export interface NodeConfiguratorProps {
  node: {
    id: string;
    type: string;
    config: NodeConfig;
  };
  onConfigChange: (config: NodeConfig) => void;
  onDelete?: () => void;
  nodeDescription?: string;
}

export type NodeConfiguratorComponent = React.FC<NodeConfiguratorProps>;

export const NODE_DESCRIPTIONS: Record<string, string> = {
  START: 'Entry point for the flow. No configuration needed.',
  END: 'Exit point for the flow. Ends the automation.',
  MESSAGE: 'Send a text message to the customer.',
  SEND_TEMPLATE: 'Send a pre-approved WhatsApp template.',
  CREATE_LEAD: 'Create a new lead from the message.',
  CONDITION: 'Branch the flow based on a condition (if/else).',
  DELAY: 'Pause the flow for a specified duration.',
  ADD_TAG: 'Add a tag to the contact for organization.',
  AGENT_TRANSFER: 'Transfer the conversation to a human agent.',
  AI_RESPONSE: 'Generate a response using AI based on message content.',
  WEBHOOK: 'Call an external API or webhook.',
  WAIT_FOR_REPLY: 'Pause and wait for the customer to reply.',
  SWITCH: 'Route to different paths based on a value.',
  FILTER: 'Filter messages based on conditions.',
  AI_CLASSIFY_INTENT: 'Classify the message intent using AI.',
  AI_SUMMARIZE: 'Summarize the message content.',
  AI_EXTRACT_DATA: 'Extract structured data from the message.',
  AI_TRANSLATE: 'Translate the message to another language.',
  AI_COMPLIANCE_CHECK: 'Check message for compliance issues.',
};
