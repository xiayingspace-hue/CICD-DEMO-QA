import { test, expect, APIRequestContext } from '@playwright/test';
import { accounts } from '../support/accounts';

// 来源：QA-auth-001-admin / API-auth-001-admin（CICD-DEMO-CONTEXT）。预期只取自文档。
const login = (request: APIRequestContext, account: string, password: string) =>
  request.post('auth/login', { data: { account, password } });

test.describe('REQ-001 登录接口', () => {
  test('TC-006 账号首尾空格由前端去除，接口以去空格后的账号登录成功', async ({ request }) => {
    const res = await login(request, accounts.owner.account, accounts.owner.password);
    expect(res.status()).toBe(200);
    expect((await res.json()).token).toEqual(expect.any(String));
  });

  test.fixme('TC-007 密码含首尾空格原样提交并登录成功', async () => {
    // 需要联调环境预置一个密码含首尾空格的账号，QA 文档未约定该账号，待 CONTEXT 补充后实现。
  });

  test('TC-008 OWNER 登录返回 role=OWNER', async ({ request }) => {
    const res = await login(request, accounts.owner.account, accounts.owner.password);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      token: expect.any(String),
      expiresIn: expect.any(Number),
      role: 'OWNER',
      displayName: expect.any(String),
    });
  });

  test('TC-009 CSO 登录返回 role=CSO', async ({ request }) => {
    const res = await login(request, accounts.cso.account, accounts.cso.password);
    expect(res.status()).toBe(200);
    expect((await res.json()).role).toBe('CSO');
  });

  test('TC-010 SUBCONTRACTOR 登录返回 role=SUBCONTRACTOR', async ({ request }) => {
    const res = await login(request, accounts.sub.account, accounts.sub.password);
    expect(res.status()).toBe(200);
    expect((await res.json()).role).toBe('SUBCONTRACTOR');
  });

  test('TC-011 密码错误返回 AUTH_INVALID_CREDENTIALS', async ({ request }) => {
    const res = await login(request, accounts.owner.account, `${accounts.owner.password}-wrong`);
    expect(res.ok()).toBeFalsy();
    expect(await res.json()).toMatchObject({ code: 'AUTH_INVALID_CREDENTIALS' });
  });

  test('TC-012 账号不存在与密码错误的响应完全相同', async ({ request }) => {
    const wrongPwd = await login(request, accounts.owner.account, `${accounts.owner.password}-wrong`);
    const noUser = await login(request, 'no-such-user-qa', 'whatever');
    expect(noUser.status()).toBe(wrongPwd.status());
    expect(await noUser.json()).toEqual(await wrongPwd.json());
  });

  test('TC-013 停用账号且密码正确返回 AUTH_ACCOUNT_DISABLED', async ({ request }) => {
    const res = await login(request, accounts.disabled.account, accounts.disabled.password);
    expect(res.ok()).toBeFalsy();
    expect(await res.json()).toMatchObject({ code: 'AUTH_ACCOUNT_DISABLED' });
  });

  test('TC-028 停用账号配错误密码不透露停用状态', async ({ request }) => {
    const disabledWrong = await login(request, accounts.disabled.account, `${accounts.disabled.password}-wrong`);
    const ownerWrong = await login(request, accounts.owner.account, `${accounts.owner.password}-wrong`);
    const body = await disabledWrong.json();
    expect(body.code).toBe('AUTH_INVALID_CREDENTIALS');
    expect(disabledWrong.status()).toBe(ownerWrong.status());
    expect(body).toEqual(await ownerWrong.json());
  });

  test('TC-023 DLP 已到期的 OWNER 仍可登录', async ({ request }) => {
    const res = await login(request, accounts.expired.account, accounts.expired.password);
    expect(res.status()).toBe(200);
    expect((await res.json()).role).toBe('OWNER');
  });

  test('TC-021 携带有效令牌访问 auth/me 返回 role 与 displayName', async ({ request }) => {
    const { token } = await (await login(request, accounts.owner.account, accounts.owner.password)).json();
    const res = await request.get('auth/me', { headers: { Authorization: `Bearer ${token}` } });
    expect(res.status()).toBe(200);
    expect(await res.json()).toMatchObject({ role: 'OWNER', displayName: expect.any(String) });
  });

  test('TC-022 无效令牌访问 auth/me 返回 401 AUTH_UNAUTHENTICATED', async ({ request }) => {
    const res = await request.get('auth/me', { headers: { Authorization: 'Bearer invalid-token' } });
    expect(res.status()).toBe(401);
    expect(await res.json()).toMatchObject({ code: 'AUTH_UNAUTHENTICATED' });
  });

  test('TC-022 未携带令牌访问 auth/me 返回 401', async ({ request }) => {
    const res = await request.get('auth/me');
    expect(res.status()).toBe(401);
    expect(await res.json()).toMatchObject({ code: 'AUTH_UNAUTHENTICATED' });
  });

  test.skip('TC-026 登录走 HTTPS，密码不出现在 URL 与日志', async () => {
    // 需抓包与检查服务日志，Playwright 无法自动验证，人工验证。
  });
});
