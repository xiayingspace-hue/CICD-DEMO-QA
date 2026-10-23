import { test, expect, APIRequestContext } from '@playwright/test';
import { accounts } from '../support/accounts';
import { dbConfigured, setAccountStatus } from '../support/db';

// 来源：QA-auth-001-admin / API-auth-001-admin（CICD-DEMO-CONTEXT）。预期只取自文档。
const login = (request: APIRequestContext, account: string, password: string) =>
  request.post('auth/login', { data: { account, password } });

test.describe('REQ-001 登录接口', () => {
  test.describe.configure({ mode: 'serial' }); // TC-029 会改账号状态
  test.skip('TC-007 密码首尾空格原样提交', async () => {
    // QA 文档：仅在 E2E 通过拦截请求体验证，API 层没有对应账号，不测。
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
    expect(res.status()).toBe(401);
    expect(await res.json()).toMatchObject({ code: 'AUTH_INVALID_CREDENTIALS' });
  });

  test('TC-012 账号不存在与密码错误的响应完全相同', async ({ request }) => {
    const wrongPwd = await login(request, accounts.owner.account, `${accounts.owner.password}-wrong`);
    const noUser = await login(request, 'no-such-user-qa', 'whatever');
    expect(noUser.status()).toBe(401);
    expect(wrongPwd.status()).toBe(401);
    expect(await noUser.json()).toEqual(await wrongPwd.json());
  });

  test('TC-013 停用账号且密码正确返回 AUTH_ACCOUNT_DISABLED', async ({ request }) => {
    const res = await login(request, accounts.disabled.account, accounts.disabled.password);
    expect(res.status()).toBe(403);
    expect(await res.json()).toMatchObject({ code: 'AUTH_ACCOUNT_DISABLED' });
  });

  test('TC-028 停用账号配错误密码不透露停用状态', async ({ request }) => {
    const disabledWrong = await login(request, accounts.disabled.account, `${accounts.disabled.password}-wrong`);
    const ownerWrong = await login(request, accounts.owner.account, `${accounts.owner.password}-wrong`);
    const body = await disabledWrong.json();
    expect(disabledWrong.status()).toBe(401);
    expect(body.code).toBe('AUTH_INVALID_CREDENTIALS');
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

  test('TC-029 账号停用后已签发令牌立即失效', async ({ request }) => {
    test.skip(!dbConfigured, '未配置 DB_HOST：无法直连联调库停用账号（CI 中跳过，联调环境本地运行）');
    const { account, password } = accounts.revoke;
    const { token } = await (await login(request, account, password)).json();
    const headers = { Authorization: `Bearer ${token}` };
    expect((await request.get('auth/me', { headers })).status()).toBe(200);
    try {
      await setAccountStatus(account, 'DISABLED');
      const res = await request.get('auth/me', { headers });
      expect(res.status()).toBe(401);
      expect(await res.json()).toMatchObject({ code: 'AUTH_UNAUTHENTICATED' });
    } finally {
      await setAccountStatus(account, 'ENABLED');
    }
  });

  const badBodies: [string, { data?: unknown; headers?: Record<string, string> }][] = [
    ['缺少 account', { data: { password: accounts.owner.password } }],
    ['缺少 password', { data: { account: accounts.owner.account } }],
    ['两者为空字符串', { data: { account: '', password: '' } }],
    ['请求体不是合法 JSON', { data: '{not json', headers: { 'Content-Type': 'application/json' } }],
  ];
  for (const [name, opts] of badBodies) {
    test(`TC-030 ${name}：返回 401 AUTH_INVALID_CREDENTIALS`, async ({ request }) => {
      const res = await request.post('auth/login', opts);
      expect(res.status()).toBe(401);
      expect(await res.json()).toMatchObject({ code: 'AUTH_INVALID_CREDENTIALS' });
    });
  }

  test('TC-031 账号区分大小写：Owner01 登录失败', async ({ request }) => {
    const res = await login(request, 'Owner01', accounts.owner.password);
    expect(res.status()).toBe(401);
    expect(await res.json()).toMatchObject({ code: 'AUTH_INVALID_CREDENTIALS' });
  });

  test.skip('TC-026 登录走 HTTPS，密码不出现在 URL 与日志', async () => {
    // 需抓包与检查服务日志，Playwright 无法自动验证，人工验证。
  });
});
