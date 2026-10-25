import { test as base, expect, Page, APIRequestContext } from '@playwright/test';
import {
  accounts, bearer, createDefect, Defect, getDefect, gifBuffer, MB10, pngOfSize, tokenOf, uploadPng, validDefect, withdrawDefect,
} from '../support/defect';
import {
  dbConfigured, defectHelpersReady, defectHelpersSkipReason, findSeedDefectId, prevDay, setAccountStatus, setDefectStatus,
  setDlpEndDate, sgToday,
} from '../support/db';

// 来源：QA-defect-002-user（CICD-DEMO-CONTEXT，feat/req-002-submit-defect）。预期只取自文档；
// 定位方式取自前端 CICD-DEMO-WEB 的 data-testid；路由：/owner/home、/owner/defects/new、/owner/defects/:id、/owner/defects/:id/edit。
const API_URL = (process.env.API_BASE_URL ?? 'http://localhost:8080/defect-service').replace(/\/?$/, '/');
const MSG_NETWORK = '网络异常，请稍后重试';
const MSG_LOCKED = '缺陷已派单，不能修改或撤回';

const test = base.extend<{ api: APIRequestContext }>({
  api: async ({ playwright }, use) => {
    const ctx = await playwright.request.newContext({ baseURL: API_URL, extraHTTPHeaders: { Accept: 'application/json' } });
    await use(ctx);
    await ctx.dispose();
  },
});

const t = (page: Page, id: string) => page.getByTestId(id);
const png = (name = 'ok.png', size = 2048) => ({ name, mimeType: 'image/png', buffer: pngOfSize(size) });

/** 以接口登录取令牌，写入 localStorage（只在新标签首次加载时写，避免登录态失效后又被写回） */
async function loginAs(page: Page, api: APIRequestContext, a: { account: string; password: string }) {
  const token = await tokenOf(api, a);
  await page.addInitScript((tk) => {
    if (!sessionStorage.getItem('__qa_token_set')) {
      localStorage.setItem('token', tk);
      sessionStorage.setItem('__qa_token_set', '1');
    }
  }, token);
  return token;
}

const openNew = async (page: Page) => {
  await page.goto('/owner/defects/new');
  await expect(t(page, 'defect-form')).toBeVisible();
};

async function fillForm(page: Page, v: { location?: string; category?: string; description?: string } = validDefect) {
  if (v.location !== undefined) await t(page, 'location').selectOption(v.location);
  if (v.category !== undefined) await t(page, 'category').selectOption(v.category);
  if (v.description !== undefined) await t(page, 'description').fill(v.description);
}

/** 记录发往指定接口的请求（method + 路径结尾），返回请求体 */
function track(page: Page, method: string, pathEnd: RegExp) {
  const reqs: string[] = [];
  page.on('request', (r) => {
    if (r.method() === method && pathEnd.test(new URL(r.url()).pathname)) reqs.push(r.postData() ?? '');
  });
  return reqs;
}
const CREATE = /\/defects$/;
const UPLOAD = /\/defect-images$/;

async function addImages(page: Page, files: { name: string; mimeType: string; buffer: Buffer }[]) {
  await t(page, 'file-input').setInputFiles(files);
}
const doneCount = (page: Page, n: number) => expect(page.locator('[data-status=done]')).toHaveCount(n);

async function submitAndConfirm(page: Page) {
  await t(page, 'btn-submit').click();
  await expect(t(page, 'm-submit')).toBeVisible();
  await t(page, 'm-submit-confirm').click();
}
const expectOnDetail = (page: Page) => expect(page).toHaveURL(/\/owner\/defects\/\d+$/);

const lastModified = async (api: APIRequestContext, token: string, id: string) =>
  ((await (await getDefect(api, token, id)).json()) as Defect).lastModifiedAt;

