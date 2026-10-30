import type { AclEntry, PrincipalRef } from '@scale/api-client';
import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it } from 'vitest';
import { API_KEY } from '../api/client';
import { fakeApi, json, noContent, problem, type FakeApi } from '../test/fake-api';
import SharingPanel from './SharingPanel.vue';

const ANNOTATION = '11111111-1111-4111-8111-111111111111';
const alice: PrincipalRef = {
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  kind: 'user',
  name: 'Alice',
};
const bob: PrincipalRef = { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', kind: 'user', name: 'Bob' };
const reviewers: PrincipalRef = {
  id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  kind: 'group',
  name: 'reviewers',
};
const PUBLIC: PrincipalRef = { id: '00000000-0000-4000-8000-000000000001', kind: 'public' };

describe('SharingPanel', () => {
  let acl: AclEntry[];
  let api: FakeApi;
  let refuseRevokes = false;

  beforeEach(() => {
    refuseRevokes = false;
    acl = [
      ...(['read', 'update', 'delete', 'share'] as const).map((permission) => ({
        principal: alice,
        permission,
      })),
      { principal: bob, permission: 'read' as const },
    ];
    api = fakeApi(({ method, url, body }) => {
      const path = url.pathname;
      if (method === 'GET' && path === `/x/annotations/${ANNOTATION}/acl`) return json(acl);
      if (method === 'POST' && path === `/x/annotations/${ANNOTATION}/acl`) {
        const grant = body as { principal: string; permission: AclEntry['permission'] };
        const principal = [alice, bob, reviewers, PUBLIC].find((p) => p.id === grant.principal);
        if (!principal) return problem(400, 'Bad Request', 'unknown principal');
        const entry: AclEntry = { principal, permission: grant.permission };
        acl.push(entry);
        return json(entry, { status: 201 });
      }
      if (method === 'DELETE' && path.startsWith(`/x/annotations/${ANNOTATION}/acl/`)) {
        const [principalId, permission] = path.split('/').slice(-2);
        if (refuseRevokes) return problem(403, 'Forbidden', 'the share permission is required');
        acl = acl.filter((e) => !(e.principal.id === principalId && e.permission === permission));
        return noContent();
      }
      if (method === 'GET' && path === '/x/principals') {
        const q = url.searchParams.get('q') ?? '';
        return json([PUBLIC, reviewers, bob].filter((p) => (p.name ?? p.kind).includes(q)));
      }
      return undefined;
    });
  });

  function mountPanel() {
    return mount(SharingPanel, {
      props: { annotationId: ANNOTATION, creatorId: alice.id },
      global: { provide: { [API_KEY as symbol]: api.client } },
    });
  }
  const box = (wrapper: ReturnType<typeof mountPanel>, label: string) =>
    wrapper.find<HTMLInputElement>(`input[aria-label="${label}"]`);

  it('shows the ACL as a matrix with the creator fixed', async () => {
    const wrapper = mountPanel();
    await flushPromises();
    expect(box(wrapper, 'read for Alice').element.checked).toBe(true);
    expect(box(wrapper, 'share for Alice').element.disabled).toBe(true);
    expect(box(wrapper, 'read for Bob').element.checked).toBe(true);
    expect(box(wrapper, 'update for Bob').element.checked).toBe(false);
    expect(wrapper.text()).toContain('creator');
  });

  it('grants and revokes one permission at a time', async () => {
    const wrapper = mountPanel();
    await flushPromises();
    await box(wrapper, 'update for Bob').setValue(true);
    await flushPromises();
    const post = api.calls.find((c) => c.method === 'POST');
    expect(post?.body).toEqual({ principal: bob.id, permission: 'update' });
    expect(box(wrapper, 'update for Bob').element.checked).toBe(true);

    await box(wrapper, 'read for Bob').setValue(false);
    await flushPromises();
    expect(api.calls.find((c) => c.method === 'DELETE')?.url.pathname).toBe(
      `/x/annotations/${ANNOTATION}/acl/${bob.id}/read`,
    );
    expect(box(wrapper, 'read for Bob').element.checked).toBe(false);
    expect(wrapper.emitted('changed')).toHaveLength(2);
  });

  it('adds a principal from the search with read', async () => {
    const wrapper = mountPanel();
    await flushPromises();
    await wrapper.find('input[type="search"]').setValue('rev');
    await flushPromises();
    const found = wrapper.findAll('[role="listbox"] button');
    expect(found.map((b) => b.text())).toEqual(['reviewers group']);
    await found[0]!.trigger('click');
    await flushPromises();
    expect(api.calls.find((c) => c.method === 'POST')?.body).toEqual({
      principal: reviewers.id,
      permission: 'read',
    });
    expect(box(wrapper, 'read for reviewers').element.checked).toBe(true);
    expect(wrapper.find<HTMLInputElement>('input[type="search"]').element.value).toBe('');
  });

  it('offers the public pseudo-principal by its kind', async () => {
    const wrapper = mountPanel();
    await flushPromises();
    await wrapper.find('input[type="search"]').setValue('pub');
    await flushPromises();
    expect(wrapper.findAll('[role="listbox"] button').map((b) => b.text())).toEqual([
      'public public',
    ]);
  });

  it('reports a refused revoke and shows the real state again', async () => {
    refuseRevokes = true;
    const wrapper = mountPanel();
    await flushPromises();
    await box(wrapper, 'read for Bob').setValue(false);
    await flushPromises();
    expect(wrapper.find('[role="alert"]').text()).toContain('share permission');
    expect(box(wrapper, 'read for Bob').element.checked).toBe(true);
  });
});
