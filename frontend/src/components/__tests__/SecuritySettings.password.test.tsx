import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SecuritySettings from '../SecuritySettings';
const mocks = vi.hoisted(() => ({ me: vi.fn(), update: vi.fn() }));
vi.mock('@/lib/api', () => ({ api: { getMe: mocks.me, updateSecurity: mocks.update, getTwoFactorStatus: async () => ({ enabled: false }), listSessions: async () => ({ sessions: [] }) }, broadcastAuthChanged: vi.fn(), withSudo: vi.fn() }));
vi.mock('@/lib/desktopBridge', () => ({ getAppInfo: async () => null }));
vi.mock('@/components/FolderAutoLockSettings', () => ({ default: () => null }));
const t = (key: string) => key;
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t }) }));
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLElement, root: Root;
beforeEach(() => {
  vi.useFakeTimers(); vi.clearAllMocks();
  mocks.update.mockResolvedValue({ success: true });
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.useRealTimers(); });
async function mount(currentPasswordRequired?: boolean) {
  mocks.me.mockResolvedValue({ id: 'account', username: 'nas-user', email: '', displayName: '', currentPasswordRequired });
  await act(async () => root.render(<SecuritySettings />));
}
async function fill(autocomplete: string, value: string, index = 0) {
  const node = host.querySelectorAll<HTMLInputElement>(`input[autocomplete="${autocomplete}"]`)[index];
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(node, value); node.dispatchEvent(new Event('input', { bubbles: true })); });
}
const submit = async () => { await act(async () => { host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); }); };
describe('飞牛首次设置笔记密码', () => {
  it('隐藏当前密码和旧提示，直接提交新密码', async () => {
    await mount(false);
    expect(host.querySelector('input[autocomplete="current-password"]')).toBeNull();
    expect(host.textContent).not.toContain('securitySettings.description');
    await fill('new-password', 'synthetic-password'); await fill('new-password', 'synthetic-password', 1); await submit();
    expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({ currentPassword: undefined, newPassword: 'synthetic-password' }));
  });
  it.each([true, undefined])('已有密码和旧服务器仍要求当前密码（%s）', async (required) => {
    await mount(required);
    expect(host.querySelector<HTMLInputElement>('input[autocomplete="current-password"]')?.required).toBe(true);
    await fill('new-password', 'synthetic-password'); await fill('new-password', 'synthetic-password', 1); await submit();
    expect(mocks.update).not.toHaveBeenCalled();
    expect(host.textContent).toContain('securitySettings.currentPasswordRequired');
  });
});
