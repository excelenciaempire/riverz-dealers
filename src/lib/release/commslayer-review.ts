/** Private preparation; these definitions do not publish a feature or a price. */
export const releaseScenarios = [
  { id: 'inbox', steps: ['inbox1', 'inbox2', 'inbox3'] },
  { id: 'campaign', steps: ['campaign1', 'campaign2', 'campaign3'] },
  { id: 'order', steps: ['order1', 'order2', 'order3'] },
  { id: 'internal', steps: ['internal1', 'internal2', 'internal3'] },
  { id: 'approval', steps: ['approval1', 'approval2', 'approval3'] },
  { id: 'voice', steps: ['voice1', 'voice2', 'voice3'] },
] as const;
export const releaseExamples = ['fashion', 'beauty', 'cod'] as const;
export const releaseIntegrationGuides = ['shopify', 'whatsapp', 'dropi', 'documents', 'http', 'mobile'] as const;
export const releaseUpdates = ['updateTeam', 'updateAssistant', 'updateGrowth', 'updateOrders', 'updateReports'] as const;
export const releasePricingEvidence = {
  checkedAt: '2026-10-02T04:07:09.406Z',
  riverz: { source: 'current_billing_plans_public_slugs', balanceMonthly: 399, contactTiers: [
    { contacts: 500, monthly: 399 }, { contacts: 2000, monthly: 999 }, { contacts: 5000, monthly: 1999 }, { contacts: 10000, monthly: 3499 },
  ] },
  commslayer: { source: 'https://www.commslayer.com/pricing', freeConversations: 300,
    plus: { monthlyFrom: 39, conversations: 800, aiMessages: 1600 },
    scale: { monthlyFrom: 299, conversations: 6000, aiMessages: 12000 },
    extraConversation: 0.15, extraAiMessage: 0.075 },
  currency: 'USD', publication: 'private_review_only', equivalentBillingUnits: false,
} as const;
