// Test double implementing the OrderService contract over a literal list of orders.
export class FakeOrderService {
  constructor(orders) {
    this.orders = orders;
    this.calls = [];
  }

  getOrder(orderId) {
    this.calls.push(orderId);
    return this.orders.find((order) => order.orderId === orderId) ?? null;
  }
}
