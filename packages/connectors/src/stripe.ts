import { loadEnv } from '@brandpilot/config';
import { AppError } from '@brandpilot/core';

/**
 * Stripe payment-link adapter over the REST API (form-encoded, Bearer auth).
 *
 * Stripe Payment Links require a Price, and a Price requires a Product, so this
 * is a two-call flow: `POST /v1/prices` (with inline `product_data`) to mint a
 * one-off price, then `POST /v1/payment_links` referencing it.
 *
 * ## Caller contract / signature adaptation
 * `SalesEngine.createPaymentLink` injects a `CreatePaymentLink`:
 *   (amount: number, currency: string) => Promise<{ id: string; url: string }>
 * where `amount` is the quote total in MAJOR units (e.g. dollars, from
 * `Number(quotes.total)`). Stripe expects `unit_amount` in MINOR units (cents),
 * so this adapter takes the major-unit amount and converts to minor internally.
 * The exported `createPaymentLink` is therefore drop-in as that adapter:
 *   engine.createPaymentLink(orgId, quoteId, createPaymentLink)
 *
 * @see https://stripe.com/docs/api/payment_links/payment_links/create
 * @see https://stripe.com/docs/api/prices/create
 */

const STRIPE_API_BASE = 'https://api.stripe.com/v1';
/** Minor units per major unit for the currencies we support (USD/EUR/GBP-style). */
const MINOR_UNITS_PER_MAJOR = 100;

/**
 * Convert a MAJOR-unit amount (e.g. dollars) to integer MINOR units (cents).
 *
 * `Math.round(amount * 100)` is unsafe: binary floating point can't represent
 * many decimal cents exactly, so `1.005 * 100 === 100.49999999999999` and
 * `Math.round` yields 100 instead of 101. `(amount + Number.EPSILON) * 100` is
 * still fragile because EPSILON is too small for larger magnitudes. Instead we
 * quantize to 2 decimals as a base-10 string first (`toFixed(2)` rounds
 * half-away-from-zero on the decimal representation), then parse — so the value
 * fed to `Math.round` is already a clean cents-resolution number.
 */
function toMinorUnits(amount: number): number {
  return Math.round(Number(amount.toFixed(2)) * MINOR_UNITS_PER_MAJOR);
}

/** A minted Stripe payment link: its object id and the shareable URL. */
export interface PaymentLink {
  id: string;
  url: string;
}

interface StripePriceResponse {
  id?: string;
  error?: { message?: string; type?: string };
}

interface StripePaymentLinkResponse {
  id?: string;
  url?: string;
  error?: { message?: string; type?: string };
}

/** POST form-encoded params to a Stripe endpoint and surface errors as AppError. */
async function stripePost<T extends { error?: { message?: string } }>(
  apiKey: string,
  path: string,
  params: Record<string, string>,
): Promise<T> {
  const body = new URLSearchParams(params);

  let response: Response;
  try {
    response = await fetch(`${STRIPE_API_BASE}/${path}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'unknown network error';
    throw new AppError('bad_request', `Stripe request failed: ${message}`);
  }

  const json = (await response.json().catch(() => ({}))) as T;
  if (!response.ok || json.error) {
    const detail = json.error?.message ?? `HTTP ${response.status}`;
    throw new AppError('bad_request', `Stripe API error: ${detail}`);
  }
  return json;
}

/**
 * Create a Stripe payment link for `amount` (MAJOR units, e.g. dollars) in
 * `currency`. Returns the payment link's id + shareable URL. Throws
 * {@link AppError} `bad_request` when `STRIPE_SECRET_KEY` is missing or any
 * Stripe call fails.
 */
export async function createPaymentLink(amount: number, currency: string): Promise<PaymentLink> {
  const apiKey = loadEnv().STRIPE_SECRET_KEY;
  if (!apiKey) {
    throw new AppError('bad_request', 'STRIPE_SECRET_KEY is not configured; cannot create payment links');
  }

  const unitAmount = toMinorUnits(amount);
  const normalizedCurrency = currency.toLowerCase();

  const price = await stripePost<StripePriceResponse>(apiKey, 'prices', {
    currency: normalizedCurrency,
    unit_amount: String(unitAmount),
    'product_data[name]': 'BrandPilot Quote',
  });
  if (!price.id) {
    throw new AppError('bad_request', 'Stripe price creation returned no id');
  }

  const link = await stripePost<StripePaymentLinkResponse>(apiKey, 'payment_links', {
    'line_items[0][price]': price.id,
    'line_items[0][quantity]': '1',
  });
  if (!link.id || !link.url) {
    throw new AppError('bad_request', 'Stripe payment link creation returned no url');
  }

  return { id: link.id, url: link.url };
}