test.describe('REQ-002 提交缺陷页', () => {
  test('TC-001 首页与侧栏入口，进入提交页', async ({ page, api }) => {
    await loginAs(page, api, accounts.owner);
    await page.goto('/owner/home');
    await expect(t(page, 'nav-home')).toHaveText('首页');
    await expect(t(page, 'nav-new')).toHaveText('提交缺陷');
    await t(page, 'btn-new-defect').click();
    await expect(page).toHaveURL(/\/owner\/defects\/new$/);
    for (const id of ['location', 'category', 'description', 'btn-add-image']) await expect(t(page, id)).toBeVisible();
  });

  test('TC-002 所属单元只读展示单元 A', async ({ page, api }) => {
    const token = await loginAs(page, api, accounts.owner);
    const ctx = await (await api.get('owner/submit-context', { headers: bearer(token) })).json();
    await openNew(page);
    await expect(t(page, 'unit')).toHaveValue(ctx.unitName);
    await expect(t(page, 'unit')).toBeDisabled();
  });

  test('TC-003 全部留空提交：三处必填提示，无创建请求', async ({ page, api }) => {
    await loginAs(page, api, accounts.owner);
    const reqs = track(page, 'POST', CREATE);
    await openNew(page);
    await t(page, 'btn-submit').click();
    await expect(t(page, 'e-location')).toHaveText('请选择缺陷位置');
    await expect(t(page, 'e-category')).toHaveText('请选择缺陷类别');
    await expect(t(page, 'e-description')).toHaveText('请填写缺陷描述');
    await expect(t(page, 'm-submit')).toHaveCount(0);
    expect(reqs).toHaveLength(0);
  });

  const missing: [string, string, Record<string, string>, string][] = [
    ['TC-004', 'location', { category: validDefect.category, description: validDefect.description }, '请选择缺陷位置'],
    ['TC-005', 'category', { location: validDefect.location, description: validDefect.description }, '请选择缺陷类别'],
    ['TC-006', 'description', { location: validDefect.location, category: validDefect.category }, '请填写缺陷描述'],
  ];
  for (const [tc, field, values, msg] of missing) {
    test(`${tc} 只缺${field}：仅该字段下提示，无创建请求`, async ({ page, api }) => {
      await loginAs(page, api, accounts.owner);
      const reqs = track(page, 'POST', CREATE);
      await openNew(page);
      await fillForm(page, values);
      await t(page, 'btn-submit').click();
      await expect(t(page, `e-${field}`)).toHaveText(msg);
      for (const other of ['location', 'category', 'description'].filter((f) => f !== field)) await expect(t(page, `e-${other}`)).toHaveCount(0);
      expect(reqs).toHaveLength(0);
    });
  }

  test('TC-007 描述只有空格视为未填', async ({ page, api }) => {
    await loginAs(page, api, accounts.owner);
    const reqs = track(page, 'POST', CREATE);
    await openNew(page);
    await fillForm(page, { ...validDefect, description: '     ' });
    await t(page, 'btn-submit').click();
    await expect(t(page, 'e-description')).toHaveText('请填写缺陷描述');
    expect(reqs).toHaveLength(0);
  });

  test('TC-008 描述 501 个字符：提示且无创建请求', async ({ page, api }) => {
    await loginAs(page, api, accounts.owner);
    const reqs = track(page, 'POST', CREATE);
    await openNew(page);
    await fillForm(page, { ...validDefect, description: '字'.repeat(501) });
    await t(page, 'btn-submit').click();
    await expect(t(page, 'e-description')).toHaveText('描述不能超过 500 字');
    expect(reqs).toHaveLength(0);
  });

  test('TC-009 描述恰好 500 个码点（含 emoji）可提交；501 个被拒绝', async ({ page, api }) => {
    await loginAs(page, api, accounts.owner);
    await openNew(page);
    const d500 = '汉'.repeat(250) + '😀'.repeat(250);
    expect(Array.from(d500)).toHaveLength(500);
    await fillForm(page, { ...validDefect, description: d500 });
    await submitAndConfirm(page);
    await expectOnDetail(page);
    await openNew(page);
    await fillForm(page, { ...validDefect, description: d500 + '😀' });
    await t(page, 'btn-submit').click();
    await expect(t(page, 'e-description')).toHaveText('描述不能超过 500 字');
  });

  test('TC-010 描述首尾空格去掉后提交', async ({ page, api }) => {
    await loginAs(page, api, accounts.owner);
    const reqs = track(page, 'POST', CREATE);
    await openNew(page);
    await fillForm(page, { ...validDefect, description: '  水管渗水  ' });
    await submitAndConfirm(page);
    await expectOnDetail(page);
    expect(JSON.parse(reqs[0]).description).toBe('水管渗水');
    expect(await t(page, 'd-desc').evaluate((e) => (e as HTMLElement).innerText)).toBe('水管渗水');
  });

  test('TC-012 选择 gif：提示格式，不加入列表，无上传请求', async ({ page, api }) => {
    await loginAs(page, api, accounts.owner);
    const reqs = track(page, 'POST', UPLOAD);
    await openNew(page);
    await addImages(page, [{ name: 'photo.gif', mimeType: 'image/gif', buffer: gifBuffer }]);
    await expect(t(page, 'e-images')).toHaveText('仅支持 jpg、png 格式');
    await expect(page.locator('[data-testid^=thumb-][data-status]')).toHaveCount(0);
    expect(reqs).toHaveLength(0);
  });

  test('TC-013 选择 10MB+1 字节图片：提示大小，不加入列表，无上传请求', async ({ page, api }) => {
    await loginAs(page, api, accounts.owner);
    const reqs = track(page, 'POST', UPLOAD);
    await openNew(page);
    await addImages(page, [png('over-10mb.png', MB10 + 1)]);
    await expect(t(page, 'e-images')).toHaveText('单张图片不能超过 10MB');
    await expect(page.locator('[data-testid^=thumb-][data-status]')).toHaveCount(0);
    expect(reqs).toHaveLength(0);
  });

  test('TC-014 恰好 10MB 的图片加入列表并上传成功', async ({ page, api }) => {
    await loginAs(page, api, accounts.owner);
    await openNew(page);
    await addImages(page, [png('edge-10mb.png', MB10)]);
    await doneCount(page, 1);
    await expect(t(page, 'e-images')).toHaveCount(0);
  });

  test('TC-015 已上传 5 张后再选 1 张：提示「最多上传 5 张图片」，不加入', async ({ page, api }) => {
    await loginAs(page, api, accounts.owner);
    await openNew(page);
    await addImages(page, Array.from({ length: 5 }, (_, i) => png(`p${i}.png`)));
    await doneCount(page, 5);
    // 需求 AC-004：已有 5 张时再添加提示「最多上传 5 张图片」
    await t(page, 'file-input').setInputFiles([png('p6.png')], { timeout: 3000 });
    await expect(t(page, 'e-images')).toHaveText('最多上传 5 张图片');
    await doneCount(page, 5);
  });

  test('TC-081 已有 3 张一次选 3 张：加入前 2 张，其余提示', async ({ page, api }) => {
    await loginAs(page, api, accounts.owner);
    await openNew(page);
    await addImages(page, [png('a1.png'), png('a2.png'), png('a3.png')]);
    await doneCount(page, 3);
    await addImages(page, [png('b1.png'), png('b2.png'), png('b3.png')]);
    await doneCount(page, 5);
    await expect(t(page, 'e-images')).toHaveText('最多上传 5 张图片');
    await expect(page.locator('[data-testid^=thumb-][data-status]')).toHaveCount(5);
  });

  test('TC-019 不传图片提交成功，图片区显示「无图片」', async ({ page, api }) => {
    await loginAs(page, api, accounts.owner);
    await openNew(page);
    await fillForm(page);
    await submitAndConfirm(page);
    await expectOnDetail(page);
    await expect(t(page, 'd-no-images')).toHaveText('无图片');
  });

  test('TC-020 填写并上传 1 张图片：确认框确认后创建，待派单，展示编号', async ({ page, api }) => {
    await loginAs(page, api, accounts.owner);
    await openNew(page);
    await fillForm(page);
    await addImages(page, [png()]);
    await doneCount(page, 1);
    await submitAndConfirm(page);
    await expectOnDetail(page);
    await expect(t(page, 'd-status')).toHaveText('待派单');
    await expect(t(page, 'd-no')).toHaveText(/^DF-\d{6}$/);
  });

  test('TC-021 上传 5 张图片提交，详情展示 5 张', async ({ page, api }) => {
    await loginAs(page, api, accounts.owner);
    await openNew(page);
    await fillForm(page);
    await addImages(page, Array.from({ length: 5 }, (_, i) => png(`p${i}.png`)));
    await doneCount(page, 5);
    await submitAndConfirm(page);
    await expectOnDetail(page);
    await expect(t(page, 'd-image')).toHaveCount(5);
  });

  test('TC-022 确认框点「再看看」：停留提交页，输入保留，无创建请求', async ({ page, api }) => {
    await loginAs(page, api, accounts.owner);
    const reqs = track(page, 'POST', CREATE);
    await openNew(page);
    await fillForm(page);
    await t(page, 'btn-submit').click();
    await t(page, 'm-submit-cancel').click();
    await expect(t(page, 'm-submit')).toHaveCount(0);
    await expect(page).toHaveURL(/\/owner\/defects\/new$/);
    await expect(t(page, 'description')).toHaveValue(validDefect.description);
    expect(reqs).toHaveLength(0);
  });

  test('TC-024 详情展示全部字段；图片为缩略图、新标签页打开、不显示文件名', async ({ page, api }) => {
    const token = await loginAs(page, api, accounts.owner);
    const img = await uploadPng(api, token, 'secret-name.png');
    const d = await createDefect(api, token, { imageIds: [img.imageId] });
    await page.goto(`/owner/defects/${d.defectId}`);
    await expect(t(page, 'd-no')).toHaveText(d.defectNo);
    await expect(t(page, 'd-unit')).toHaveText(d.unitName);
    await expect(t(page, 'd-location')).toHaveText('厨房');
    await expect(t(page, 'd-category')).toHaveText('水电');
    await expect(t(page, 'd-desc')).toHaveText(validDefect.description);
    await expect(t(page, 'd-status')).toHaveText('待派单');
    await expect(t(page, 'd-submitted')).toHaveText(/^\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}$/);
    await expect(t(page, 'd-image')).toHaveCount(1);
    await expect(t(page, 'd-image')).toHaveAttribute('target', '_blank');
    await expect(t(page, 'd-image').locator('img')).toBeVisible();
    await expect(t(page, 'd-images')).not.toContainText('secret-name');
  });

  test('TC-026 提交中按钮禁用显示「提交中…」，重复点击只产生 1 次创建请求', async ({ page, api }) => {
    await loginAs(page, api, accounts.owner);
    const reqs = track(page, 'POST', CREATE);
    await page.route('**/defects', async (route) => {
      if (route.request().method() === 'POST') await new Promise((r) => setTimeout(r, 3000));
      await route.continue();
    });
    await openNew(page);
    await fillForm(page);
    await submitAndConfirm(page);
    await expect(t(page, 'btn-submit')).toBeDisabled();
    await expect(t(page, 'btn-submit')).toHaveText('提交中…');
    for (let i = 0; i < 5; i++) await t(page, 'btn-submit').click({ force: true, timeout: 500 }).catch(() => {});
    await expectOnDetail(page);
    expect(reqs).toHaveLength(1);
  });

  test('TC-027 提交接口 5xx：提示网络异常，输入与 2 张图片保留，再次提交成功', async ({ page, api }) => {
    await loginAs(page, api, accounts.owner);
    await openNew(page);
    await fillForm(page);
    await addImages(page, [png('a.png'), png('b.png')]);
    await doneCount(page, 2);
    let fail = true;
    await page.route('**/defects', async (route) => {
      if (route.request().method() === 'POST' && fail) return route.fulfill({ status: 503, body: 'down' });
      return route.continue();
    });
    await submitAndConfirm(page);
    await expect(t(page, 'banner-form')).toHaveText(MSG_NETWORK);
    await expect(t(page, 'description')).toHaveValue(validDefect.description);
    await doneCount(page, 2);
    fail = false;
    await submitAndConfirm(page);
    await expectOnDetail(page);
    await expect(t(page, 'd-image')).toHaveCount(2);
  });

  test('TC-028 提交接口响应超过 10 秒（11 秒、30 秒）：提示网络异常，输入保留', async ({ page, api }) => {
    test.setTimeout(120_000);
    await loginAs(page, api, accounts.owner);
    let delay = 11_000;
    await page.route('**/defects', async (route) => {
      if (route.request().method() !== 'POST') return route.continue();
      await new Promise((r) => setTimeout(r, delay));
      await route.abort().catch(() => {});
    });
    await openNew(page);
    await fillForm(page);
    for (const d of [11_000, 30_000]) {
      delay = d;
      const start = Date.now();
      await submitAndConfirm(page);
      await expect(t(page, 'banner-form')).toHaveText(MSG_NETWORK, { timeout: 15_000 });
      expect(Date.now() - start).toBeLessThan(13_000); // 10 秒即视为异常，不等到响应
      await expect(t(page, 'description')).toHaveValue(validDefect.description);
    }
  });

  test('TC-029 提交接口返回无法识别的 code（429）：提示网络异常，输入保留', async ({ page, api }) => {
    await loginAs(page, api, accounts.owner);
    await page.route('**/defects', (route) =>
      route.request().method() === 'POST'
        ? route.fulfill({ status: 429, contentType: 'application/json', body: JSON.stringify({ code: 'TOO_MANY_REQUESTS' }) })
        : route.continue(),
    );
    await openNew(page);
    await fillForm(page);
    await submitAndConfirm(page);
    await expect(t(page, 'banner-form')).toHaveText(MSG_NETWORK);
    await expect(t(page, 'description')).toHaveValue(validDefect.description);
  });

  test('TC-030 图片上传中：提交不可用并提示，完成后恢复', async ({ page, api }) => {
    await loginAs(page, api, accounts.owner);
    await page.route('**/defect-images', async (route) => {
      if (route.request().method() === 'POST') await new Promise((r) => setTimeout(r, 3000));
      await route.continue();
    });
    await openNew(page);
    await fillForm(page);
    await addImages(page, [png()]);
    await expect(t(page, 'btn-submit')).toBeDisabled();
    await expect(t(page, 'uploading-hint')).toHaveText('图片上传中，请稍候');
    await doneCount(page, 1);
    await expect(t(page, 'btn-submit')).toBeEnabled();
    await expect(t(page, 'uploading-hint')).toHaveCount(0);
  });

  test('TC-031 第 3 张上传失败：显示「上传失败」，其余不受影响，可重试', async ({ page, api }) => {
    await loginAs(page, api, accounts.owner);
    let calls = 0;
    await page.route('**/defect-images', (route) => {
      if (route.request().method() === 'POST' && ++calls === 3) return route.fulfill({ status: 500, body: 'err' });
      return route.continue();
    });
    await openNew(page);
    await addImages(page, [png('a.png'), png('b.png')]);
    await doneCount(page, 2);
    await addImages(page, [png('c.png')]);
    await expect(t(page, 'thumb-2')).toHaveAttribute('data-status', 'failed');
    await expect(t(page, 'thumb-2')).toContainText('上传失败');
    await expect(t(page, 'thumb-0')).toHaveAttribute('data-status', 'done');
    await expect(t(page, 'thumb-1')).toHaveAttribute('data-status', 'done');
    await t(page, 'thumb-2').getByTestId('thumb-retry').click();
    await expect(t(page, 'thumb-2')).toHaveAttribute('data-status', 'done');
  });

  test('TC-032 DLP 已到期：不展示表单，提示结束日期', async ({ page, api }) => {
    const token = await loginAs(page, api, accounts.expired);
    const ctx = await (await api.get('owner/submit-context', { headers: bearer(token) })).json();
    const [y, m, d] = (ctx.dlpEndDate as string).split('-');
    await page.goto('/owner/defects/new');
    await expect(t(page, 'dlp-msg')).toHaveText(`缺陷责任期已于 ${d}/${m}/${y} 结束，不能再提交缺陷`);
    await expect(t(page, 'defect-form')).toHaveCount(0);
  });

  test('TC-076 未绑定单元：不展示表单并提示联系 CSO', async ({ page, api }) => {
    await loginAs(page, api, accounts.nounit);
    await page.goto('/owner/defects/new');
    await expect(t(page, 'no-unit-msg')).toHaveText('账号未绑定单元，请联系 CSO');
    await expect(t(page, 'defect-form')).toHaveCount(0);
  });

  test('TC-088 提交确认框的标题、正文、按钮文案', async ({ page, api }) => {
    await loginAs(page, api, accounts.owner);
    await openNew(page);
    await fillForm(page);
    await t(page, 'btn-submit').click();
    const dlg = t(page, 'm-submit');
    await expect(dlg).toContainText('确认提交缺陷');
    await expect(dlg).toContainText('提交后缺陷进入「待派单」，在 CSO 派单前你可以修改或撤回。');
    await expect(t(page, 'm-submit-cancel')).toHaveText('再看看');
    await expect(t(page, 'm-submit-confirm')).toHaveText('确认提交');
  });

  test('TC-090 离开确认框的标题、正文、按钮文案', async ({ page, api }) => {
    await loginAs(page, api, accounts.owner);
    await openNew(page);
    await fillForm(page, { description: 'x' });
    await t(page, 'nav-home').click();
    const dlg = t(page, 'm-leave');
    await expect(dlg).toContainText('未提交的内容将丢失');
    await expect(dlg).toContainText('不保存草稿，离开后已填写的内容和已上传的图片不会保留。');
    await expect(t(page, 'm-leave-cancel')).toHaveText('继续填写');
    await expect(t(page, 'm-leave-confirm')).toHaveText('离开');
  });

  test('TC-059 填写后点侧栏「首页」：弹出确认，仍停留提交页', async ({ page, api }) => {
    await loginAs(page, api, accounts.owner);
    await openNew(page);
    await fillForm(page, { description: '部分内容' });
    await t(page, 'nav-home').click();
    await expect(t(page, 'm-leave')).toBeVisible();
    await expect(page).toHaveURL(/\/owner\/defects\/new$/);
  });

  test('TC-060 确认「离开」到首页；再进提交页为空白，无草稿', async ({ page, api }) => {
    await loginAs(page, api, accounts.owner);
    await openNew(page);
    await fillForm(page, { description: '部分内容' });
    await t(page, 'nav-home').click();
    await t(page, 'm-leave-confirm').click();
    await expect(page).toHaveURL(/\/owner\/home$/);
    await t(page, 'nav-new').click();
    await expect(t(page, 'description')).toHaveValue('');
    await expect(t(page, 'location')).toHaveValue('');
    await expect(t(page, 'category')).toHaveValue('');
  });

  test('TC-061 点「继续填写」：关闭确认框，输入与图片保留', async ({ page, api }) => {
    await loginAs(page, api, accounts.owner);
    await openNew(page);
    await fillForm(page, { description: '部分内容' });
    await addImages(page, [png()]);
    await doneCount(page, 1);
    await t(page, 'nav-home').click();
    await t(page, 'm-leave-cancel').click();
    await expect(t(page, 'm-leave')).toHaveCount(0);
    await expect(t(page, 'description')).toHaveValue('部分内容');
    await doneCount(page, 1);
  });

  test('TC-062 未做任何输入点侧栏「首页」：不弹确认，直接离开', async ({ page, api }) => {
    await loginAs(page, api, accounts.owner);
    await openNew(page);
    await t(page, 'nav-home').click();
    await expect(page).toHaveURL(/\/owner\/home$/);
    await expect(t(page, 'm-leave')).toHaveCount(0);
  });

  test('TC-064 一张成功一张上传失败：不阻止提交，详情只有 1 张图片；图片区常驻提示', async ({ page, api }) => {
    await loginAs(page, api, accounts.owner);
    let calls = 0;
    await page.route('**/defect-images', (route) => {
      if (route.request().method() === 'POST' && ++calls === 2) return route.fulfill({ status: 500, body: 'err' });
      return route.continue();
    });
    await openNew(page);
    await fillForm(page);
    await addImages(page, [png('a.png')]);
    await doneCount(page, 1);
    await addImages(page, [png('b.png')]);
    await expect(t(page, 'thumb-1')).toHaveAttribute('data-status', 'failed');
    await expect(page.getByText('上传失败的图片不会随缺陷提交')).toBeVisible();
    await submitAndConfirm(page);
    await expectOnDetail(page);
    await expect(t(page, 'd-image')).toHaveCount(1);
  });

  test('TC-067 描述含换行、emoji、script、&amp;：原样展示，不执行脚本，刷新后一致', async ({ page, api }) => {
    await loginAs(page, api, accounts.owner);
    const dialogs: string[] = [];
    page.on('dialog', (d) => {
      dialogs.push(d.message());
      void d.dismiss();
    });
    const text = '第一行 😀\n第二行 <script>alert(1)</script>\n&amp; <b>x</b>';
    await openNew(page);
    await fillForm(page, { ...validDefect, description: text });
    await submitAndConfirm(page);
    await expectOnDetail(page);
    const innerText = () => t(page, 'd-desc').evaluate((e) => (e as HTMLElement).innerText);
    expect(await innerText()).toBe(text);
    await page.reload();
    await expect(t(page, 'd-desc')).toBeVisible();
    expect(await innerText()).toBe(text);
    await expect(t(page, 'd-desc').locator('script, b')).toHaveCount(0);
    expect(dialogs).toEqual([]);
  });

  test('TC-068 超长无空格描述换行展示，不撑破布局', async ({ page, api }) => {
    await loginAs(page, api, accounts.owner);
    await openNew(page);
    await fillForm(page, { ...validDefect, description: 'a'.repeat(500) });
    await submitAndConfirm(page);
    await expectOnDetail(page);
    await expect(t(page, 'd-desc')).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
    expect(overflow).toBe(false);
    expect(await t(page, 'd-desc').evaluate((e) => (e as HTMLElement).scrollWidth <= (e as HTMLElement).clientWidth)).toBe(true);
  });

  test('TC-073 1280px 宽度下提交页、详情页无横向滚动条', async ({ page, api }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    const token = await loginAs(page, api, accounts.owner);
    const d = await createDefect(api, token);
    const noHScroll = () => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
    await openNew(page);
    expect(await noHScroll()).toBe(true);
    await page.goto(`/owner/defects/${d.defectId}`);
    await expect(t(page, 'defect-detail')).toBeVisible();
    expect(await noHScroll()).toBe(true);
  });

  test('TC-075 提交时间、最近修改时间格式 DD/MM/YYYY HH:mm，新加坡时间', async ({ page, api }) => {
    const token = await loginAs(page, api, accounts.owner);
    const d = await createDefect(api, token);
    const sg = (iso: string) => {
      const p = Object.fromEntries(
        new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Singapore', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
          .formatToParts(new Date(iso)).map((x) => [x.type, x.value]),
      );
      return `${p.day}/${p.month}/${p.year} ${p.hour}:${p.minute}`;
    };
    await page.goto(`/owner/defects/${d.defectId}`);
    await expect(t(page, 'd-submitted')).toHaveText(sg(d.submittedAt));
    await expect(t(page, 'd-modified')).toHaveText(sg(d.lastModifiedAt));
  });

  test.skip('TC-069 刷新或关闭标签页出现浏览器自带的离开提示', async () => {
    // QA 文档：不强制自动化，人工确认即可。
  });

  test.skip('TC-074 最新两个版本的 Chrome、Edge、Safari 行为一致', async () => {
    // QA 文档：多浏览器人工走查，不自动化。
  });
});

