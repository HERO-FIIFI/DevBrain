// Framework-free `GET /orders/:id` handler over a request-like object.
import { assertOrderService } from '../orders/order-service-contract.js';

const ORDER_PATH = /^\/orders\/([^/]+)$/;

export function createOrderRoute(orderService) {
  const service = assertOrderService(orderService);
  return function handle(request) {
    const match = ORDER_PATH.exec(request.url ?? '');
    if (!match) return { status: 404, body: { error: 'not_found' } };
    if (request.method !== 'GET') return { status: 405, body: { error: 'method_not_allowed' } };
    const order = service.getOrder(decodeURIComponent(match[1]));
    if (!order) return { status: 404, body: { error: 'order_not_found' } };
    return { status: 200, body: order };
  };
}
