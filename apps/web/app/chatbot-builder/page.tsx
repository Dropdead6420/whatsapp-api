import { ModuleComingSoon } from "../../src/components/ModuleComingSoon";

export default function ChatbotBuilderPage() {
  return (
    <ModuleComingSoon
      title="Chatbot Builder"
      description="Design conversational WhatsApp bots for FAQs, lead capture, appointment booking, routing, and handoff to human agents."
      highlights={[
        "No-code conversation blocks",
        "FAQ and lead-capture starter flows",
        "Agent handoff rules",
        "Sandbox testing before publishing",
      ]}
    />
  );
}
