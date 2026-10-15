import { OrderStore } from './order-store.js';

/** Default implementation of the `OrderService` contract in `order-service-contract.js`. */
export class OrderService {
  constructor(store = new OrderStore()) {
    this.store = store;
  }

  /** @param {string} orderId @returns {import('./order-service-contract.js').Order | null} */
  getOrder(orderId) {
    if (typeof orderId !== 'string' || orderId.length === 0) throw new TypeError('orderId must be a non-empty string');
    const row = this.store.find(orderId);
    if (!row) return null;
    return { orderId: row.order_id, customerId: row.customer_id, totalCents: row.total_cents, status: row.status };
  }
}
