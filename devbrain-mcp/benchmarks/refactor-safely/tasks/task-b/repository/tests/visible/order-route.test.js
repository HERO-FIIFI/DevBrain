import assert from 'node:assert/strict';
import { test } from 'node:test';
import { showOrder } from '../../src/cli/show-order.js';
import { createOrderRoute } from '../../src/http/order-route.js';
import { FakeOrderService } from '../doubles/fake-order-service.js';

const orders = [{ orderId: 'o-1', customerId: 'c-9', totalCents: 1250, status: 'shipped' }];

test('GET /orders/:id returns the order from the service', () => {
  const handle = createOrderRoute(new FakeOrderService(orders));
  assert.deepEqual(handle({ method: 'GET', url: '/orders/o-1' }), { status: 200, body: orders[0] });
  assert.deepEqual(handle({ method: 'GET', url: '/orders/o-2' }), { status: 404, body: { error: 'order_not_found' } });
  assert.deepEqual(handle({ method: 'POST', url: '/orders/o-1' }), { status: 405, body: { error: 'method_not_allowed' } });
  assert.deepEqual(handle({ method: 'GET', url: '/customers/c-9' }), { status: 404, body: { error: 'not_found' } });
});

test('show-order CLI prints one line per verdict', () => {
  const service = new FakeOrderService(orders);
  assert.deepEqual(showOrder(['o-1'], service), { exitCode: 0, output: 'order o-1: customer=c-9 total=12.50 status=shipped' });
  assert.deepEqual(showOrder(['o-2'], service), { exitCode: 1, output: 'order o-2: not found' });
  assert.deepEqual(showOrder([], service), { exitCode: 2, output: 'usage: show-order <id>' });
});

test('adapters reject a service that does not satisfy the contract', () => {
  assert.throws(() => createOrderRoute({}), TypeError);
  assert.throws(() => showOrder(['o-1'], {}), TypeError);
});