test.describe('REQ-002 DLP 截止日当天（owner-lastday，串行：会改单元 DLP）', () => {
  test.describe.configure({ mode: 'serial' });
  test.skip(!defectHelpersReady, defectHelpersSkipReason);

  test('TC-035 DLP 截止日当天仍可进入提交页并提交成功', async ({ page, api }) => {
    await setDlpEndDate(accounts.lastday.account, sgToday());
    await loginAs(page, api, accounts.lastday);
    await openNew(page);
    await fillForm(page);
    await submitAndConfirm(page);
    await expectOnDetail(page);
  });

  test('TC-034 填写期间 DLP 到期：提示结束，保留输入，不创建缺陷', async ({ page, api }) => {
    // QA 文档用 owner01；owner01 被其他并行用例共用，改其 DLP 会让它们失败，这里换成同样可提交的 owner-lastday。
    await setDlpEndDate(accounts.lastday.account, sgToday());
    await loginAs(page, api, accounts.lastday);
    try {
      await openNew(page);
      await fillForm(page);
      await setDlpEndDate(accounts.lastday.account, prevDay(sgToday()));
      await submitAndConfirm(page);
      await expect(t(page, 'banner-form')).toContainText('缺陷责任期已');
      await expect(t(page, 'banner-form')).toContainText('结束，不能再提交缺陷');
      await expect(t(page, 'description')).toHaveValue(validDefect.description);
      await expect(page).toHaveURL(/\/owner\/defects\/new$/); // 未跳转详情，缺陷未创建
    } finally {
      await setDlpEndDate(accounts.lastday.account, sgToday());
    }
  });
});

