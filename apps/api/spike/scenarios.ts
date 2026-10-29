import type { FastifyInstance, InjectOptions } from 'fastify';

// The same requests are sent to both bindings so the outputs can be compared
// line by line. "leak" sends a response that violates the response schema;
// a binding that validates responses must turn it into a 500.
export async function runScenarios(label: string, app: FastifyInstance): Promise<void> {
  await app.ready();
  const cases: Array<[string, InjectOptions]> = [
    ['valid get', { method: 'GET', url: '/items/abc-1' }],
    ['bad path param', { method: 'GET', url: '/items/ABC' }],
    ['missing item', { method: 'GET', url: '/items/missing' }],
    ['valid post', { method: 'POST', url: '/items', payload: { name: 'x', tags: ['a'] } }],
    ['post missing name', { method: 'POST', url: '/items', payload: { tags: ['a'] } }],
    ['post extra prop', { method: 'POST', url: '/items', payload: { name: 'x', extra: 1 } }],
    ['response leak', { method: 'GET', url: '/items/leak' }],
  ];
  console.log(`\n== ${label} ==`);
  for (const [name, req] of cases) {
    const res = await app.inject(req);
    console.log(`${name.padEnd(18)} ${res.statusCode}  ${res.body.slice(0, 90)}`);
  }
  console.log(`routes:\n${app.printRoutes({ commonPrefix: false })}`);
  await app.close();
}

export const handlers = {
  getItem(id: string) {
    if (id === 'missing') return { status: 404, body: { message: 'no such item' } };
    if (id === 'leak')
      return { status: 200, body: { id, secret: 'should not pass', nameless: true } };
    return { status: 200, body: { id, name: `item ${id}` } };
  },
  createItem(body: { name: string; tags?: string[] }) {
    return { status: 201, body: { id: 'new', ...body } };
  },
};
