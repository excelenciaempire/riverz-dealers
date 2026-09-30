// Requires STRIPE_SECRET_KEY; dry-run by default. --apply performs the owner's
// authorized correction: USD 99 for months 1–3, USD 399 from month 4.
import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const subscriptionId = 'sub_1U9sWfL0pSUS73AdEbDV2BFE';
const sourceInvoiceId = 'in_1UL7JaL0pSUS73Adtn2W3Cmq';
const workspaceId = '522a68ae-568d-4dd9-92e5-2c8f633f1761';
const pilotEnd = 1795982813; // 2026-11-29T20:06:53Z; month 4 starts here.
const key = `riverz-pilar-renewal-correction-${sourceInvoiceId}`;
const sub = await stripe.subscriptions.retrieve(subscriptionId);
const source = await stripe.invoices.retrieve(sourceInvoiceId);
if (
  sub.metadata.workspace_id !== workspaceId ||
  sub.status !== 'active' ||
  source.status !== 'paid' ||
  source.total !== 0 ||
  source.subtotal !== 9900 ||
  source.customer !== sub.customer ||
  sub.items.data.length !== 1
) {
  throw new Error(
    'Pilar subscription or source invoice differs from the reviewed correction.'
  );
}
const product = sub.items.data[0].price.product;
const prices = await stripe.prices.list({
  product: typeof product === 'string' ? product : product.id,
  active: true,
  limit: 100,
});
const price = (amount) =>
  prices.data.find(
    (p) =>
      p.unit_amount === amount &&
      p.currency === 'usd' &&
      p.recurring?.interval === 'month' &&
      p.recurring.interval_count === 1 &&
      p.recurring.usage_type === 'licensed'
  );
const pilot = price(9900),
  standard = price(39900);
if (!pilot || !standard)
  throw new Error(
    'The existing USD 99 and USD 399 monthly prices are required.'
  );
const customerId =
  typeof sub.customer === 'string' ? sub.customer : sub.customer.id;
const cards = await stripe.paymentMethods.list({
  customer: customerId,
  type: 'card',
  limit: 100,
});
const setups = await stripe.setupIntents.list({
  customer: customerId,
  limit: 100,
});
const authorizedCards = cards.data.filter((card) =>
  setups.data.some(
    (s) =>
      s.payment_method === card.id &&
      s.status === 'succeeded' &&
      s.usage === 'off_session'
  )
);
const paymentMethod =
  authorizedCards.length === 1 ? authorizedCards[0].id : null;
if (!paymentMethod)
  throw new Error(
    'One unambiguous saved card with a successful off-session authorization is required.'
  );
