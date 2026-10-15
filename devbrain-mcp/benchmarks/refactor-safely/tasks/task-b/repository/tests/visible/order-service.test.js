import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assertOrderService } from '../../src/orders/order-service-contract.js';
import { OrderService } from '../../src/orders/order-service.js';
import { OrderStore } from '../../src/orders/order-store.js';

test('getOrder maps a stored row to the public order shape', () => {
  const service = new OrderService(new OrderStore());
  assert.deepEqual(service.getOrder('o-100'), { orderId: 'o-100', customerId: 'c-1', totalCents: 4200, status: 'open' });
});

test('getOrder returns null for an unknown order', () => {
  assert.equal(new OrderService().getOrder('o-999'), null);
});

test('getOrder rejects an empty identifier', () => {
  assert.throws(() => new OrderService().getOrder(''), TypeError);
});

test('the default implementation satisfies the contract', () => {
  assert.equal(assertOrderService(new OrderService()) instanceof OrderService, true);
  assert.throws(() => assertOrderService({}), /missing getOrder\(\)/);
});
