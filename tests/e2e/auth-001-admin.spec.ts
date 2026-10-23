import { test, expect, Page, Request } from '@playwright/test';
import { accounts } from '../support/accounts';
import { dbConfigured, setAccountStatus } from '../support/db';

// 来源：QA-auth-001-admin（CICD-DEMO-CONTEXT）。预期只取自文档；定位方式取自前端 data-testid；
// 路径见 ROLES.md：/login、/owner/home、/cso/home、/sub/home。
const LOGIN_API = '**/auth/login';
const ME_API = '**/auth/me';
const MSG_CRED = '账号或密码错误';
const MSG_DISABLED = '账号已停用，请联系 CSO';
const MSG_NETWORK = '网络异常，请稍后重试';

// 前端落地页路径与 ROLES.md 不一致，已在 CONTEXT#6 报告；修复前涉及跳转断言的用例 fixme，不改脚本迁就代码。
const HOME_PATH_ISSUE = 'CONTEXT#6：登录后跳转路径与 ROLES.md 不一致';

const t = (page: Page, id: string) => page.getByTestId(id);

async function openLogin(page: Page) {
  await page.goto('/login');
  await expect(t(page, 'login')).toBeVisible();
}

async function fillAndSubmit(page: Page, account: string, password: string) {
  await t(page, 'account').fill(account);
  await t(page, 'password').fill(password);
  await t(page, 'btn-login').click();
}

/** 记录发往登录接口的请求 */
function trackLogin(page: Page) {
  const reqs: Request[] = [];
  page.on('request', (r) => {
    if (r.url().includes('/auth/login') && r.method() === 'POST') reqs.push(r);
  });
  return reqs;
}

async function tokenFor(page: Page, a: { account: string; password: string }) {
  const res = await page.request.post('/defect-service/auth/login', { data: a });
  expect(res.status()).toBe(200);
  return (await res.json()).token as string;
}