test.describe('REQ-002 缺陷详情、修改、撤回', () => {
  test('TC-038 待派单缺陷详情显示「修改」「撤回」', async ({ page, api }) => {
    const token = await loginAs(page, api, accounts.owner);
    const d = await createDefect(api, token);
    await page.goto(`/owner/defects/${d.defectId}`);
    await expect(t(page, 'btn-edit')).toBeVisible();
    await expect(t(page, 'btn-withdraw')).toBeVisible();
  });

  test('TC-039 修改位置与描述并保存：内容更新，编号与状态不变，最近修改时间更新', async ({ page, api }) => {
    const token = await loginAs(page, api, accounts.owner);
    const d = await createDefect(api, token);
    await page.goto(`/owner/defects/${d.defectId}`);
    await t(page, 'btn-edit').click();
    await expect(page).toHaveURL(/\/edit$/);
    await expect(t(page, 'form-title')).toHaveText('修改缺陷');
    await expect(t(page, 'description')).toHaveValue(validDefect.description); // 回填
    await fillForm(page, { location: 'BATHROOM', description: '改后的描述' });
    await t(page, 'btn-submit').click();
    await expect(page).toHaveURL(new RegExp(`/owner/defects/${d.defectId}$`));
    await expect(t(page, 'd-location')).toHaveText('卫生间');
    await expect(t(page, 'd-desc')).toHaveText('改后的描述');
    await expect(t(page, 'd-no')).toHaveText(d.defectNo);
    await expect(t(page, 'd-status')).toHaveText('待派单');
    expect(await lastModified(api, token, d.defectId)).not.toBe(d.lastModifiedAt);
  });

  test('TC-040 不改任何内容直接保存：成功，最近修改时间不变', async ({ page, api }) => {
    const token = await loginAs(page, api, accounts.owner);
    const d = await createDefect(api, token);
    await page.goto(`/owner/defects/${d.defectId}/edit`);
    await expect(t(page, 'description')).toHaveValue(validDefect.description);
    await t(page, 'btn-submit').click();
    await expect(page).toHaveURL(new RegExp(`/owner/defects/${d.defectId}$`));
    expect(await lastModified(api, token, d.defectId)).toBe(d.lastModifiedAt);
  });

  test('TC-041 修改页校验与提交一致：描述、位置、图片格式', async ({ page, api }) => {
    const token = await loginAs(page, api, accounts.owner);
    const d = await createDefect(api, token);
    const puts = track(page, 'PUT', /\/defects\/\d+$/);
    await page.goto(`/owner/defects/${d.defectId}/edit`);
    await expect(t(page, 'description')).toHaveValue(validDefect.description);
    await t(page, 'description').fill('');
    await t(page, 'location').selectOption('');
    await t(page, 'btn-submit').click();
    await expect(t(page, 'e-description')).toHaveText('请填写缺陷描述');
    await expect(t(page, 'e-location')).toHaveText('请选择缺陷位置');
    await addImages(page, [{ name: 'photo.gif', mimeType: 'image/gif', buffer: gifBuffer }]);
    await expect(t(page, 'e-images')).toHaveText('仅支持 jpg、png 格式');
    expect(puts).toHaveLength(0);
  });

  test('TC-043 撤回并确认：状态「已撤回」，不再显示「修改」「撤回」', async ({ page, api }) => {
    const token = await loginAs(page, api, accounts.owner);
    const d = await createDefect(api, token);
    await page.goto(`/owner/defects/${d.defectId}`);
    await t(page, 'btn-withdraw').click();
    await t(page, 'm-withdraw-confirm').click();
    await expect(t(page, 'd-status')).toHaveText('已撤回');
    await expect(t(page, 'btn-edit')).toHaveCount(0);
    await expect(t(page, 'btn-withdraw')).toHaveCount(0);
  });

  test('TC-044 撤回确认框点「再想想」：状态不变，无撤回请求', async ({ page, api }) => {
    const token = await loginAs(page, api, accounts.owner);
    const d = await createDefect(api, token);
    const reqs = track(page, 'POST', /\/withdraw$/);
    await page.goto(`/owner/defects/${d.defectId}`);
    await t(page, 'btn-withdraw').click();
    await t(page, 'm-withdraw-cancel').click();
    await expect(t(page, 'm-withdraw')).toHaveCount(0);
    await expect(t(page, 'd-status')).toHaveText('待派单');
    await expect(t(page, 'btn-withdraw')).toBeVisible();
    expect(reqs).toHaveLength(0);
  });

  test('TC-089 撤回确认框的标题、正文、按钮文案', async ({ page, api }) => {
    const token = await loginAs(page, api, accounts.owner);
    const d = await createDefect(api, token);
    await page.goto(`/owner/defects/${d.defectId}`);
    await t(page, 'btn-withdraw').click();
    const dlg = t(page, 'm-withdraw');
    await expect(dlg).toContainText('确认撤回缺陷');
    await expect(dlg).toContainText('撤回后缺陷不再进入 CSO 的待办，且不能恢复。需要再次报告，请提交新缺陷。');
    await expect(t(page, 'm-withdraw-cancel')).toHaveText('再想想');
    await expect(t(page, 'm-withdraw-confirm')).toHaveText('确认撤回');
  });

  test('TC-050 两个标签页：A 撤回后 B 再撤回，提示「缺陷已撤回」并刷新', async ({ page, api, context }) => {
    const token = await loginAs(page, api, accounts.owner);
    const d = await createDefect(api, token);
    const pageB = await context.newPage();
    await page.goto(`/owner/defects/${d.defectId}`);
    await pageB.goto(`/owner/defects/${d.defectId}`);
    await expect(t(pageB, 'btn-withdraw')).toBeVisible();
    await t(page, 'btn-withdraw').click();
    await t(page, 'm-withdraw-confirm').click();
    await expect(t(page, 'd-status')).toHaveText('已撤回');
    await t(pageB, 'btn-withdraw').click();
    await t(pageB, 'm-withdraw-confirm').click();
    await expect(t(pageB, 'banner-defect')).toHaveText('缺陷已撤回');
    await expect(t(pageB, 'd-status')).toHaveText('已撤回');
    await expect(t(pageB, 'btn-withdraw')).toHaveCount(0);
  });

  test('TC-054 访问他人缺陷详情：提示「缺陷不存在」', async ({ page, api }) => {
    const t2 = await tokenOf(api, accounts.owner02);
    const other = await createDefect(api, t2);
    await loginAs(page, api, accounts.owner);
    await page.goto(`/owner/defects/${other.defectId}`);
    await expect(t(page, 'defect-not-found')).toContainText('缺陷不存在');
  });

  test('TC-055 访问不存在的缺陷：提示与 TC-054 完全相同', async ({ page, api }) => {
    const t2 = await tokenOf(api, accounts.owner02);
    const other = await createDefect(api, t2);
    await loginAs(page, api, accounts.owner);
    await page.goto(`/owner/defects/${other.defectId}`);
    const foreign = (await t(page, 'defect-not-found').innerText()).trim();
    await page.goto('/owner/defects/999999999');
    await expect(t(page, 'defect-not-found')).toContainText('缺陷不存在');
    expect((await t(page, 'defect-not-found').innerText()).trim()).toBe(foreign);
  });

  test('TC-063 已撤回的缺陷仍可查看全部内容', async ({ page, api }) => {
    const token = await loginAs(page, api, accounts.owner);
    const d = await createDefect(api, token);
    await withdrawDefect(api, token, d.defectId);
    await page.goto(`/owner/defects/${d.defectId}`);
    await expect(t(page, 'd-status')).toHaveText('已撤回');
    await expect(t(page, 'd-desc')).toHaveText(validDefect.description);
    await expect(t(page, 'd-no')).toHaveText(d.defectNo);
    await expect(t(page, 'btn-edit')).toHaveCount(0);
    await expect(t(page, 'btn-withdraw')).toHaveCount(0);
  });

  test('TC-065 修改页新增一张上传失败的图片：保存不被阻止，详情不含失败图片', async ({ page, api }) => {
    const token = await loginAs(page, api, accounts.owner);
    const img = await uploadPng(api, token);
    const d = await createDefect(api, token, { imageIds: [img.imageId] });
    await page.route('**/defect-images', (route) =>
      route.request().method() === 'POST' ? route.fulfill({ status: 500, body: 'err' }) : route.continue(),
    );
    await page.goto(`/owner/defects/${d.defectId}/edit`);
    await expect(t(page, 'thumb-0')).toBeVisible();
    await addImages(page, [png('bad.png')]);
    await expect(t(page, 'thumb-1')).toHaveAttribute('data-status', 'failed');
    await t(page, 'btn-submit').click();
    await expect(page).toHaveURL(new RegExp(`/owner/defects/${d.defectId}$`));
    await expect(t(page, 'd-image')).toHaveCount(1);
  });

  test('TC-086 修改页：未改动离开不弹确认；有改动离开弹确认', async ({ page, api }) => {
    const token = await loginAs(page, api, accounts.owner);
    const d = await createDefect(api, token);
    await page.goto(`/owner/defects/${d.defectId}/edit`);
    await expect(t(page, 'description')).toHaveValue(validDefect.description);
    await t(page, 'nav-home').click();
    await expect(page).toHaveURL(/\/owner\/home$/);
    await expect(t(page, 'm-leave')).toHaveCount(0);
    await page.goto(`/owner/defects/${d.defectId}/edit`);
    await expect(t(page, 'description')).toHaveValue(validDefect.description);
    await t(page, 'description').fill('改动');
    await t(page, 'nav-home').click();
    await expect(t(page, 'm-leave')).toBeVisible();
  });
});

