import { APIRequestContext, Page } from '@playwright/test';
import { test, expect, t, loginAs, trackList, routeList } from '../support/e2e';
import { accounts, createDefect, getDefect, validDefect, tokenOf, Defect } from '../support/defect';
import {
  CATEGORY_LABEL, expectedSummary, isSortedNewestFirst, listAll, ListItem, LOCATION_LABEL, pageOf, rawDescription, sgDateTime,
  statusLabel,
} from '../support/list';
import {
  dbConfigured, defectHelpersReady, defectHelpersSkipReason, resetPageRwStatuses, setAccountStatus, setDefectStatus,
} from '../support/db';

// 来源：QA-defect-003-user（CICD-DEMO-CONTEXT，feat/req-003-defect-list）。预期只取自文档；
// 定位方式取自前端 CICD-DEMO-WEB 的 data-testid；列表在 /owner/home，筛选与页码在路由 query（status、page）。
const HEADERS = ['缺陷编号', '位置', '类别', '描述摘要', '状态', '提交时间'];
const rows = (page: Page) => t(page, 'defect-row');
const rowOf = (page: Page, no: string) => page.locator(`[data-testid=defect-row][data-defect-no="${no}"]`);
const pagerTotal = (n: number) => `共 ${n} 条`;
const pagerPage = (x: number, y: number) => `第 ${x} / ${y} 页`;
const openHome = async (page: Page, query = '') => {
  await page.goto(`/owner/home${query}`);
  await expect(t(page, 'list-loading')).toHaveCount(0);
};
const pick = (label: string) => ({ label });

async function seed(api: APIRequestContext, account = accounts.list) {
  const token = await tokenOf(api, account);
  const all = await listAll(api, token);
  const raws = await Promise.all(all.map((i) => rawDescription(api, token, i.defectId)));
  return { token, all, raws, find: (fn: (raw: string) => boolean): ListItem => all[raws.findIndex(fn)] };
}

/** 通过 REQ-002 提交页提交一条新缺陷，返回缺陷编号 */
async function submitViaUi(page: Page, description: string) {
  await t(page, 'nav-new').click();
  await t(page, 'location').selectOption(validDefect.location);
  await t(page, 'category').selectOption(validDefect.category);
  await t(page, 'description').fill(description);
  await t(page, 'btn-submit').click();
  await t(page, 'm-submit-confirm').click();
  await expect(page).toHaveURL(/\/owner\/defects\/\d+$/);
  return (await t(page, 'd-no').innerText()).trim();
}