test.describe('REQ-001 登录页', () => {
  test('TC-001 登录页元素齐全，无角色选择、注册、忘记密码入口', async ({ page }) => {
    await openLogin(page);
    await expect(t(page, 'system-name')).toBeVisible();
    await expect(t(page, 'system-name')).not.toBeEmpty();
    await expect(t(page, 'account')).toBeVisible();
    await expect(t(page, 'password')).toBeVisible();
    await expect(t(page, 'btn-login')).toBeVisible();
    await expect(page.getByRole('link')).toHaveCount(0);
    await expect(page.locator('select, input[type=radio], input[type=checkbox]')).toHaveCount(0);
    await expect(page.getByRole('button', { name: /注册|忘记密码/ })).toHaveCount(0);
  });

  test('TC-002 两框都空：分别提示，且无登录请求', async ({ page }) => {
    const reqs = trackLogin(page);
    await openLogin(page);
    await t(page, 'btn-login').click();
    await expect(t(page, 'e-account')).toHaveText('请输入账号');
    await expect(t(page, 'e-password')).toHaveText('请输入密码');
    expect(reqs).toHaveLength(0);
  });

  test('TC-003 只填账号：仅密码下提示', async ({ page }) => {
    const reqs = trackLogin(page);
    await openLogin(page);
    await t(page, 'account').fill(accounts.owner.account);
    await t(page, 'btn-login').click();
    await expect(t(page, 'e-password')).toHaveText('请输入密码');
    await expect(t(page, 'e-account')).toHaveCount(0);
    expect(reqs).toHaveLength(0);
  });

  test('TC-004 只填密码：仅账号下提示', async ({ page }) => {
    const reqs = trackLogin(page);
    await openLogin(page);
    await t(page, 'password').fill(accounts.owner.password);
    await t(page, 'btn-login').click();
    await expect(t(page, 'e-account')).toHaveText('请输入账号');
    await expect(t(page, 'e-password')).toHaveCount(0);
    expect(reqs).toHaveLength(0);
  });

  test('TC-005 账号只有空格视为未填', async ({ page }) => {
    const reqs = trackLogin(page);
    await openLogin(page);
    await fillAndSubmit(page, '   ', accounts.owner.password);
    await expect(t(page, 'e-account')).toHaveText('请输入账号');
    expect(reqs).toHaveLength(0);
  });

  test('TC-006 账号首尾空格自动去除，请求中 account 为 owner01，登录成功', async ({ page }) => {
    test.fixme(true, HOME_PATH_ISSUE);
    const reqs = trackLogin(page);
    await openLogin(page);
    await fillAndSubmit(page, ` ${accounts.owner.account} `, accounts.owner.password);
    await expect(page).toHaveURL(/\/owner\/home$/);
    expect(reqs[0].postDataJSON().account).toBe(accounts.owner.account);
  });

  test('TC-007 密码首尾空格原样提交', async ({ page }) => {
    // QA 文档：拦截登录请求验证请求体，不依赖真实账号。
    await page.route(LOGIN_API, (route) =>
      route.fulfill({ status: 401, json: { code: 'AUTH_INVALID_CREDENTIALS', message: MSG_CRED } }),
    );
    const reqs = trackLogin(page);
    await openLogin(page);
    await fillAndSubmit(page, accounts.owner.account, '  Test@1234  ');
    await expect(t(page, 'banner-cred')).toBeVisible();
    expect(reqs[0].postDataJSON().password).toBe('  Test@1234  ');
  });

  for (const [tc, key, path] of [
    ['TC-008', 'owner', '/owner/home'],
    ['TC-009', 'cso', '/cso/home'],
    ['TC-010', 'sub', '/sub/home'],
  ] as const) {
    test(`TC-${tc.slice(3)} ${accounts[key].account} 登录后跳转 ${path}`, async ({ page }) => {
    test.fixme(true, HOME_PATH_ISSUE);
      await openLogin(page);
      await fillAndSubmit(page, accounts[key].account, accounts[key].password);
      await expect(page).toHaveURL(new RegExp(`${path}$`));
    });
  }

  test('TC-011 密码错误：提示，清空密码，保留账号，焦点在密码框', async ({ page }) => {
    await openLogin(page);
    await fillAndSubmit(page, accounts.owner.account, 'wrong-password');
    await expect(t(page, 'banner-cred')).toHaveText(MSG_CRED);
    await expect(t(page, 'password')).toHaveValue('');
    await expect(t(page, 'account')).toHaveValue(accounts.owner.account);
    await expect(t(page, 'password')).toBeFocused();
  });

  test('TC-012 账号不存在：提示与 TC-011 完全相同', async ({ page }) => {
    await openLogin(page);
    await fillAndSubmit(page, 'no-such-user-qa', 'whatever');
    await expect(t(page, 'banner-cred')).toHaveText(MSG_CRED);
    await expect(t(page, 'password')).toHaveValue('');
    await expect(t(page, 'account')).toHaveValue('no-such-user-qa');
    await expect(t(page, 'password')).toBeFocused();
    await expect(page.getByRole('alert')).toHaveCount(1);
  });

  test('TC-013 停用账号正确密码：提示联系 CSO，账号密码均保留', async ({ page }) => {
    await openLogin(page);
    await fillAndSubmit(page, accounts.disabled.account, accounts.disabled.password);
    await expect(t(page, 'banner-noperm')).toHaveText(MSG_DISABLED);
    await expect(t(page, 'account')).toHaveValue(accounts.disabled.account);
    await expect(t(page, 'password')).toHaveValue(accounts.disabled.password);
  });

  test('TC-014 提交中按钮禁用并加载，连点只发 1 次请求', async ({ page }) => {
    test.fixme(true, HOME_PATH_ISSUE);
    await page.route(LOGIN_API, async (route) => {
      await new Promise((r) => setTimeout(r, 3000));
      await route.continue();
    });
    const reqs = trackLogin(page);
    await openLogin(page);
    await t(page, 'account').fill(accounts.owner.account);
    await t(page, 'password').fill(accounts.owner.password);
    await t(page, 'btn-login').click();
    await expect(t(page, 'btn-login')).toBeDisabled();
    await expect(t(page, 'login-loading')).toBeVisible();
    for (let i = 0; i < 5; i++) await t(page, 'btn-login').click({ force: true });
    await expect(page).toHaveURL(/\/owner\/home$/);
    expect(reqs).toHaveLength(1);
  });

  test('TC-015 接口 5xx：提示网络异常，输入保留，恢复后可成功', async ({ page }) => {
    test.fixme(true, HOME_PATH_ISSUE);
    await page.route(LOGIN_API, (route) => route.fulfill({ status: 500, body: 'boom' }));
    await openLogin(page);
    await fillAndSubmit(page, accounts.owner.account, accounts.owner.password);
    await expect(t(page, 'banner-error')).toHaveText(MSG_NETWORK);
    await expect(t(page, 'account')).toHaveValue(accounts.owner.account);
    await expect(t(page, 'password')).toHaveValue(accounts.owner.password);
    await page.unroute(LOGIN_API);
    await t(page, 'btn-login').click();
    await expect(page).toHaveURL(/\/owner\/home$/);
  });

  test('TC-015 断网：提示网络异常，输入保留', async ({ page }) => {
    await page.route(LOGIN_API, (route) => route.abort('connectionrefused'));
    await openLogin(page);
    await fillAndSubmit(page, accounts.owner.account, accounts.owner.password);
    await expect(t(page, 'banner-error')).toHaveText(MSG_NETWORK);
    await expect(t(page, 'account')).toHaveValue(accounts.owner.account);
    await expect(t(page, 'password')).toHaveValue(accounts.owner.password);
  });

  test('TC-016 接口响应超过 10 秒：10 秒后提示网络异常', async ({ page }) => {
    test.setTimeout(40_000);
    await page.route(LOGIN_API, async (route) => {
      await new Promise((r) => setTimeout(r, 13_000));
      await route.abort().catch(() => {});
    });
    await openLogin(page);
    await fillAndSubmit(page, accounts.owner.account, accounts.owner.password);
    const start = Date.now();
    await expect(t(page, 'banner-error')).toHaveText(MSG_NETWORK, { timeout: 12_500 });
    expect(Date.now() - start).toBeGreaterThanOrEqual(9_000);
  });

  test('TC-017 点眼睛图标两次：先明文，再掩码', async ({ page }) => {
    await openLogin(page);
    await t(page, 'password').fill(accounts.owner.password);
    await t(page, 'toggle-pwd').click();
    await expect(t(page, 'password')).toHaveAttribute('type', 'text');
    await t(page, 'toggle-pwd').click();
    await expect(t(page, 'password')).toHaveAttribute('type', 'password');
  });

  test('TC-018 密码框默认掩码', async ({ page }) => {
    await openLogin(page);
    await expect(t(page, 'password')).toHaveAttribute('type', 'password');
  });

  test('TC-019 账号框回车等同点登录', async ({ page }) => {
    test.fixme(true, HOME_PATH_ISSUE);
    await openLogin(page);
    await t(page, 'password').fill(accounts.owner.password);
    await t(page, 'account').fill(accounts.owner.account);
    await t(page, 'account').press('Enter');
    await expect(page).toHaveURL(/\/owner\/home$/);
  });

  test('TC-020 密码框回车等同点登录', async ({ page }) => {
    test.fixme(true, HOME_PATH_ISSUE);
    await openLogin(page);
    await t(page, 'account').fill(accounts.owner.account);
    await t(page, 'password').fill(accounts.owner.password);
    await t(page, 'password').press('Enter');
    await expect(page).toHaveURL(/\/owner\/home$/);
  });

  test('TC-021 已登录访问登录页：确认期间不展示表单，随后跳转屋主首页', async ({ page }) => {
    test.fixme(true, HOME_PATH_ISSUE);
    const token = await tokenFor(page, accounts.owner);
    await page.addInitScript((tk) => localStorage.setItem('token', tk), token);
    await page.route(ME_API, async (route) => {
      await new Promise((r) => setTimeout(r, 1500));
      await route.continue();
    });
    await page.goto('/login');
    await expect(t(page, 'auth-checking')).toBeVisible();
    await expect(t(page, 'login-form')).toHaveCount(0);
    await expect(page).toHaveURL(/\/owner\/home$/);
  });

  test('TC-022 令牌失效：停留在登录页并显示表单', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('token', 'invalid-token'));
    await page.goto('/login');
    await expect(t(page, 'login-form')).toBeVisible();
    await expect(page).toHaveURL(/\/login$/);
  });

  test('TC-022 auth/me 网络失败：视为未登录，显示登录表单', async ({ page }) => {
    const token = await tokenFor(page, accounts.owner);
    await page.addInitScript((tk) => localStorage.setItem('token', tk), token);
    await page.route(ME_API, (route) => route.abort('connectionrefused'));
    await page.goto('/login');
    await expect(t(page, 'login-form')).toBeVisible();
    await expect(page).toHaveURL(/\/login$/);
  });

  test('TC-022 auth/me 超时：视为未登录，显示登录表单', async ({ page }) => {
    test.setTimeout(40_000);
    const token = await tokenFor(page, accounts.owner);
    await page.addInitScript((tk) => localStorage.setItem('token', tk), token);
    await page.route(ME_API, async (route) => {
      await new Promise((r) => setTimeout(r, 13_000));
      await route.abort().catch(() => {});
    });
    await page.goto('/login');
    await expect(t(page, 'login-form')).toBeVisible({ timeout: 15_000 });
    await expect(page).toHaveURL(/\/login$/);
  });

  test('TC-023 DLP 已到期的屋主可登录并跳转屋主首页', async ({ page }) => {
    test.fixme(true, HOME_PATH_ISSUE);
    await openLogin(page);
    await fillAndSubmit(page, accounts.expired.account, accounts.expired.password);
    await expect(page).toHaveURL(/\/owner\/home$/);
  });

  test('TC-024 页面底部显示 CSO 分配账号的提示', async ({ page }) => {
    await openLogin(page);
    await expect(t(page, 'login-foot')).toHaveText('账号由 CSO 分配，忘记密码请联系 CSO');
  });

  test('TC-025 账号框粘贴 200 字符：框内滚动，布局不被撑破', async ({ page }) => {
    await openLogin(page);
    const input = t(page, 'account');
    const before = await input.boundingBox();
    await input.fill('a'.repeat(200));
    const after = await input.boundingBox();
    expect(after!.width).toBeCloseTo(before!.width, 0);
    expect(await input.evaluate((el: HTMLInputElement) => el.scrollWidth > el.clientWidth)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });

  test('TC-027 1280px 宽度：布局完整，无横向滚动条', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await openLogin(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    for (const id of ['system-name', 'account', 'password', 'btn-login', 'login-foot']) {
      await expect(t(page, id)).toBeInViewport();
    }
  });

  test('TC-028 停用账号配错误密码：与 TC-011 提示相同，不透露停用', async ({ page }) => {
    await openLogin(page);
    await fillAndSubmit(page, accounts.disabled.account, 'wrong-password');
    await expect(t(page, 'banner-cred')).toHaveText(MSG_CRED);
    await expect(t(page, 'banner-noperm')).toHaveCount(0);
    await expect(t(page, 'password')).toHaveValue('');
    await expect(t(page, 'password')).toBeFocused();
  });

  test('TC-029 账号停用后持旧令牌访问登录页：停留在登录页', async ({ page }) => {
    test.skip(!dbConfigured, '未配置 DB_HOST：无法直连联调库停用账号');
    const { account } = accounts.revoke;
    const token = await tokenFor(page, accounts.revoke);
    await page.addInitScript((tk) => localStorage.setItem('token', tk), token);
    try {
      await setAccountStatus(account, 'DISABLED');
      await page.goto('/login');
      await expect(t(page, 'login-form')).toBeVisible();
      await expect(page).toHaveURL(/\/login$/);
    } finally {
      await setAccountStatus(account, 'ENABLED');
    }
  });

  test('TC-031 账号大小写不同：提示账号或密码错误', async ({ page }) => {
    await openLogin(page);
    await fillAndSubmit(page, 'Owner01', accounts.owner.password);
    await expect(t(page, 'banner-cred')).toHaveText(MSG_CRED);
  });

  test('TC-032 接口返回无法识别的 code（429）：提示网络异常，输入保留', async ({ page }) => {
    await page.route(LOGIN_API, (route) =>
      route.fulfill({ status: 429, json: { code: 'RATE_LIMITED', message: 'too many' } }),
    );
    await openLogin(page);
    await fillAndSubmit(page, accounts.owner.account, accounts.owner.password);
    await expect(t(page, 'banner-error')).toHaveText(MSG_NETWORK);
    await expect(t(page, 'account')).toHaveValue(accounts.owner.account);
    await expect(t(page, 'password')).toHaveValue(accounts.owner.password);
  });
});