test.describe('REQ-002 依赖状态脚本（直连联调库）', () => {
  test.skip(!defectHelpersReady, defectHelpersSkipReason);

  test('TC-045 已派单：状态「已派单」，不显示「修改」「撤回」', async ({ page, api }) => {
    const token = await loginAs(page, api, accounts.owner);
    const d = await createDefect(api, token);
    await setDefectStatus(d.defectId, 'DISPATCHED');
    await page.goto(`/owner/defects/${d.defectId}`);
    await expect(t(page, 'd-status')).toHaveText('已派单');
    await expect(t(page, 'btn-edit')).toHaveCount(0);
    await expect(t(page, 'btn-withdraw')).toHaveCount(0);
    expect(((await (await getDefect(api, token, d.defectId)).json()) as Defect).editable).toBe(false);
  });

  test('TC-047 详情停在待派单时被派单：撤回提示「缺陷已派单」并刷新', async ({ page, api }) => {
    const token = await loginAs(page, api, accounts.owner);
    const d = await createDefect(api, token);
    await page.goto(`/owner/defects/${d.defectId}`);
    await expect(t(page, 'btn-withdraw')).toBeVisible();
    await setDefectStatus(d.defectId, 'DISPATCHED');
    await t(page, 'btn-withdraw').click();
    await t(page, 'm-withdraw-confirm').click();
    await expect(t(page, 'banner-defect')).toHaveText(MSG_LOCKED);
    await expect(t(page, 'd-status')).toHaveText('已派单');
    await expect(t(page, 'btn-withdraw')).toHaveCount(0);
    await expect(t(page, 'btn-edit')).toHaveCount(0);
  });

  test('TC-048 修改页被派单后保存：提示「缺陷已派单」，修改内容不保存', async ({ page, api }) => {
    const token = await loginAs(page, api, accounts.owner);
    const d = await createDefect(api, token);
    await page.goto(`/owner/defects/${d.defectId}/edit`);
    await expect(t(page, 'description')).toHaveValue(validDefect.description);
    await t(page, 'description').fill('不应被保存的改动');
    await setDefectStatus(d.defectId, 'DISPATCHED');
    await t(page, 'btn-submit').click();
    await expect(page).toHaveURL(new RegExp(`/owner/defects/${d.defectId}$`));
    await expect(t(page, 'banner-defect')).toHaveText(MSG_LOCKED);
    await expect(t(page, 'd-status')).toHaveText('已派单');
    await expect(t(page, 'd-desc')).toHaveText(validDefect.description);
  });

  test('TC-087 无法识别的后续状态：标签「处理中」，只能查看', async ({ page, api }) => {
    const token = await loginAs(page, api, accounts.owner);
    const d = await createDefect(api, token);
    await setDefectStatus(d.defectId, 'FUTURE_STATUS');
    await page.goto(`/owner/defects/${d.defectId}`);
    await expect(t(page, 'd-status')).toHaveText('处理中');
    await expect(t(page, 'd-lock-note')).toContainText('缺陷已进入处理流程，只能查看');
    await expect(t(page, 'btn-edit')).toHaveCount(0);
    await expect(t(page, 'btn-withdraw')).toHaveCount(0);
  });
});