test.describe('REQ-003 屋主缺陷列表（只读账号）', () => {
  test('TC-001 首页显示「我的缺陷」列表，表头六列', async ({ page, api }) => {
    await loginAs(page, api, accounts.list);
    await openHome(page);
    await expect(page.getByRole('heading', { name: '我的缺陷' })).toBeVisible();
    await expect(page.locator('[data-testid=defect-table] th')).toHaveText(HEADERS);
  });

  test('TC-002 一行内：编号、中文位置/类别、状态标签、时间格式', async ({ page, api }) => {
    const { token, all } = await seed(api);
    await loginAs(page, api, accounts.list);
    await openHome(page);
    const item = all[0];
    const d = (await (await getDefect(api, token, item.defectId)).json()) as Defect;
    const row = rowOf(page, item.defectNo);
    await expect(row.getByTestId('cell-no')).toHaveText(/^DF-\d{6}$/);
    await expect(row.getByTestId('cell-location')).toHaveText(LOCATION_LABEL[d.location]);
    await expect(row.getByTestId('cell-category')).toHaveText(CATEGORY_LABEL[d.category]);
    await expect(row.getByTestId('cell-status')).toHaveText(statusLabel(item.status));
    await expect(row.getByTestId('cell-time')).toHaveText(sgDateTime(item.submittedAt));
    await expect(row).not.toContainText(/PENDING_DISPATCH|KITCHEN|WALL_CEILING|FUTURE_STATUS/);
  });

  test('TC-003 默认「全部」、第 1 页 20 行、倒序、分页区「共 25 条」「第 1 / 2 页」', async ({ page, api }) => {
    const { all } = await seed(api);
    await loginAs(page, api, accounts.list);
    await openHome(page);
    await expect(t(page, 'filter')).toHaveValue('');
    await expect(t(page, 'filter').locator('option:checked')).toHaveText('全部');
    await expect(rows(page)).toHaveCount(20);
    await expect(rows(page).evaluateAll((els) => els.map((e) => e.getAttribute('data-defect-no')))).resolves.toEqual(
      all.slice(0, 20).map((i) => i.defectNo),
    );
    expect(isSortedNewestFirst(all)).toBe(true);
    await expect(t(page, 'pager-total')).toHaveText(pagerTotal(25));
    await expect(t(page, 'pager-page')).toHaveText(pagerPage(1, 2));
    await expect(t(page, 'pg-prev')).toHaveText('上一页');
    await expect(t(page, 'pg-next')).toHaveText('下一页');
  });

  test('TC-004 提交时间相同的两条相邻，编号大的在前', async ({ page, api }) => {
    const { all } = await seed(api);
    const idx = all.findIndex((x, i) => i > 0 && x.submittedAt === all[i - 1].submittedAt);
    expect(idx, '种子应有两条提交时间相同的缺陷').toBeGreaterThan(0);
    expect(all[idx - 1].defectNo > all[idx].defectNo).toBe(true);
    await loginAs(page, api, accounts.list);
    await openHome(page, pageOf(all, all[idx]) > 1 ? '?page=2' : '');
    const nos = await rows(page).evaluateAll((els) => els.map((e) => e.getAttribute('data-defect-no')));
    expect(nos.indexOf(all[idx - 1].defectNo) + 1).toBe(nos.indexOf(all[idx].defectNo));
  });

  test('TC-006 翻到第 2 页再翻回：5 行、「共 25 条」「第 2 / 2 页」，上一页/下一页的可点状态', async ({ page, api }) => {
    await loginAs(page, api, accounts.list);
    await openHome(page);
    const first = await rows(page).evaluateAll((els) => els.map((e) => e.getAttribute('data-defect-no')));
    await expect(t(page, 'pg-prev')).toBeDisabled();
    await t(page, 'pg-next').click();
    await expect(t(page, 'pager-page')).toHaveText(pagerPage(2, 2));
    await expect(rows(page)).toHaveCount(5);
    await expect(t(page, 'pager-total')).toHaveText(pagerTotal(25));
    await expect(t(page, 'pg-next')).toBeDisabled();
    await expect(t(page, 'pg-prev')).toBeEnabled();
    await t(page, 'pg-prev').click();
    await expect(t(page, 'pager-page')).toHaveText(pagerPage(1, 2));
    await expect(rows(page).evaluateAll((els) => els.map((e) => e.getAttribute('data-defect-no')))).resolves.toEqual(first);
  });

  test('TC-007 owner-bulk 筛选「待派单」翻到第 2 页：筛选保持，只含待派单，总数 21', async ({ page, api }) => {
    await loginAs(page, api, accounts.bulk);
    await openHome(page);
    await t(page, 'filter').selectOption(pick('待派单'));
    await expect(t(page, 'pager-total')).toHaveText(pagerTotal(21));
    await t(page, 'pg-next').click();
    await expect(t(page, 'pager-page')).toHaveText(pagerPage(2, 2));
    await expect(t(page, 'filter').locator('option:checked')).toHaveText('待派单');
    await expect(rows(page)).toHaveCount(1);
    await expect(t(page, 'cell-status')).toHaveText('待派单');
    await expect(t(page, 'pager-total')).toHaveText(pagerTotal(21));
  });

  test('TC-009 owner-list 与 owner02 的列表互不包含对方的缺陷', async ({ page, api }) => {
    const mine = await seed(api);
    const other = await seed(api, accounts.owner02);
    await loginAs(page, api, accounts.list);
    await openHome(page);
    await expect(t(page, 'pager-total')).toHaveText(pagerTotal(25));
    await loginAs(page, api, accounts.owner02);
    const p2 = await page.context().newPage();
    await loginAs(p2, api, accounts.owner02);
    await openHome(p2);
    const nos = await rows(p2).evaluateAll((els) => els.map((e) => e.getAttribute('data-defect-no')!));
    const mineNos = new Set(mine.all.map((i) => i.defectNo));
    expect(nos.length).toBeGreaterThan(0);
    expect(nos.filter((n) => mineNos.has(n))).toEqual([]);
    expect(nos.every((n) => other.all.some((i) => i.defectNo === n))).toBe(true);
  });

  test('TC-011 「全部」包含已撤回，标签「已撤回」', async ({ page, api }) => {
    const { all } = await seed(api);
    const wd = all.find((i) => i.status === 'WITHDRAWN')!;
    await loginAs(page, api, accounts.list);
    await openHome(page, pageOf(all, wd) > 1 ? '?page=2' : '');
    await expect(rowOf(page, wd.defectNo).getByTestId('cell-status')).toHaveText('已撤回');
    await expect(t(page, 'pager-total')).toHaveText(pagerTotal(25));
  });

  test('TC-012 DLP 已到期的 owner-expired：列表含待派单与已撤回，无错误', async ({ page, api }) => {
    await loginAs(page, api, accounts.expired);
    await openHome(page);
    await expect(t(page, 'list-error')).toHaveCount(0);
    await expect(t(page, 'cell-status').filter({ hasText: '待派单' }).first()).toBeVisible();
    await expect(t(page, 'cell-status').filter({ hasText: '已撤回' }).first()).toBeVisible();
  });

  test('TC-013 单元绑定已解除的 owner-unbound：仍显示其 2 条缺陷', async ({ page, api }) => {
    await loginAs(page, api, accounts.unbound);
    await openHome(page);
    await expect(t(page, 'list-error')).toHaveCount(0);
    await expect(rows(page)).toHaveCount(2);
    await expect(t(page, 'pager-total')).toHaveText(pagerTotal(2));
  });

  test('TC-014 点击已撤回的缺陷：详情为「已撤回」，无「修改」「撤回」', async ({ page, api }) => {
    const { all } = await seed(api);
    const wd = all.find((i) => i.status === 'WITHDRAWN')!;
    await loginAs(page, api, accounts.list);
    await openHome(page, pageOf(all, wd) > 1 ? '?page=2' : '');
    await rowOf(page, wd.defectNo).click();
    await expect(t(page, 'd-status')).toHaveText('已撤回');
    await expect(t(page, 'd-no')).toHaveText(wd.defectNo);
    await expect(t(page, 'btn-edit')).toHaveCount(0);
    await expect(t(page, 'btn-withdraw')).toHaveCount(0);
  });

  const filterCases: [string, string, string, string][] = [
    ['TC-015', '待派单', 'PENDING_DISPATCH', '待派单'],
    ['TC-016', '已派单', 'DISPATCHED', '已派单'],
    ['TC-017', '已撤回', 'WITHDRAWN', '已撤回'],
    ['TC-018', '处理中', 'IN_PROGRESS', '处理中'],
  ];
  for (const [tc, label, filter, tag] of filterCases) {
    test(`${tc} 筛选「${label}」：只显示对应状态，数量与总数一致`, async ({ page, api }) => {
      const token = await tokenOf(api, accounts.list);
      const expected = await listAll(api, token, filter);
      await loginAs(page, api, accounts.list);
      await openHome(page);
      await t(page, 'filter').selectOption(pick(label));
      await expect(t(page, 'pager-total')).toHaveText(pagerTotal(expected.length));
      await expect(rows(page)).toHaveCount(Math.min(expected.length, 20));
      const tags = await t(page, 'cell-status').allInnerTexts();
      expect(new Set(tags.map((x) => x.trim()))).toEqual(new Set([tag]));
    });
  }

  test('TC-019 「全部」中后续状态的标签是「处理中」，不显示枚举值原文', async ({ page, api }) => {
    const { all } = await seed(api);
    const ip = all.find((i) => !['PENDING_DISPATCH', 'DISPATCHED', 'WITHDRAWN'].includes(i.status))!;
    await loginAs(page, api, accounts.list);
    await openHome(page, pageOf(all, ip) > 1 ? '?page=2' : '');
    await expect(rowOf(page, ip.defectNo).getByTestId('cell-status')).toHaveText('处理中');
    await expect(t(page, 'defect-table')).not.toContainText(ip.status);
  });

  test('TC-020 「全部」第 2 页切换筛选为「待派单」：回到第 1 页', async ({ page, api }) => {
    await loginAs(page, api, accounts.list);
    await openHome(page, '?page=2');
    await expect(t(page, 'pager-page')).toHaveText(pagerPage(2, 2));
    await t(page, 'filter').selectOption(pick('待派单'));
    await expect(t(page, 'pager-page')).toHaveText(/^第 1 \/ \d+ 页$/);
    await expect(page).not.toHaveURL(/page=/);
  });

  const summaryCases: [string, string, (r: string) => boolean][] = [
    ['TC-023', '描述超过 50 个字符：前 50 个加「…」', (r) => Array.from(r).length > 50 && /^[^\r\n\p{Extended_Pictographic}]*$/u.test(r)],
    ['TC-024', '恰好 50 个字符：完整显示，不加「…」', (r) => Array.from(r).length === 50 && /^[^\r\n\p{Extended_Pictographic}]*$/u.test(r)],
    ['TC-025', '少于 50 个字符：完整显示，不加「…」', (r) => Array.from(r).length < 20 && !/<script>/.test(r)],
    ['TC-026', '前 50 个码点内含换行：显示为空格，文本中无换行符', (r) => /^[^\r\n]{10}\n/.test(r) && Array.from(r).length > 50],
    ['TC-027', '第 50 个码点是 emoji：完整显示并加「…」', (r) => Array.from(r).length > 50 && /^字{49}🔧/u.test(r)],
    ['TC-028', '含 <script>：按文字显示，不执行脚本', (r) => /<script>alert\(1\)<\/script>/.test(r)],
  ];
  for (const [tc, title, match] of summaryCases) {
    test(`${tc} 摘要（页面）${title}`, async ({ page, api }) => {
      const s = await seed(api);
      const idx = s.raws.findIndex(match);
      expect(idx, '种子中应存在符合条件的缺陷').toBeGreaterThanOrEqual(0);
      const item = s.all[idx];
      const raw = s.raws[idx];
      const dialogs: string[] = [];
      page.on('dialog', (d) => {
        dialogs.push(d.message());
        void d.dismiss();
      });
      await loginAs(page, api, accounts.list);
      await openHome(page, pageOf(s.all, item) > 1 ? '?page=2' : '');
      const cell = rowOf(page, item.defectNo).getByTestId('cell-summary');
      await expect(cell).toHaveText(expectedSummary(raw), { useInnerText: true });
      expect(await cell.evaluate((e) => (e as HTMLElement).innerText)).not.toMatch(/[\r\n]/);
      if (['TC-024', 'TC-025'].includes(tc)) await expect(cell).not.toContainText('…');
      if (['TC-023', 'TC-027'].includes(tc)) await expect(cell).toContainText('…');
      if (tc === 'TC-028') {
        await expect(cell).toContainText('<script>alert(1)</script>');
        await expect(t(page, 'defect-table').locator('script')).toHaveCount(0);
      }
      expect(dialogs).toEqual([]);
    });
  }

  test('TC-030 点击一行进入该缺陷详情，编号一致', async ({ page, api }) => {
    const { all } = await seed(api);
    await loginAs(page, api, accounts.list);
    await openHome(page);
    await rowOf(page, all[3].defectNo).click();
    await expect(page).toHaveURL(new RegExp(`/owner/defects/${all[3].defectId}$`));
    await expect(t(page, 'd-no')).toHaveText(all[3].defectNo);
  });

  test('TC-031 详情点「返回」：列表重新加载，筛选与页码保持', async ({ page, api }) => {
    await loginAs(page, api, accounts.bulk);
    const lists = trackList(page);
    await openHome(page, '?status=PENDING_DISPATCH&page=2');
    await expect(t(page, 'pager-page')).toHaveText(pagerPage(2, 2));
    await rows(page).first().click();
    await expect(page).toHaveURL(/\/owner\/defects\/\d+$/);
    const before = lists.length;
    await t(page, 'btn-back-home').click();
    await expect(t(page, 'pager-page')).toHaveText(pagerPage(2, 2));
    expect(lists.length).toBeGreaterThan(before);
    const last = lists[lists.length - 1];
    expect(last.searchParams.get('statusFilter')).toBe('PENDING_DISPATCH');
    expect(last.searchParams.get('pageNo')).toBe('2');
    await expect(t(page, 'filter').locator('option:checked')).toHaveText('待派单');
  });

  test('TC-032 浏览器后退：回到列表，筛选与页码保持，列表重新加载', async ({ page, api }) => {
    await loginAs(page, api, accounts.bulk);
    const lists = trackList(page);
    await openHome(page, '?status=PENDING_DISPATCH&page=2');
    await rows(page).first().click();
    await expect(page).toHaveURL(/\/owner\/defects\/\d+$/);
    const before = lists.length;
    await page.goBack();
    await expect(t(page, 'pager-page')).toHaveText(pagerPage(2, 2));
    expect(lists.length).toBeGreaterThan(before);
    await expect(t(page, 'filter').locator('option:checked')).toHaveText('待派单');
  });

  test('TC-036 owner-empty：空状态与「提交缺陷」入口，无数据行', async ({ page, api }) => {
    await loginAs(page, api, accounts.empty);
    await openHome(page);
    await expect(t(page, 'list-empty')).toContainText('你还没有提交过缺陷');
    await expect(t(page, 'btn-empty-new')).toBeVisible();
    await expect(rows(page)).toHaveCount(0);
  });

  test('TC-037 空状态里点「提交缺陷」进入提交页', async ({ page, api }) => {
    await loginAs(page, api, accounts.empty);
    await openHome(page);
    await t(page, 'btn-empty-new').click();
    await expect(page).toHaveURL(/\/owner\/defects\/new$/);
  });

  test('TC-038 owner02 筛选「已撤回」无结果：显示「该状态下暂无缺陷」，筛选保持，切回全部有数据', async ({ page, api }) => {
    await loginAs(page, api, accounts.owner02);
    await openHome(page);
    await t(page, 'filter').selectOption(pick('已撤回'));
    await expect(t(page, 'list-empty-filtered')).toContainText('该状态下暂无缺陷');
    await expect(t(page, 'filter').locator('option:checked')).toHaveText('已撤回');
    await t(page, 'filter').selectOption(pick('全部'));
    await expect(rows(page).first()).toBeVisible();
    expect(await rows(page).count()).toBeGreaterThanOrEqual(3);
  });

  test('TC-039 列表接口 5xx：显示加载失败与「重试」，不显示空状态', async ({ page, api }) => {
    await loginAs(page, api, accounts.list);
    await routeList(page, (route) => route.fulfill({ status: 503, body: 'down' }));
    await page.goto('/owner/home');
    await expect(t(page, 'list-error-text')).toHaveText('加载失败，请稍后重试');
    await expect(t(page, 'btn-retry')).toBeVisible();
    await expect(t(page, 'list-empty')).toHaveCount(0);
    await expect(t(page, 'list-empty-filtered')).toHaveCount(0);
  });

  test('TC-040 列表接口延迟 12 秒：约 10 秒时显示加载失败', async ({ page, api }) => {
    test.setTimeout(60_000);
    await loginAs(page, api, accounts.list);
    let startedAt = 0;
    await routeList(page, async (route) => {
      startedAt ||= Date.now();
      await new Promise((r) => setTimeout(r, 12_000));
      await route.abort().catch(() => {});
    });
    await page.goto('/owner/home');
    await expect(t(page, 'list-error-text')).toHaveText('加载失败，请稍后重试', { timeout: 15_000 });
    const elapsed = Date.now() - startedAt;
    expect(elapsed).toBeGreaterThanOrEqual(9_000);
    expect(elapsed).toBeLessThanOrEqual(12_000);
  });

  test('TC-041 翻页失败后点「重试」：重发同一请求，筛选与页码保持', async ({ page, api }) => {
    await loginAs(page, api, accounts.bulk);
    await openHome(page, '?status=PENDING_DISPATCH');
    await expect(t(page, 'pager-page')).toHaveText(pagerPage(1, 2));
    const seen: URL[] = [];
    let fail = true;
    await routeList(page, (route) => {
      seen.push(new URL(route.request().url()));
      return fail ? route.fulfill({ status: 503, body: 'down' }) : route.continue();
    });
    await t(page, 'pg-next').click();
    await expect(t(page, 'list-error-text')).toHaveText('加载失败，请稍后重试');
    fail = false;
    await t(page, 'btn-retry').click();
    await expect(t(page, 'pager-page')).toHaveText(pagerPage(2, 2));
    expect(seen).toHaveLength(2);
    expect(seen[1].searchParams.get('statusFilter')).toBe(seen[0].searchParams.get('statusFilter'));
    expect(seen[1].searchParams.get('pageNo')).toBe(seen[0].searchParams.get('pageNo'));
    expect(seen[1].searchParams.get('pageNo')).toBe('2');
    await expect(t(page, 'filter').locator('option:checked')).toHaveText('待派单');
  });

  test('TC-049 登录后清除令牌再刷新首页：回到登录页', async ({ page, api }) => {
    await loginAs(page, api, accounts.list);
    await openHome(page);
    await page.evaluate(() => localStorage.removeItem('token'));
    await page.reload();
    await expect(page).toHaveURL(/\/login$/);
  });

  test('TC-054 列表请求的响应不含图片或图片地址，也没有图片请求', async ({ page, api }) => {
    await loginAs(page, api, accounts.list);
    const urls: string[] = [];
    const bodies: string[] = [];
    page.on('request', (r) => urls.push(r.url()));
    page.on('response', async (res) => {
      if (res.request().method() === 'GET' && new URL(res.url()).pathname.endsWith('/defects')) bodies.push(await res.text().catch(() => ''));
    });
    await openHome(page);
    await t(page, 'pg-next').click();
    await expect(t(page, 'pager-page')).toHaveText(pagerPage(2, 2));
    expect(bodies.length).toBeGreaterThanOrEqual(2);
    for (const b of bodies) expect(b).not.toMatch(/imageId|"url"|images/);
    expect(urls.filter((u) => /defect-images/.test(u))).toEqual([]);
  });

  test('TC-057 列表接口延迟 3 秒：请求期间显示加载状态，不显示空状态或旧数据', async ({ page, api }) => {
    await loginAs(page, api, accounts.list);
    await routeList(page, async (route) => {
      await new Promise((r) => setTimeout(r, 3000));
      await route.continue();
    });
    await page.goto('/owner/home');
    await expect(t(page, 'list-loading')).toBeVisible();
    await expect(t(page, 'list-empty')).toHaveCount(0);
    await expect(t(page, 'defect-table')).toHaveCount(0);
    await expect(rows(page).first()).toBeVisible({ timeout: 10_000 });
  });

  test('TC-058 访问他人缺陷的详情地址：提示「缺陷不存在」', async ({ page, api }) => {
    const other = await seed(api, accounts.owner02);
    await loginAs(page, api, accounts.list);
    await page.goto(`/owner/defects/${other.all[0].defectId}`);
    await expect(t(page, 'defect-not-found')).toContainText('缺陷不存在');
  });

  test('TC-059 库值为新加坡 09:30 的缺陷：页面显示 01/10/2026 09:30', async ({ page, api }) => {
    const { all } = await seed(api);
    const item = all.find((i) => i.submittedAt === '2026-10-01T09:30:00+08:00')!;
    expect(item).toBeTruthy();
    await loginAs(page, api, accounts.list);
    await openHome(page, pageOf(all, item) > 1 ? '?page=2' : '');
    await expect(rowOf(page, item.defectNo).getByTestId('cell-time')).toHaveText('01/10/2026 09:30');
  });

  test('TC-060 1280px 宽度：六列完整，无横向滚动条', async ({ page, api }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await loginAs(page, api, accounts.list);
    await openHome(page);
    await expect(page.locator('[data-testid=defect-table] th')).toHaveCount(6);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  });

  test('TC-063 带 pageNo=99 的地址：自动回到最后一页（第 2 页），路由页码同步', async ({ page, api }) => {
    await loginAs(page, api, accounts.list);
    await page.goto('/owner/home?page=99');
    await expect(t(page, 'pager-page')).toHaveText(pagerPage(2, 2));
    await expect(rows(page)).toHaveCount(5);
    await expect(t(page, 'pager-total')).toHaveText(pagerTotal(25));
    await expect(page).toHaveURL(/page=2/);
    await expect(t(page, 'list-empty')).toHaveCount(0);
  });

  test('TC-064 owner-empty 带 pageNo=3：显示空状态，不回退、不循环请求', async ({ page, api }) => {
    await loginAs(page, api, accounts.empty);
    const lists = trackList(page);
    await page.goto('/owner/home?page=3');
    await expect(t(page, 'list-empty')).toContainText('你还没有提交过缺陷');
    await page.waitForTimeout(1500);
    expect(lists).toHaveLength(1);
  });

  test.skip('TC-061 最新两个版本的 Chrome、Edge、Safari 行为一致', async () => {
    // QA 文档：多浏览器人工走查，不自动化。
  });
});

