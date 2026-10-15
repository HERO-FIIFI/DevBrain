# order-desk

Dependency-free order lookup.

- `src/orders/order-service-contract.js` — the public `OrderService` contract and a runtime shape check.
- `src/orders/order-service.js` — `OrderService` backed by `OrderStore`.
- `src/orders/order-store.js` — in-memory rows.
- `src/http/order-route.js` — `GET /orders/:id`.
- `src/cli/show-order.js` — `show-order <id>` prints one line.
- `tests/doubles/fake-order-service.js` — a test double implementing the contract.

## Scripts

```sh
npm test            # full regression (node:test)
npm run test:targeted
npm run lint        # syntax check every module
npm run build       # load every module to catch broken imports
```
