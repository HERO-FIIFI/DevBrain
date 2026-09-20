// `show-order <id>` prints one line. Exposed as a function so tests run it without a child process.
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import { assertOrderService } from '../orders/order-service-contract.js';
import { OrderService } from '../orders/order-service.js';

export function showOrder(argv, orderService) {
  const service = assertOrderService(orderService);
  const [orderId] = argv;
  if (!orderId) return { exitCode: 2, output: 'usage: show-order <id>' };
  const order = service.getOrder(orderId);
  if (!order) return { exitCode: 1, output: `order ${orderId}: not found` };
  return { exitCode: 0, output: `order ${order.orderId}: customer=${order.customerId} total=${(order.totalCents / 100).toFixed(2)} status=${order.status}` };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { exitCode, output } = showOrder(process.argv.slice(2), new OrderService());
  process.stdout.write(`${output}\n`);
  process.exitCode = exitCode;
}