test.describe('REQ-003 列表写操作（owner-list-rw，串行，只做相对断言）', () => {
  test.describe.configure({ mode: 'serial' });

  test('TC-034 提交一条新缺陷后回首页：出现在「全部」第 1 行，状态待派单，总数 +1', async ({ page, api }) => {
    await loginAs(page, api, accounts.listRw);
    await openHome(page);
    const n = Number((await t(page, 'pager-total').innerText()).match(/\d+/)![0]);
    const no = await submitViaUi(page, `TC-034 ${Date.now()}`);
    await t(page, 'btn-back-home').click();
    await expect(rows(page).first()).toHaveAttribute('data-defect-no', no);
    await expect(rows(page).first().getByTestId('cell-status')).toHaveText('待派单');
    await expect(t(page, 'pager-total')).toHaveText(pagerTotal(n + 1));
  });

  test('TC-035 回首页筛选「待派单」：新缺陷在第 1 行，该筛选总数 +1', async ({ page, api }) => {
    await loginAs(page, api, accounts.listRw);
    await openHome(page, '?status=PENDING_DISPATCH');
    const m = Number((await t(page, 'pager-total').innerText()).match(/\d+/)![0]);
    const no = await submitViaUi(page, `TC-035 ${Date.now()}`);
    await t(page, 'btn-back-home').click();
    await t(page, 'filter').selectOption(pick('待派单'));
    await expect(rows(page).first()).toHaveAttribute('data-defect-no', no);
    await expect(t(page, 'pager-total')).toHaveText(pagerTotal(m + 1));
  });

  test('TC-052 修改待派单缺陷的描述后回列表：位置不变，摘要更新', async ({ page, api }) => {
    await loginAs(page, api, accounts.listRw);
    await openHome(page);
    const nos = await rows(page).evaluateAll((els) => els.map((e) => e.getAttribute('data-defect-no')!));
    const statuses = await t(page, 'cell-status').allInnerTexts();
    const n = statuses.findIndex((s) => s.trim() === '待派单');
    expect(n).toBeGreaterThanOrEqual(0);
    await rows(page).nth(n).click();
    await t(page, 'btn-edit').click();
    const text = `TC-052 修改后 ${Date.now()}`;
    await t(page, 'description').fill(text);
    await t(page, 'btn-submit').click();
    await expect(t(page, 'd-desc')).toHaveText(text);
    await page.goto('/owner/home');
    await expect(rows(page).nth(n)).toHaveAttribute('data-defect-no', nos[n]);
    await expect(rows(page).nth(n).getByTestId('cell-summary')).toHaveText(text);
  });

  test('TC-033 列表显示「待派单」，被脚本改为「已派单」后：详情以最新为准，返回后列表更新', async ({ page, api }) => {
    test.skip(!defectHelpersReady, defectHelpersSkipReason);
    await loginAs(page, api, accounts.listRw);
    await openHome(page, '?status=PENDING_DISPATCH');
    const row = rows(page).first();
    const no = (await row.getAttribute('data-defect-no'))!;
    const link = await row.getByTestId('cell-no').locator('a').getAttribute('href');
    const id = link!.split('/').pop()!;
    try {
      await setDefectStatus(id, 'DISPATCHED');
      await row.click();
      await expect(t(page, 'd-status')).toHaveText('已派单');
      await t(page, 'btn-back-home').click();
      await expect(page).toHaveURL(/status=PENDING_DISPATCH/);
      await expect(rowOf(page, no)).toHaveCount(0); // 重新加载后，该条已不在「待派单」筛选里
      await t(page, 'filter').selectOption(pick('已派单'));
      await expect(rowOf(page, no).getByTestId('cell-status')).toHaveText('已派单');
    } finally {
      await setDefectStatus(id, 'PENDING_DISPATCH');
    }
  });

  test('TC-055 另一处提交新缺陷：当前列表不自动变化，刷新后才出现', async ({ page, api }) => {
    const token = await loginAs(page, api, accounts.listRw);
    await openHome(page);
    const n = Number((await t(page, 'pager-total').innerText()).match(/\d+/)![0]);
    const d = await createDefect(api, token);
    await page.waitForTimeout(2500);
    await expect(t(page, 'pager-total')).toHaveText(pagerTotal(n));
    await expect(rowOf(page, d.defectNo)).toHaveCount(0);
    await page.reload();
    await expect(t(page, 'pager-total')).toHaveText(pagerTotal(n + 1));
    await expect(rows(page).first()).toHaveAttribute('data-defect-no', d.defectNo);
  });
});