test.describe('REQ-002 DLP 已到期的屋主（owner-expired，串行：共用一条种子缺陷）', () => {
  test.describe.configure({ mode: 'serial' });
  test.skip(!defectHelpersReady, defectHelpersSkipReason);
  let id: string;
  test.beforeAll(async () => {
    id = (await findSeedDefectId(accounts.expired.account))!;
    expect(id, 'dev 种子应为 owner-expired 预置一条缺陷').toBeTruthy();
    await setDefectStatus(id, 'PENDING_DISPATCH'); // 先恢复，防止上次运行遗留已撤回
  });

  test('TC-051 DLP 到期仍可查看自己的待派单缺陷，并显示「修改」「撤回」', async ({ page, api }) => {
    await loginAs(page, api, accounts.expired);
    await page.goto(`/owner/defects/${id}`);
    await expect(t(page, 'd-status')).toHaveText('待派单');
    await expect(t(page, 'btn-edit')).toBeVisible();
    await expect(t(page, 'btn-withdraw')).toBeVisible();
  });

  test('TC-052 DLP 到期仍可修改并保存', async ({ page, api }) => {
    await loginAs(page, api, accounts.expired);
    await page.goto(`/owner/defects/${id}/edit`);
    const text = `到期后修改 ${Date.now()}`;
    await expect(t(page, 'btn-submit')).toBeVisible();
    await t(page, 'description').fill(text);
    await t(page, 'btn-submit').click();
    await expect(page).toHaveURL(new RegExp(`/owner/defects/${id}$`));
    await expect(t(page, 'd-desc')).toHaveText(text);
  });

  test('TC-053 DLP 到期仍可撤回', async ({ page, api }) => {
    try {
      await loginAs(page, api, accounts.expired);
      await page.goto(`/owner/defects/${id}`);
      await t(page, 'btn-withdraw').click();
      await t(page, 'm-withdraw-confirm').click();
      await expect(t(page, 'd-status')).toHaveText('已撤回');
    } finally {
      await setDefectStatus(id, 'PENDING_DISPATCH'); // 种子缺陷只有一条，测完恢复供下次运行
    }
  });
});

test.describe('REQ-002 登录态失效（owner-revoke，会停用账号）', () => {
  test.skip(!dbConfigured, '未配置 DB_HOST：无法直连联调库停用账号');

  test('TC-066 提交时账号被停用：回到登录页，已填内容不保留，不创建缺陷', async ({ page, api }) => {
    // QA 文档用 owner01；停用 owner01 会让并行用例失败，这里换成专供停用的 owner-revoke。
    await loginAs(page, api, accounts.revoke);
    try {
      await openNew(page);
      await fillForm(page);
      await setAccountStatus(accounts.revoke.account, 'DISABLED');
      await submitAndConfirm(page);
      await expect(page).toHaveURL(/\/login$/);
      await expect(t(page, 'login')).toBeVisible();
      expect(await page.evaluate(() => localStorage.getItem('token'))).toBeNull();
    } finally {
      await setAccountStatus(accounts.revoke.account, 'ENABLED');
    }
  });
});