const report = {
  subscriptionId,
  sourceInvoiceId,
  pilotMonthlyUsd: 99,
  standardMonthlyUsd: 399,
  standardStartsAt: new Date(pilotEnd * 1000).toISOString(),
  correctionUsd: 99,
};
if (!process.argv.includes('--apply')) {
  console.log(JSON.stringify({ ...report, dryRun: true }));
} else {
  let schedule = sub.schedule
    ? await stripe.subscriptionSchedules.retrieve(
        typeof sub.schedule === 'string' ? sub.schedule : sub.schedule.id
      )
    : await stripe.subscriptionSchedules.create(
        { from_subscription: sub.id },
        { idempotencyKey: `${key}-schedule` }
      );
  if (sub.schedule && schedule.metadata.correction_key !== key)
    throw new Error('An unrelated schedule already owns the subscription.');
  schedule = await stripe.subscriptionSchedules.update(
    schedule.id,
    {
      end_behavior: 'release',
      proration_behavior: 'none',
      default_settings: { default_payment_method: paymentMethod },
      metadata: { correction_key: key },
      phases: [
        {
          start_date: schedule.current_phase.start_date,
          end_date: pilotEnd,
          items: [{ price: pilot.id, quantity: 1 }],
          discounts: [],
          default_payment_method: paymentMethod,
          proration_behavior: 'none',
          metadata: {
            ...sub.metadata,
            billing_agreement: 'scheduled_fixed_price',
          },
        },
        {
          start_date: pilotEnd,
          duration: { interval: 'month', interval_count: 1 },
          items: [{ price: standard.id, quantity: 1 }],
          discounts: [],
          default_payment_method: paymentMethod,
          proration_behavior: 'none',
          metadata: {
            ...sub.metadata,
            billing_agreement: 'scheduled_fixed_price',
          },
        },
      ],
    },
    { idempotencyKey: `${key}-phases-card-${paymentMethod}` }
  );
  const fresh = await stripe.subscriptions.retrieve(sub.id);
  const preview = await stripe.invoices.createPreview({ subscription: sub.id });
  if (
    fresh.items.data[0].price.unit_amount !== 9900 ||
    (fresh.discounts?.length ?? 0) !== 0 ||
    preview.total !== 9900
  ) {
    throw new Error(
      'The next renewal must be USD 99 without discounts before collecting the correction.'
    );
  }
  const existing = await stripe.invoices.list({
    customer: typeof sub.customer === 'string' ? sub.customer : sub.customer.id,
    limit: 100,
  });
  let invoice = existing.data.find((i) => i.metadata.correction_key === key);
  if (!invoice) {
    invoice = await stripe.invoices.create(
      {
        customer:
          typeof sub.customer === 'string' ? sub.customer : sub.customer.id,
        auto_advance: false,
        collection_method: 'charge_automatically',
        pending_invoice_items_behavior: 'exclude',
        discounts: [],
        ...(sub.default_payment_method
          ? {
              default_payment_method:
                typeof sub.default_payment_method === 'string'
                  ? sub.default_payment_method
                  : sub.default_payment_method.id,
            }
          : {}),
        metadata: {
          kind: 'riverz_subscription_correction',
          correction_key: key,
          source_invoice: sourceInvoiceId,
          subscription_id: sub.id,
          workspace_id: workspaceId,
        },
        description:
          'Riverz · Mensualidad septiembre 2026 · Corrección del descuento piloto',
      },
      { idempotencyKey: `${key}-invoice` }
    );
  }
  if (invoice.status === 'draft') {
    if (invoice.lines.data.length === 0)
      await stripe.invoiceItems.create(
        {
          customer:
            typeof sub.customer === 'string' ? sub.customer : sub.customer.id,
          invoice: invoice.id,
          amount: 9900,
          currency: 'usd',
          discountable: false,
          description: 'Riverz · Segundo mes del piloto (29 sep – 29 oct 2026)',
        },
        { idempotencyKey: `${key}-item` }
      );
    invoice = await stripe.invoices.finalizeInvoice(
      invoice.id,
      { auto_advance: false },
      { idempotencyKey: `${key}-finalize` }
    );
  }
  if (invoice.total !== 9900 || invoice.currency !== 'usd')
    throw new Error('Correction must total exactly USD 99.');
  if (invoice.status === 'open') {
    try {
      invoice = await stripe.invoices.pay(
        invoice.id,
        { payment_method: paymentMethod },
        { idempotencyKey: `${key}-pay-${paymentMethod}` }
      );
    } catch (error) {
      console.log(
        JSON.stringify({
          paymentError: error.code ?? error.type,
          declineCode: error.decline_code ?? null,
          message: error.message,
        })
      );
      invoice = await stripe.invoices.retrieve(invoice.id);
    }
  }
  console.log(
    JSON.stringify({
      ...report,
      scheduleId: schedule.id,
      nextRenewalUsd: preview.total / 100,
      correctionInvoiceId: invoice.id,
      correctionStatus: invoice.status,
      amountPaidUsd: invoice.amount_paid / 100,
      phases: schedule.phases.map((p) => ({
        start: new Date(p.start_date * 1000).toISOString(),
        end: new Date(p.end_date * 1000).toISOString(),
        price: p.items[0].price,
        discounts: p.discounts.length,
      })),
    })
  );
  if (invoice.status !== 'paid' || invoice.amount_paid !== 9900)
    process.exitCode = 2;
}