test.describe('REQ-003 登录态失效（owner-list-revoke，会停用账号）', () => {
  test.skip(!dbConfigured, '未配置 DB_HOST：无法直连联调库停用账号');

  test('TC-056 账号被停用后切换筛选：按未登录处理，回到登录页', async ({ page, api }) => {
    await loginAs(page, api, accounts.listRevoke);
    await openHome(page);
    try {
      await setAccountStatus(accounts.listRevoke.account, 'DISABLED');
      await t(page, 'filter').selectOption(pick('待派单'));
      await expect(page).toHaveURL(/\/login$/);
    } finally {
      await setAccountStatus(accounts.listRevoke.account, 'ENABLED');
    }
  });
});

test.describe('REQ-003 页码失效回退（owner-page-rw，仅 TC-062）', () => {
  test.skip(!defectHelpersReady, defectHelpersSkipReason);
  test.beforeAll(async () => {
    await resetPageRwStatuses(); // 上次异常中断时，把被撤回/改状态的缺陷恢复为初始的待派单
  });

  test('TC-062 第 2 页唯一一条被撤回后返回：自动回到第 1 页，不出现空表', async ({ page, api }) => {
    await loginAs(page, api, accounts.pageRw);
    const lists = trackList(page);
    await openHome(page, '?status=PENDING_DISPATCH&page=2');
    await expect(t(page, 'pager-page')).toHaveText(pagerPage(2, 2));
    await expect(rows(page)).toHaveCount(1);
    const href = await rows(page).first().getByTestId('cell-no').locator('a').getAttribute('href');
    const id = href!.split('/').pop()!;
    try {
      await rows(page).first().click();
      await t(page, 'btn-withdraw').click();
      await t(page, 'm-withdraw-confirm').click();
      await expect(t(page, 'd-status')).toHaveText('已撤回');
      const before = lists.length;
      await t(page, 'btn-back-home').click();
      await expect(t(page, 'pager-page')).toHaveText(pagerPage(1, 1));
      await expect(t(page, 'pager-total')).toHaveText(pagerTotal(20));
      await expect(rows(page)).toHaveCount(20);
      await expect(t(page, 'filter').locator('option:checked')).toHaveText('待派单');
      await expect(t(page, 'list-empty')).toHaveCount(0);
      expect(page.url()).not.toMatch(/page=(?!1\b)\d+/);
      const after = lists.slice(before).map((u) => u.searchParams.get('pageNo'));
      expect(after.slice(0, 2)).toEqual(['2', '1']); // 先请求 pageNo=2（空数组、total=20），随后 pageNo=1
    } finally {
      await setDefectStatus(id, 'PENDING_DISPATCH');
    }
  });
});
