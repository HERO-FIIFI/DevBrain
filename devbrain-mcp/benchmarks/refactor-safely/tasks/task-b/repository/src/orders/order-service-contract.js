/**
 * Public contract for anything that can look up orders. Adapters (HTTP, CLI) and test doubles depend on this shape.
 *
 * @typedef {object} Order
 * @property {string} orderId
 * @property {string} customerId
 * @property {number} totalCents
 * @property {'open' | 'shipped'} status
 *
 * @typedef {object} OrderService
 * @property {(orderId: string) => Order | null} getOrder returns the order or `null` when unknown
 */

export const ORDER_SERVICE_METHODS = Object.freeze(['getOrder']);

/** Runtime shape check used by adapters so a misconfigured service fails fast. */
export function assertOrderService(candidate) {
  for (const method of ORDER_SERVICE_METHODS) if (typeof candidate?.[method] !== 'function') throw new TypeError(`order service is missing ${method}()`);
  return candidate;
}
