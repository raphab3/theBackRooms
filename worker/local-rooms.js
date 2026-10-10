import { RoomDO } from './room-do.js';

// ROOMS em memória para Node (testes e `pnpm start`): mesma classe do Durable Object, sem WebSocket nem alarmes.
function createLocalRooms() {
  const instances = new Map();
  const instance = name => {
    if (!instances.has(name)) {
      const data = new Map();
      instances.set(
        name,
        new RoomDO(
          {
            storage: {
              get: async key => data.get(key),
              put: async (key, value) => void data.set(key, structuredClone(value)),
              deleteAll: async () => data.clear(),
            },
            blockConcurrencyWhile: fn => fn(),
            getWebSockets: () => [],
          },
          {},
        ),
      );
    }
    return instances.get(name);
  };
  return {
    instances,
    idFromName: name => name,
    get: id => ({ fetch: (input, init) => instance(id).fetch(new Request(input, init)) }),
  };
}

export { createLocalRooms };
