// In-memory rows standing in for a table. Internal to the orders module; adapters go through OrderService.
const SEED = [
  { order_id: 'o-100', customer_id: 'c-1', total_cents: 4200, status: 'open' },
  { order_id: 'o-101', customer_id: 'c-1', total_cents: 1999, status: 'shipped' },
  { order_id: 'o-102', customer_id: 'c-2', total_cents: 0, status: 'open' },
];

export class OrderStore {
  constructor(rows = SEED) {
    this.rows = rows.map((row) => ({ ...row }));
  }

  find(orderId) {
    return this.rows.find((row) => row.order_id === orderId) ?? null;
  }
}
