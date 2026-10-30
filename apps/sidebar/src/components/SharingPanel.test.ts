import type { AclEntry, PrincipalRef } from '@scale/api-client';
import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it } from 'vitest';
import { installFakeApi, json, problem, type FakeApi } from '../test/fake-api';
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

  beforeEach(() => {
    setActivePinia(createPinia());
    acl = [
      ...(['read', 'update', 'delete', 'share'] as const).map((permission) => ({
        principal: alice,
        permission,
      })),
      { principal: bob, permission: 'read' as const },
    ];
    api = installFakeApi(({ method, url, body }) => {
      const path = url.pathname;
      if (method === 'GET' && path === `/x/annotations/${ANNOTATION}/acl`) return json(acl);
      if (method === 'POST' && path === `/x/annotations/${ANNOTATION}/acl`) {
        const grant = body as { principal: string; permission: AclEntry['permission'] };
        const principal = [alice, bob, reviewers, PUBLIC].find((p) => p.id === grant.principal);
        if (!principal) return problem(400, 'Bad Request');
        const entry: AclEntry = { principal, permission: grant.permission };
        acl.push(entry);
        return json(entry, { status: 201 });
      }
      if (method === 'DELETE' && path.startsWith(`/x/annotations/${ANNOTATION}/acl/`)) {
        const [principalId, permission] = path.split('/').slice(-2);
        acl = acl.filter((e) => !(e.principal.id === principalId && e.permission === permission));
        return new Response(null, { status: 204 });
      }
      if (method === 'GET' && path === '/x/principals') {
        const q = url.searchParams.get('q') ?? '';
        return json([PUBLIC, reviewers, bob].filter((p) => (p.name ?? p.kind).includes(q)));
      }
      return undefined;
    });
  });

  function checkbox(wrapper: ReturnType<typeof mount>, label: string) {
    return wrapper.find(`input[aria-label="${label}"]`);
  }

  it('lists the grants with the creator locked', async () => {
    const wrapper = mount(SharingPanel, {
      props: { annotationId: ANNOTATION, creatorId: alice.id },
    });
    await flushPromises();
    expect(wrapper.text()).toContain('Alice (creator)');
    expect(checkbox(wrapper, 'read for Alice').attributes('disabled')).toBeDefined();
    expect((checkbox(wrapper, 'share for Alice').element as HTMLInputElement).checked).toBe(true);
    expect((checkbox(wrapper, 'read for Bob').element as HTMLInputElement).checked).toBe(true);
    expect((checkbox(wrapper, 'update for Bob').element as HTMLInputElement).checked).toBe(false);
    expect(checkbox(wrapper, 'update for Bob').attributes('disabled')).toBeUndefined();
  });

  it('grants and revokes one permission at a time', async () => {
    const wrapper = mount(SharingPanel, {
      props: { annotationId: ANNOTATION, creatorId: alice.id },
    });
    await flushPromises();
    await checkbox(wrapper, 'update for Bob').setValue(true);
    await flushPromises();
    const grant = api.calls.find((c) => c.method === 'POST');
    expect(grant?.body).toEqual({ principal: bob.id, permission: 'update' });
    expect((checkbox(wrapper, 'update for Bob').element as HTMLInputElement).checked).toBe(true);

    await checkbox(wrapper, 'read for Bob').setValue(false);
    await flushPromises();
    const revoke = api.calls.find((c) => c.method === 'DELETE');
    expect(revoke?.url.pathname).toBe(`/x/annotations/${ANNOTATION}/acl/${bob.id}/read`);
    expect((checkbox(wrapper, 'read for Bob').element as HTMLInputElement).checked).toBe(false);
  });

  it('finds principals to share with, including the pseudo-principals, and grants read', async () => {
    const wrapper = mount(SharingPanel, {
      props: { annotationId: ANNOTATION, creatorId: alice.id },
    });
    await flushPromises();
    await wrapper.find('input[name="principal"]').setValue('review');
    await new Promise((r) => setTimeout(r, 250));
    await flushPromises();
    const candidates = wrapper.findAll('.candidates button').map((b) => b.text());
    expect(candidates).toEqual(['Group: reviewers']);

    await wrapper.find('.candidates button').trigger('click');
    await flushPromises();
    expect(api.calls.find((c) => c.method === 'POST')?.body).toEqual({
      principal: reviewers.id,
      permission: 'read',
    });
    expect(
      (checkbox(wrapper, 'read for Group: reviewers').element as HTMLInputElement).checked,
    ).toBe(true);

    await wrapper.find('input[name="principal"]').setValue('pub');
    await new Promise((r) => setTimeout(r, 250));
    await flushPromises();
    expect(wrapper.findAll('.candidates button').map((b) => b.text())).toEqual([
      'Everyone (public)',
    ]);
  });

  it('surfaces a problem from the API', async () => {
    installFakeApi(() => problem(403, 'Forbidden', 'the share permission is required'));
    const wrapper = mount(SharingPanel, { props: { annotationId: ANNOTATION } });
    await flushPromises();
    expect(wrapper.find('[role="alert"]').text()).toContain('the share permission is required');
  });
});
