// Hidden evaluator for Task B: OrderService.getOrder(orderId) -> getOrder({ orderId }). Checks the contract and
// every adapter behaviorally; it does not prescribe how the request object is destructured or validated.
import { InstrumentedReader, changedFiles, check, expectCases, finishEvaluation, harnessCheck, loaded, runHarnessVerification, scopeChecks } from './common.mjs';

const ORDER_100 = { orderId: 'o-100', customerId: 'c-1', totalCents: 4200, status: 'open' };
const ORDER_101 = { orderId: 'o-101', customerId: 'c-1', totalCents: 1999, status: 'shipped' };
const throwsTypeError = (fn) => { try { fn(); return false; } catch (error) { return error instanceof TypeError; } };

export async function evaluateTaskB(root, manifest) {
  const reader = new InstrumentedReader(root);
  const changed = await changedFiles(root);
  const changedPaths = changed.map((entry) => entry.path);
  const verification = await runHarnessVerification(root, manifest);
  const checks = [];
  let OrderService = null, OrderStore = null, createOrderRoute = null, showOrder = null, FakeOrderService = null, assertOrderService = null;
  const newService = () => new (loaded(OrderService, 'OrderService'))(new (loaded(OrderStore, 'OrderStore'))());

  checks.push(await check('transformation.request_object_contract', 'transformation', true, async () => {
    ({ OrderService } = await reader.load('src/orders/order-service.js'));
    ({ OrderStore } = await reader.load('src/orders/order-store.js'));
    const service = newService();
    return expectCases([
      { name: 'request object returns order', actual: () => service.getOrder({ orderId: 'o-100' }), expected: ORDER_100 },
      { name: 'unknown order is null', actual: () => service.getOrder({ orderId: 'o-999' }), expected: null },
      { name: 'empty orderId rejected', actual: () => throwsTypeError(() => service.getOrder({ orderId: '' })), expected: true },
    ]);
  }));
  checks.push(await check('transformation.positional_rejected', 'transformation', true, () => {
    const service = newService();
    return expectCases([
      { name: 'positional string throws TypeError', actual: () => throwsTypeError(() => service.getOrder('o-100')), expected: true },
      { name: 'missing argument throws TypeError', actual: () => throwsTypeError(() => service.getOrder()), expected: true },
    ]);
  }));
  checks.push(await check('behavior.route_unchanged', 'behavior', true, async () => {
    ({ createOrderRoute } = await reader.load('src/http/order-route.js'));
    const handle = loaded(createOrderRoute, 'createOrderRoute')(newService());
    return expectCases([
      { name: 'GET known order', actual: () => handle({ method: 'GET', url: '/orders/o-101' }), expected: { status: 200, body: ORDER_101 } },
      { name: 'GET unknown order', actual: () => handle({ method: 'GET', url: '/orders/o-999' }), expected: { status: 404, body: { error: 'order_not_found' } } },
      { name: 'POST rejected', actual: () => handle({ method: 'POST', url: '/orders/o-101' }), expected: { status: 405, body: { error: 'method_not_allowed' } } },
      { name: 'other path', actual: () => handle({ method: 'GET', url: '/customers/c-1' }), expected: { status: 404, body: { error: 'not_found' } } },
      { name: 'encoded id', actual: () => handle({ method: 'GET', url: '/orders/o%2D100' }), expected: { status: 200, body: ORDER_100 } },
    ]);
  }));
  checks.push(await check('behavior.cli_unchanged', 'behavior', true, async () => {
    ({ showOrder } = await reader.load('src/cli/show-order.js'));
    loaded(showOrder, 'showOrder');
    const service = newService();
    return expectCases([
      { name: 'known order', actual: () => showOrder(['o-102'], service), expected: { exitCode: 0, output: 'order o-102: customer=c-2 total=0.00 status=open' } },
      { name: 'shipped order', actual: () => showOrder(['o-101'], service), expected: { exitCode: 0, output: 'order o-101: customer=c-1 total=19.99 status=shipped' } },
      { name: 'unknown order', actual: () => showOrder(['o-999'], service), expected: { exitCode: 1, output: 'order o-999: not found' } },
      { name: 'usage', actual: () => showOrder([], service), expected: { exitCode: 2, output: 'usage: show-order <id>' } },
    ]);
  }));
  checks.push(await check('behavior.test_double_implements_contract', 'behavior', true, async () => {
    ({ FakeOrderService } = await reader.load('tests/doubles/fake-order-service.js'));
    const orders = [{ orderId: 'o-1', customerId: 'c-9', totalCents: 1250, status: 'shipped' }], fake = new (loaded(FakeOrderService, 'FakeOrderService'))(orders);
    loaded(createOrderRoute, 'createOrderRoute'); loaded(showOrder, 'showOrder');
    return expectCases([
      { name: 'double accepts request object', actual: () => fake.getOrder({ orderId: 'o-1' }), expected: orders[0] },
      { name: 'route works with double', actual: () => createOrderRoute(new FakeOrderService(orders))({ method: 'GET', url: '/orders/o-1' }), expected: { status: 200, body: orders[0] } },
      { name: 'cli works with double', actual: () => showOrder(['o-1'], new FakeOrderService(orders)), expected: { exitCode: 0, output: 'order o-1: customer=c-9 total=12.50 status=shipped' } },
    ]);
  }));
  checks.push(await check('behavior.contract_check_intact', 'behavior', true, async () => {
    ({ assertOrderService } = await reader.load('src/orders/order-service-contract.js'));
    loaded(assertOrderService, 'assertOrderService'); loaded(createOrderRoute, 'createOrderRoute');
    return expectCases([
      { name: 'empty object rejected', actual: () => throwsTypeError(() => assertOrderService({})), expected: true },
      { name: 'implementation accepted', actual: () => assertOrderService(newService()) instanceof OrderService, expected: true },
      { name: 'adapters reject bad service', actual: () => throwsTypeError(() => createOrderRoute({})), expected: true },
    ]);
  }));
  checks.push(await check('behavior.store_unchanged', 'behavior', true, () => ({ pass: !changedPaths.includes('src/orders/order-store.js') && new (loaded(OrderStore, 'OrderStore'))().find('o-100')?.order_id === 'o-100', evidence: { storeChanged: changedPaths.includes('src/orders/order-store.js') } })));
  checks.push(...await scopeChecks(root, manifest, changed, reader));
  checks.push(await harnessCheck(verification));
  return finishEvaluation({ taskId: 'task-b', root, manifest, reader, checks, changed, verification });
}
