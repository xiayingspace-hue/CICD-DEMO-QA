import { test, expect } from '@playwright/test';
import { accounts, expectCode, tokenOf } from '../support/defect';
import {
  expectedSummary, isSortedNewestFirst, listAll, listDefects, listPage, ListItem, rawDescription, statusLabel,
} from '../support/list';

// 来源：QA-defect-003-user / API-defect-003-user（CICD-DEMO-CONTEXT，feat/req-003-defect-list）。预期只取自文档。
// 仅覆盖 QA 标明「接口层」的用例；页面行为见 tests/e2e/defect-003-user.spec.ts。
// owner-list 是只读账号（25 条）；owner02 的缺陷数会随 REQ-002 用例增加，对它只做相对断言。

const MSG_STATUS = '状态筛选条件不正确';
const MSG_PAGE = '页码不正确';
const MSG_SIZE = '每页条数不正确';

async function fieldErrorsOf(res: import('@playwright/test').APIResponse) {
  expect(res.status()).toBe(400);
  const body = await res.json();
  expect(body.code).toBe('DEFECT_VALIDATION_FAILED');
  return body.fieldErrors as { field: string; message: string }[];
}

test.describe('REQ-003 屋主缺陷列表接口', () => {
  test('TC-005 不带参数：pageNo=1、pageSize=20、total=25、20 条，按提交时间倒序', async ({ request }) => {
    const token = await tokenOf(request, accounts.list);
    const p = await listPage(request, token);
    expect(p).toMatchObject({ pageNo: 1, pageSize: 20, total: 25 });
    expect(p.items).toHaveLength(20);
    expect(isSortedNewestFirst(p.items)).toBe(true);
  });

  test('TC-008 pageSize=10 取 1、2、3 页：10、10、5 条，25 个不同编号，整体倒序', async ({ request }) => {
    const token = await tokenOf(request, accounts.list);
    const pages = [1, 2, 3].map((n) => listPage(request, token, `pageSize=10&pageNo=${n}`));
    const [p1, p2, p3] = await Promise.all(pages);
    expect([p1.items.length, p2.items.length, p3.items.length]).toEqual([10, 10, 5]);
    const all = [...p1.items, ...p2.items, ...p3.items];
    expect(new Set(all.map((i) => i.defectNo)).size).toBe(25);
    expect(isSortedNewestFirst(all)).toBe(true);
  });

  test('TC-009 owner-list 与 owner02 各自只见自己的缺陷，编号无交集', async ({ request }) => {
    const mine = await listAll(request, await tokenOf(request, accounts.list));
    const other = await listAll(request, await tokenOf(request, accounts.owner02));
    expect(mine).toHaveLength(25);
    expect(other.length).toBeGreaterThanOrEqual(3);
    const mineNos = new Set(mine.map((i) => i.defectNo));
    expect(other.filter((i) => mineNos.has(i.defectNo))).toEqual([]);
  });

  test('TC-010 带 ownerId、unitId 参数被忽略，仍返回自己的 25 条', async ({ request }) => {
    const token = await tokenOf(request, accounts.list);
    const p = await listPage(request, token, 'ownerId=owner02&unitId=2&unitName=B');
    expect(p.total).toBe(25);
    const mine = await listAll(request, token);
    const other = await listAll(request, await tokenOf(request, accounts.owner02));
    const otherNos = new Set(other.map((i) => i.defectNo));
    expect(mine.filter((i) => otherNos.has(i.defectNo))).toEqual([]);
  });

  test('TC-021 四种筛选：total 与实际一致，四者之和为 25，IN_PROGRESS 不含前三类', async ({ request }) => {
    const token = await tokenOf(request, accounts.list);
    const all = await listAll(request, token);
    const by = (f: string) => listAll(request, token, f);
    const [pd, ds, ip, wd] = await Promise.all([by('PENDING_DISPATCH'), by('DISPATCHED'), by('IN_PROGRESS'), by('WITHDRAWN')]);
    expect(pd.every((i) => i.status === 'PENDING_DISPATCH')).toBe(true);
    expect(ds.every((i) => i.status === 'DISPATCHED')).toBe(true);
    expect(wd.every((i) => i.status === 'WITHDRAWN')).toBe(true);
    expect(ip.every((i) => !['PENDING_DISPATCH', 'DISPATCHED', 'WITHDRAWN', 'IN_PROGRESS'].includes(i.status))).toBe(true);
    expect(ip.length).toBeGreaterThanOrEqual(3);
    expect(pd.length + ds.length + ip.length + wd.length).toBe(25);
    expect(all.filter((i) => statusLabel(i.status) === '待派单')).toHaveLength(pd.length);
    for (const [f, list] of [['PENDING_DISPATCH', pd], ['DISPATCHED', ds], ['IN_PROGRESS', ip], ['WITHDRAWN', wd]] as const) {
      expect((await listPage(request, token, `statusFilter=${f}`)).total, f).toBe(list.length);
    }
  });

  test('TC-022 不传 statusFilter 与传空字符串均返回全部', async ({ request }) => {
    const token = await tokenOf(request, accounts.list);
    expect((await listPage(request, token)).total).toBe(25);
    expect((await listPage(request, token, 'statusFilter=')).total).toBe(25);
  });

  test('TC-029 全部 25 条的 descriptionSummary 符合需求 §5 的摘要规则', async ({ request }) => {
    const token = await tokenOf(request, accounts.list);
    const all = await listAll(request, token);
    const raws = await Promise.all(all.map((i) => rawDescription(request, token, i.defectId)));
    all.forEach((item, idx) => {
      expect(item.descriptionSummary, `${item.defectNo} 原描述 ${JSON.stringify(raws[idx])}`).toBe(expectedSummary(raws[idx]));
      expect(Array.from(item.descriptionSummary).length).toBeLessThanOrEqual(51);
    });
    // 种子应覆盖的边界都存在（QA 文档「owner-list 的 25 条缺陷数据要求」）
    const has = (re: RegExp) => raws.some((r) => re.test(r));
    expect(has(/^[^\r\n]{10}\n/), '含 \\n').toBe(true);
    expect(has(/\r\n/), '含 \\r\\n').toBe(true);
    expect(has(/\n\n/), '含连续 \\n\\n').toBe(true);
    expect(has(/<script>alert\(1\)<\/script>/), '含 script').toBe(true);
    expect(raws.some((r) => Array.from(r).length === 50), '恰好 50').toBe(true);
    expect(raws.some((r) => Array.from(r).length < 50), '少于 50').toBe(true);
    expect(raws.some((r) => /^[A-Za-z]{120}$/.test(r)), '120 个无空格字符').toBe(true);
  });

  async function summaryOf(request: import('@playwright/test').APIRequestContext, pick: (raw: string) => boolean) {
    const token = await tokenOf(request, accounts.list);
    const all = await listAll(request, token);
    for (const item of all) {
      const raw = await rawDescription(request, token, item.defectId);
      if (pick(raw)) return { item, raw };
    }
    throw new Error('种子中找不到符合条件的缺陷');
  }

  test('TC-065 \\r\\n 替换为 1 个空格，占 2 个码点：10 字+空格+38 字，末尾加「…」', async ({ request }) => {
    const { item, raw } = await summaryOf(request, (r) => /^.{10}\r\n/.test(r) && Array.from(r).length > 50);
    expect(item.descriptionSummary).toBe(`${Array.from(raw).slice(0, 10).join('')} ${Array.from(raw).slice(12, 50).join('')}…`);
    expect(Array.from(item.descriptionSummary)).toHaveLength(50); // 10 + 空格 + 38 + 「…」
    expect(item.descriptionSummary).not.toMatch(/[\r\n]/);
  });

  test('TC-066 连续 \\n\\n 替换为 2 个空格，不合并', async ({ request }) => {
    const { item } = await summaryOf(request, (r) => /\n\n/.test(r) && Array.from(r).length > 50);
    expect(item.descriptionSummary).toContain('  ');
    expect(item.descriptionSummary).not.toMatch(/[\r\n]/);
  });

  test('TC-067 49 个普通字符后接 👍🏽：摘要为 49 个字符加「…」，emoji 整体舍去', async ({ request }) => {
    const { item, raw } = await summaryOf(request, (r) => /^字{49}👍🏽$/u.test(r));
    expect(item.descriptionSummary).toBe(`${'字'.repeat(49)}…`);
    expect(Array.from(raw)).toHaveLength(51);
  });

  test('TC-068 48 个普通字符后接 👍🏽（恰好 50 个码点）：完整显示，不加「…」', async ({ request }) => {
    const { item } = await summaryOf(request, (r) => /^字{48}👍🏽$/u.test(r));
    expect(item.descriptionSummary).toBe(`${'字'.repeat(48)}👍🏽`);
  });

  test('TC-045 pageSize=1 返回 1 条，pageSize=100 返回 25 条，total 均为 25', async ({ request }) => {
    const token = await tokenOf(request, accounts.list);
    const one = await listPage(request, token, 'pageSize=1');
    const hundred = await listPage(request, token, 'pageSize=100');
    expect([one.items.length, one.total]).toEqual([1, 25]);
    expect([hundred.items.length, hundred.total]).toEqual([25, 25]);
  });

  test('TC-046 pageNo=99：200，items 为空，total=25，pageNo 回显 99', async ({ request }) => {
    const token = await tokenOf(request, accounts.list);
    const p = await listPage(request, token, 'pageNo=99');
    expect(p).toMatchObject({ items: [], total: 25, pageNo: 99 });
  });

  test('TC-042 statusFilter=ABC：400，fieldErrors 含 statusFilter', async ({ request }) => {
    const token = await tokenOf(request, accounts.list);
    const fe = await fieldErrorsOf(await listDefects(request, token, 'statusFilter=ABC'));
    expect(fe).toContainEqual({ field: 'statusFilter', message: MSG_STATUS });
  });

  for (const v of ['0', '-1', 'abc', '1.5']) {
    test(`TC-043 pageNo=${v}：400，fieldErrors 含 pageNo`, async ({ request }) => {
      const token = await tokenOf(request, accounts.list);
      const fe = await fieldErrorsOf(await listDefects(request, token, `pageNo=${v}`));
      expect(fe).toContainEqual({ field: 'pageNo', message: MSG_PAGE });
    });
  }

  for (const v of ['0', '101', 'abc']) {
    test(`TC-044 pageSize=${v}：400，fieldErrors 含 pageSize`, async ({ request }) => {
      const token = await tokenOf(request, accounts.list);
      const fe = await fieldErrorsOf(await listDefects(request, token, `pageSize=${v}`));
      expect(fe).toContainEqual({ field: 'pageSize', message: MSG_SIZE });
    });
  }

  test('TC-047 三个参数同时不合法：fieldErrors 含三项及各自文案', async ({ request }) => {
    const token = await tokenOf(request, accounts.list);
    const fe = await fieldErrorsOf(await listDefects(request, token, 'statusFilter=ABC&pageNo=0&pageSize=0'));
    expect(fe).toEqual(
      expect.arrayContaining([
        { field: 'statusFilter', message: MSG_STATUS },
        { field: 'pageNo', message: MSG_PAGE },
        { field: 'pageSize', message: MSG_SIZE },
      ]),
    );
  });

  test('TC-048 无令牌：401 AUTH_UNAUTHENTICATED', async ({ request }) => {
    await expectCode(await request.get('defects'), 401, 'AUTH_UNAUTHENTICATED');
  });

  for (const [who, acct] of [['cso01', accounts.cso], ['sub01', accounts.sub]] as const) {
    test(`TC-050 ${who} 请求列表：403 AUTH_FORBIDDEN，不返回缺陷`, async ({ request }) => {
      const token = await tokenOf(request, acct);
      const res = await listDefects(request, token);
      await expectCode(res, 403, 'AUTH_FORBIDDEN');
      expect(await res.json()).not.toHaveProperty('items');
    });
  }

  test('TC-051 多个错误同时成立：无令牌 401；cso 带非法参数 403，均不是 400', async ({ request }) => {
    await expectCode(await request.get('defects?statusFilter=ABC'), 401, 'AUTH_UNAUTHENTICATED');
    const token = await tokenOf(request, accounts.cso);
    await expectCode(await listDefects(request, token, 'statusFilter=ABC'), 403, 'AUTH_FORBIDDEN');
  });

  test('TC-053 列表项只含约定的 7 个字段，不含图片、单元、最近修改时间', async ({ request }) => {
    const token = await tokenOf(request, accounts.list);
    const p = await listPage(request, token);
    for (const item of p.items) {
      expect(Object.keys(item).sort()).toEqual(
        ['category', 'defectId', 'defectNo', 'descriptionSummary', 'location', 'status', 'submittedAt'],
      );
      expect(item.defectNo).toMatch(/^DF-\d{6}$/);
    }
    expect(JSON.stringify(p)).not.toMatch(/imageId|"url"|images|unitName|lastModifiedAt/);
  });

  test('TC-059 库值 09:30:00（新加坡）的缺陷：submittedAt 为 2026-10-01T09:30:00+08:00', async ({ request }) => {
    const token = await tokenOf(request, accounts.list);
    const all = await listAll(request, token);
    const hit = all.filter((i) => i.submittedAt === '2026-10-01T09:30:00+08:00');
    expect(hit).toHaveLength(1);
    expect(Date.parse(hit[0].submittedAt)).toBe(Date.parse('2026-10-01T01:30:00Z'));
  });

  test('TC-069 statusFilter 大小写不符、带空格：均 400', async ({ request }) => {
    const token = await tokenOf(request, accounts.list);
    for (const v of ['pending_dispatch', '%20DISPATCHED']) {
      const fe = await fieldErrorsOf(await listDefects(request, token, `statusFilter=${v}`));
      expect(fe, v).toContainEqual({ field: 'statusFilter', message: MSG_STATUS });
    }
  });

  test('TC-070 pageNo=99999999999 返回 400；pageNo=2147483647 返回 200 空列表', async ({ request }) => {
    const token = await tokenOf(request, accounts.list);
    const fe = await fieldErrorsOf(await listDefects(request, token, 'pageNo=99999999999'));
    expect(fe).toContainEqual({ field: 'pageNo', message: MSG_PAGE });
    const p = await listPage(request, token, 'pageNo=2147483647');
    expect(p).toMatchObject({ items: [], total: 25 });
  });

  test('TC-071 重复参数取第一个', async ({ request }) => {
    const token = await tokenOf(request, accounts.list);
    const a = await listPage(request, token, 'pageNo=1&pageNo=2');
    expect(a.pageNo).toBe(1);
    const b = await listPage(request, token, 'statusFilter=PENDING_DISPATCH&statusFilter=WITHDRAWN');
    const pd = await listPage(request, token, 'statusFilter=PENDING_DISPATCH');
    expect(b.total).toBe(pd.total);
    expect(b.items.every((i: ListItem) => i.status === 'PENDING_DISPATCH')).toBe(true);
  });
});
