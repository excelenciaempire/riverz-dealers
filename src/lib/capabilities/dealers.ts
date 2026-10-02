import type { Capability } from './types';
import type { DealerData } from '@/lib/dealers/types';
import { readDealerData } from '@/lib/dealers/server';
import { salesActions, salesMetrics } from '@/lib/dealers/sales-execution';
export const DEALER_CAPABILITIES: Capability[] = [
  {
    key: 'dealers.estado',
    risk: 'lectura',
    description:
      'Consulta inventario, compradores, prioridades BDC y embudo real de 30 días para la cuenta de un vendedor de carros.',
    descriptionEn:
      'Read the seller’s inventory, buyer priorities and actual 30-day dealer funnel.',
    schema: { type: 'object', properties: {} },
    async run(ctx) {
      const data = (await readDealerData(
        ctx.db,
        ctx.workspaceId,
        ''
      )) as unknown as DealerData;
      return {
        availableVehicles: data.vehicles.filter((v) => v.status === 'available')
          .length,
        metrics: salesMetrics(data),
        priorities: salesActions(data)
          .slice(0, 20)
          .map((a) => ({
            opportunity_id: a.opportunity.id,
            contact_id: a.opportunity.contact_id,
            buyer: data.contacts.find((c) => c.id === a.opportunity.contact_id)
              ?.name,
            reason: a.reason,
            at: a.at,
            preferences: a.opportunity.preferences,
            objection: a.opportunity.objection,
            next_step: a.opportunity.follow_up_note,
          })),
        checked_at: new Date().toISOString(),
      };
    },
  },
];
