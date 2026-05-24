import { NextResponse } from 'next/server';
import { supabase } from '../../../../lib/supabase';
import Stripe from 'stripe';

const stripeSecretKey = process.env.STRIPE_SECRET_KEY || 'placeholder_stripe_secret';
const stripe = new Stripe(stripeSecretKey, {
  apiVersion: '2023-10-16' as any,
});

const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

export async function POST(request: Request) {
  const body = await request.text();
  const signature = request.headers.get('stripe-signature');

  let event: Stripe.Event;

  try {
    if (webhookSecret && signature) {
      event = stripe.webhooks.constructEvent(body, signature, webhookSecret);
    } else {
      // Graceful fallback for local development testing
      console.warn('[Stripe Webhook] No webhook secret or signature provided. Parsing body directly.');
      event = JSON.parse(body) as Stripe.Event;
    }
  } catch (err: any) {
    console.error(`[Stripe Webhook] Error constructing event: ${err.message}`);
    return NextResponse.json({ error: `Webhook Error: ${err.message}` }, { status: 400 });
  }

  const eventType = event.type;
  console.log(`[Stripe Webhook] Received event of type: ${eventType}`);

  try {
    switch (eventType) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        const customerId = session.customer as string;
        const subscriptionId = session.subscription as string;
        const orgId = session.client_reference_id || session.metadata?.org_id;
        const plan = session.metadata?.plan || 'pro';
        const seats = parseInt(session.metadata?.seats || '1', 10);

        if (!orgId) {
          console.error('[Stripe Webhook] No org_id (client_reference_id or metadata.org_id) found in checkout session.');
          return NextResponse.json({ error: 'Missing organization reference ID' }, { status: 400 });
        }

        // 1. Update org table with customer id
        const { error: orgError } = await supabase
          .from('orgs')
          .update({ stripe_customer_id: customerId })
          .eq('id', orgId);

        if (orgError) {
          console.error(`[Stripe Webhook] Error updating org customer ID: ${orgError.message}`);
        }

        // 2. Insert or update subscription details
        const { data: existingSub, error: fetchError } = await supabase
          .from('subscriptions')
          .select('id')
          .eq('org_id', orgId)
          .maybeSingle();

        if (fetchError) {
          console.error(`[Stripe Webhook] Error fetching existing subscription: ${fetchError.message}`);
        }

        if (existingSub) {
          const { error: updateError } = await supabase
            .from('subscriptions')
            .update({
              stripe_sub_id: subscriptionId,
              plan: plan,
              seats: seats
            })
            .eq('id', existingSub.id);

          if (updateError) {
            throw new Error(`Failed to update subscription in DB: ${updateError.message}`);
          }
        } else {
          const { error: insertError } = await supabase
            .from('subscriptions')
            .insert({
              org_id: orgId,
              stripe_sub_id: subscriptionId,
              plan: plan,
              seats: seats
            });

          if (insertError) {
            throw new Error(`Failed to insert subscription in DB: ${insertError.message}`);
          }
        }

        console.log(`[Stripe Webhook] Successfully activated subscription for org ${orgId} to plan ${plan} with ${seats} seats.`);
        break;
      }

      case 'customer.subscription.deleted': {
        const subscription = event.data.object as Stripe.Subscription;
        const subscriptionId = subscription.id;

        // Downgrade subscription to free tier
        const { error: downgradeError } = await supabase
          .from('subscriptions')
          .update({ plan: 'free', seats: 1 })
          .eq('stripe_sub_id', subscriptionId);

        if (downgradeError) {
          throw new Error(`Failed to downgrade subscription on delete: ${downgradeError.message}`);
        }

        console.log(`[Stripe Webhook] Successfully downgraded subscription ${subscriptionId} to free tier.`);
        break;
      }

      case 'invoice.payment_failed': {
        const invoice = event.data.object as Stripe.Invoice;
        const parentSubscription = invoice.parent?.subscription_details?.subscription;
        const subscriptionId = typeof parentSubscription === 'string' ? parentSubscription : undefined;

        if (!subscriptionId) {
          console.error('[Stripe Webhook] Payment failed event did not include a subscription ID.');
          return NextResponse.json({ error: 'Missing subscription ID' }, { status: 400 });
        }

        console.error(`[Stripe Webhook] Urgent: Payment failed for subscription ${subscriptionId}.`);
        
        // Log payment failure event or flag subscription as delinquent in the DB
        const { error: statusError } = await supabase
          .from('subscriptions')
          .update({ plan: 'delinquent' })
          .eq('stripe_sub_id', subscriptionId);

        if (statusError) {
          console.error(`[Stripe Webhook] Error updating subscription delinquent status: ${statusError.message}`);
        }
        
        break;
      }

      default:
        console.log(`[Stripe Webhook] Unhandled event type: ${eventType}`);
    }

    return NextResponse.json({ received: true });
  } catch (err: any) {
    console.error(`[Stripe Webhook] Database update error: ${err.message}`);
    return NextResponse.json({ error: `Database Error: ${err.message}` }, { status: 500 });
  }
}
