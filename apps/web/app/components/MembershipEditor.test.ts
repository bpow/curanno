import type { Membership, PrincipalRef } from '@curanno/api-client';
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { API_KEY } from '../api/client';
import { fakeApi, json, noContent, problem, type FakeApi } from '../test/fake-api';
import MembershipEditor from './MembershipEditor.vue';

const GROUP = '11111111-1111-4111-8111-111111111111';
const ALICE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const BOB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const bob: PrincipalRef = { id: BOB, kind: 'user', name: 'Bob Reviewer' };
const reviewers: PrincipalRef = {
  id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  kind: 'group',
  name: 'reviewers',
};

describe('MembershipEditor', () => {
  let members: Membership[];
  let api: FakeApi;
  let lastAdminGuard = false;

  beforeEach(() => {
    members = [
      {
        user: { id: ALICE, displayName: 'Alice Annotator' },
        role: 'admin',
        addedAt: '2026-10-30T00:00:00Z',
      },
    ];
    lastAdminGuard = false;
    api = fakeApi(({ method, url, body }) => {
      const path = url.pathname;
      if (method === 'GET' && path === `/x/groups/${GROUP}/members`) return json(members);
      if (method === 'GET' && path === '/x/principals') {
        const q = url.searchParams.get('q') ?? '';
        return json([reviewers, bob].filter((p) => (p.name ?? '').toLowerCase().includes(q)));
      }
      const member = new RegExp(`^/x/groups/${GROUP}/members/([^/]+)$`).exec(path)?.[1];
      if (method === 'PUT' && member) {
        const role = (body as { role?: Membership['role'] } | undefined)?.role ?? 'member';
        const existing = members.find((m) => m.user.id === member);
        if (existing) existing.role = role;
        else
          members.push({
            user: { id: member, displayName: 'Bob Reviewer' },
            role,
            addedAt: '2026-10-30T01:00:00Z',
          });
        return noContent();
      }
      if (method === 'DELETE' && member) {
        if (lastAdminGuard)
          return problem(409, 'Conflict', 'a group keeps at least one administrator');
        members = members.filter((m) => m.user.id !== member);
        return noContent();
      }
      return undefined;
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  function mountEditor(props: { canManage: boolean; currentUserId?: string }) {
    return mount(MembershipEditor, {
      props: { groupId: GROUP, ...props },
      global: { provide: { [API_KEY as symbol]: api.client } },
    });
  }

  it('lists members and finds users to add, sending PUT with the role', async () => {
    const wrapper = mountEditor({ canManage: true, currentUserId: ALICE });
    await flushPromises();
    expect(wrapper.text()).toContain('Alice Annotator');
    expect(wrapper.find('button').text()).toBe('Leave');

    await wrapper.find('input[type="search"]').setValue('bob');
    await flushPromises();
    const candidates = wrapper.findAll('[role="listbox"] button');
    // Groups are not members; only users are offered.
    expect(candidates.map((b) => b.text())).toEqual(['Bob Reviewer']);
    await candidates[0]!.trigger('click');
    await flushPromises();

    const put = api.calls.find((c) => c.method === 'PUT');
    expect(put?.url.pathname).toBe(`/x/groups/${GROUP}/members/${BOB}`);
    expect(put?.body).toEqual({ role: 'member' });
    expect(wrapper.text()).toContain('Bob Reviewer');
    expect(wrapper.emitted('changed')).toHaveLength(1);
  });

  it('changes a role and removes a member after confirmation', async () => {
    members.push({
      user: { id: BOB, displayName: 'Bob Reviewer' },
      role: 'member',
      addedAt: '2026-10-30T01:00:00Z',
    });
    const wrapper = mountEditor({ canManage: true, currentUserId: ALICE });
    await flushPromises();

    await wrapper.find('select[aria-label="Role of Bob Reviewer"]').setValue('admin');
    await flushPromises();
    expect(api.calls.find((c) => c.method === 'PUT')?.body).toEqual({ role: 'admin' });
    expect(members.find((m) => m.user.id === BOB)?.role).toBe('admin');

    vi.stubGlobal('confirm', () => true);
    const remove = wrapper.findAll('button').find((b) => b.text() === 'Remove');
    await remove!.trigger('click');
    await flushPromises();
    expect(api.calls.find((c) => c.method === 'DELETE')?.url.pathname).toBe(
      `/x/groups/${GROUP}/members/${BOB}`,
    );
    expect(wrapper.text()).not.toContain('Bob Reviewer');
  });

  it('shows the problem the API reports', async () => {
    lastAdminGuard = true;
    vi.stubGlobal('confirm', () => true);
    const wrapper = mountEditor({ canManage: true, currentUserId: ALICE });
    await flushPromises();
    await wrapper.find('button').trigger('click');
    await flushPromises();
    expect(wrapper.find('[role="alert"]').text()).toContain('at least one administrator');
    expect(wrapper.emitted('changed')).toBeUndefined();
  });

  it('is read-only without management rights', async () => {
    const wrapper = mountEditor({ canManage: false });
    await flushPromises();
    expect(wrapper.text()).toContain('Alice Annotator');
    expect(wrapper.find('select').exists()).toBe(false);
    expect(wrapper.find('input[type="search"]').exists()).toBe(false);
    expect(wrapper.findAll('button')).toHaveLength(0);
  });
});
