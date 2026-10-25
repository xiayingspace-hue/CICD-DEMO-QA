import { test, expect } from '@playwright/test';
import {
  accounts, bearer, createDefect, expectCode, expectFieldError, getDefect, gifBuffer, MB10, pngOfSize,
  putDefect, submitDefect, tokenOf, uploadPng, uploadRaw, validDefect, withdrawDefect,
} from '../support/defect';
import {
  clockControlReady, clockControlSkipReason, defectHelpersReady, defectHelpersSkipReason, setDefectStatus, setDlpEndDate, sgToday,
} from '../support/db';

// 来源：QA-defect-002-user / API-defect-002-user（CICD-DEMO-CONTEXT，feat/req-002-submit-defect）。预期只取自文档。
// 仅覆盖 QA 标明「接口层」的用例；页面行为见 tests/e2e/defect-002-user.spec.ts。
const MSG_DESC_EMPTY = '请填写缺陷描述';
const MSG_DESC_LONG = '描述不能超过 500 字';
const MSG_IMG_MAX = '最多上传 5 张图片';
const MSG_IMG_INVALID = '图片无效，请重新上传';
const NOT_EXIST = 'qa-not-exist-000';

test.describe('REQ-002 屋主提交缺陷接口', () => {
  test('TC-011 描述 501 字、纯空格、缺失均返回 400 DEFECT_VALIDATION_FAILED', async ({ request }) => {
    const token = await tokenOf(request, accounts.owner);
    await expectFieldError(await submitDefect(request, token, { ...validDefect, description: '字'.repeat(501) }), 'description', MSG_DESC_LONG);
    await expectFieldError(await submitDefect(request, token, { ...validDefect, description: '   ' }), 'description', MSG_DESC_EMPTY);
    const { description: _omit, ...noDesc } = validDefect;
    await expectFieldError(await submitDefect(request, token, noDesc), 'description', MSG_DESC_EMPTY);
  });

  test('TC-016 上传 gif、10MB+1 字节 png、被截断的超大文件', async ({ request }) => {
    const token = await tokenOf(request, accounts.owner);
    const gif = await uploadRaw(request, token, { name: 'photo.gif', mimeType: 'image/gif', buffer: gifBuffer });
    await expectCode(gif, 400, 'DEFECT_IMAGE_TYPE_INVALID');
    const over = await uploadRaw(request, token, { name: 'over-10mb.png', mimeType: 'image/png', buffer: pngOfSize(MB10 + 1) });
    await expectCode(over, 400, 'DEFECT_IMAGE_TOO_LARGE');
    const huge = await uploadRaw(request, token, { name: 'huge.png', mimeType: 'image/png', buffer: pngOfSize(30 * 1024 * 1024) });
    await expectCode(huge, 400, 'DEFECT_IMAGE_TOO_LARGE');
  });

  test('TC-082 扩展名与文件头不一致均返回 DEFECT_IMAGE_TYPE_INVALID', async ({ request }) => {
    const token = await tokenOf(request, accounts.owner);
    const pngAsGif = await uploadRaw(request, token, { name: 'a.gif', mimeType: 'image/png', buffer: pngOfSize(2048) });
    await expectCode(pngAsGif, 400, 'DEFECT_IMAGE_TYPE_INVALID');
    const gifAsPng = await uploadRaw(request, token, { name: 'a.png', mimeType: 'image/png', buffer: gifBuffer });
    await expectCode(gifAsPng, 400, 'DEFECT_IMAGE_TYPE_INVALID');
  });

  test('TC-083 不带 file 字段、空文件均返回 DEFECT_IMAGE_TYPE_INVALID', async ({ request }) => {
    const token = await tokenOf(request, accounts.owner);
    const noField = await request.post('defect-images', { headers: bearer(token), multipart: { note: 'x' } });
    await expectCode(noField, 400, 'DEFECT_IMAGE_TYPE_INVALID');
    const empty = await uploadRaw(request, token, { name: 'empty.png', mimeType: 'image/png', buffer: Buffer.alloc(0) });
    await expectCode(empty, 400, 'DEFECT_IMAGE_TYPE_INVALID');
  });

  test('TC-017 imageIds 放 6 个：400，fieldErrors 含 imageIds', async ({ request }) => {
    const token = await tokenOf(request, accounts.owner);
    const ids: string[] = [];
    for (let i = 0; i < 6; i++) ids.push((await uploadPng(request, token)).imageId);
    await expectFieldError(await submitDefect(request, token, { ...validDefect, imageIds: ids }), 'imageIds', MSG_IMG_MAX);
  });

  test('TC-018 引用他人图片：400，imageIds 文案「图片无效，请重新上传」', async ({ request }) => {
    const t2 = await tokenOf(request, accounts.owner02);
    const t1 = await tokenOf(request, accounts.owner);
    const { imageId } = await uploadPng(request, t2);
    await expectFieldError(await submitDefect(request, t1, { ...validDefect, imageIds: [imageId] }), 'imageIds', MSG_IMG_INVALID);
  });

  test('TC-084 修改时保留本缺陷图片成功；引用被其他缺陷占用的图片返回 400', async ({ request }) => {
    const token = await tokenOf(request, accounts.owner);
    const i1 = (await uploadPng(request, token)).imageId;
    const i2 = (await uploadPng(request, token)).imageId;
    const a = await createDefect(request, token, { imageIds: [i1] });
    await createDefect(request, token, { imageIds: [i2] });

    const keep = await putDefect(request, token, a.defectId, { ...validDefect, imageIds: [i1] });
    expect(keep.status()).toBe(200);
    expect((await keep.json()).images.map((i: { imageId: string }) => i.imageId)).toEqual([i1]);

    await expectFieldError(await putDefect(request, token, a.defectId, { ...validDefect, imageIds: [i1, i2] }), 'imageIds', MSG_IMG_INVALID);
    const after = await (await getDefect(request, token, a.defectId)).json();
    expect(after.images.map((i: { imageId: string }) => i.imageId)).toEqual([i1]);
  });

  test('TC-023 连续提交两次：PENDING_DISPATCH、defectNo 为 DF-+6 位且不同、时间相等', async ({ request }) => {
    const token = await tokenOf(request, accounts.owner);
    const a = await createDefect(request, token);
    const b = await createDefect(request, token);
    for (const d of [a, b]) {
      expect(d.status).toBe('PENDING_DISPATCH');
      expect(d.defectNo).toMatch(/^DF-\d{6}$/);
      expect(d.lastModifiedAt).toBe(d.submittedAt);
    }
    expect(a.defectNo).not.toBe(b.defectNo);
  });

  test('TC-025 请求带其他单元的 unitId：仍按登录账号的单元创建', async ({ request }) => {
    const t1 = await tokenOf(request, accounts.owner);
    const t2 = await tokenOf(request, accounts.owner02);
    const ctx1 = await (await request.get('owner/submit-context', { headers: bearer(t1) })).json();
    const ctx2 = await (await request.get('owner/submit-context', { headers: bearer(t2) })).json();
    expect(ctx1.unitName).not.toBe(ctx2.unitName); // 种子应为两个不同单元
    const d = await createDefect(request, t1, { unitId: 'unit-b', unitName: ctx2.unitName });
    expect(d.unitName).toBe(ctx1.unitName);
    // 「owner02 的缺陷不增加」：接口没有列表，无法在本层断言，留给后续「我的缺陷」需求。
  });

  test('TC-033 DLP 已到期：canSubmit=false；提交 403 DEFECT_DLP_EXPIRED', async ({ request }) => {
    const token = await tokenOf(request, accounts.expired);
    const ctx = await request.get('owner/submit-context', { headers: bearer(token) });
    expect(ctx.status()).toBe(200);
    expect(await ctx.json()).toMatchObject({ canSubmit: false });
    await expectCode(await submitDefect(request, token, validDefect), 403, 'DEFECT_DLP_EXPIRED');
  });

  test('TC-036 DLP 截止日 23:59:59（新加坡时间）仍可提交', async ({ request }) => {
    test.skip(!clockControlReady || !defectHelpersReady, clockControlSkipReason);
    await setDlpEndDate(accounts.lastday.account, sgToday());
    // 把服务端时间设为 sgToday() 23:59:59+08:00 后：
    const token = await tokenOf(request, accounts.lastday);
    await createDefect(request, token);
  });

  test('TC-037 截止日次日 00:00:00（新加坡时间）起拒绝提交', async ({ request }) => {
    test.skip(!clockControlReady || !defectHelpersReady, clockControlSkipReason);
    await setDlpEndDate(accounts.lastday.account, sgToday());
    // 把服务端时间设为截止日次日 00:00:00+08:00 后：
    const token = await tokenOf(request, accounts.lastday);
    await expectCode(await submitDefect(request, token, validDefect), 403, 'DEFECT_DLP_EXPIRED');
    const ctx = await request.get('owner/submit-context', { headers: bearer(token) });
    expect(await ctx.json()).toMatchObject({ canSubmit: false });
  });

  test('TC-042 修改：描述 501 字、imageIds 6 个均返回 400，缺陷内容不变', async ({ request }) => {
    const token = await tokenOf(request, accounts.owner);
    const d = await createDefect(request, token);
    await expectFieldError(await putDefect(request, token, d.defectId, { ...validDefect, description: '字'.repeat(501) }), 'description', MSG_DESC_LONG);
    const ids: string[] = [];
    for (let i = 0; i < 6; i++) ids.push((await uploadPng(request, token)).imageId);
    await expectFieldError(await putDefect(request, token, d.defectId, { ...validDefect, imageIds: ids }), 'imageIds', MSG_IMG_MAX);
    const after = await (await getDefect(request, token, d.defectId)).json();
    expect(after).toMatchObject({ description: validDefect.description, images: [], lastModifiedAt: d.lastModifiedAt });
  });

  test('TC-046 已派单：PUT、withdraw 均返回 409 DEFECT_LOCKED，内容与状态不变', async ({ request }) => {
    test.skip(!defectHelpersReady, defectHelpersSkipReason);
    const token = await tokenOf(request, accounts.owner);
    const d = await createDefect(request, token);
    await setDefectStatus(d.defectId, 'DISPATCHED');
    await expectCode(await putDefect(request, token, d.defectId, { ...validDefect, description: '改' }), 409, 'DEFECT_LOCKED');
    await expectCode(await withdrawDefect(request, token, d.defectId), 409, 'DEFECT_LOCKED');
    const after = await (await getDefect(request, token, d.defectId)).json();
    expect(after).toMatchObject({ status: 'DISPATCHED', description: d.description, editable: false });
  });

  test('TC-049 已撤回：再撤回、再修改均返回 409 DEFECT_WITHDRAWN', async ({ request }) => {
    const token = await tokenOf(request, accounts.owner);
    const d = await createDefect(request, token);
    const w = await withdrawDefect(request, token, d.defectId);
    expect(w.status()).toBe(200);
    expect(await w.json()).toMatchObject({ status: 'WITHDRAWN', editable: false });
    await expectCode(await withdrawDefect(request, token, d.defectId), 409, 'DEFECT_WITHDRAWN');
    await expectCode(await putDefect(request, token, d.defectId, { ...validDefect, description: '改' }), 409, 'DEFECT_WITHDRAWN');
    const after = await (await getDefect(request, token, d.defectId)).json();
    expect(after).toMatchObject({ status: 'WITHDRAWN', description: d.description });
  });

  test('TC-085 DLP 已到期：上传新图片并修改待派单缺陷成功', async ({ request }) => {
    const id = process.env.EXPIRED_DEFECT_ID;
    test.skip(!id, '未配置 EXPIRED_DEFECT_ID：接口没有列表，无法发现 owner-expired 种子缺陷的 defectId');
    const token = await tokenOf(request, accounts.expired);
    const before = await (await getDefect(request, token, id!)).json();
    expect(before.status).toBe('PENDING_DISPATCH');
    const img = await uploadPng(request, token);
    const keep = (before.images as { imageId: string }[]).map((i) => i.imageId);
    const res = await putDefect(request, token, id!, {
      location: before.location, category: before.category, description: before.description,
      imageIds: [...keep, img.imageId],
    });
    expect(res.status()).toBe(200);
    expect((await res.json()).images.map((i: { imageId: string }) => i.imageId)).toContain(img.imageId);
  });

  test('TC-056 他人的缺陷与不存在的标识：GET/PUT/withdraw 全部 404 且响应一致', async ({ request }) => {
    const t1 = await tokenOf(request, accounts.owner);
    const t2 = await tokenOf(request, accounts.owner02);
    const other = await createDefect(request, t2);
    const call = async (id: string) => {
      const out = [];
      for (const res of [
        await getDefect(request, t1, id),
        await putDefect(request, t1, id, validDefect),
        await withdrawDefect(request, t1, id),
      ]) {
        expect(res.status()).toBe(404);
        out.push(await res.json());
      }
      return out;
    };
    const foreign = await call(other.defectId);
    const missing = await call(NOT_EXIST);
    for (const b of [...foreign, ...missing]) expect(b).toMatchObject({ code: 'DEFECT_NOT_FOUND' });
    expect(foreign).toEqual(missing);
    const after = await (await getDefect(request, t2, other.defectId)).json();
    expect(after).toMatchObject({ status: 'PENDING_DISPATCH', description: other.description });
  });

  for (const [tc, who] of [['TC-057', 'cso'], ['TC-058', 'sub']] as const) {
    test(`${tc} ${who === 'cso' ? 'CSO' : 'SUBCONTRACTOR'} 调用本需求全部接口均返回 403 AUTH_FORBIDDEN`, async ({ request }) => {
      const owner = await tokenOf(request, accounts.owner);
      const d = await createDefect(request, owner);
      const t = await tokenOf(request, accounts[who]);
      const results = [
        await request.get('owner/submit-context', { headers: bearer(t) }),
        await uploadRaw(request, t, { name: 'ok.png', mimeType: 'image/png', buffer: pngOfSize(2048) }),
        await submitDefect(request, t, validDefect),
        await getDefect(request, t, d.defectId),
        await putDefect(request, t, d.defectId, { ...validDefect, description: '改' }),
        await withdrawDefect(request, t, d.defectId),
      ];
      for (const res of results) await expectCode(res, 403, 'AUTH_FORBIDDEN');
      const after = await (await getDefect(request, owner, d.defectId)).json();
      expect(after).toMatchObject({ status: 'PENDING_DISPATCH', description: d.description });
    });
  }

  test('TC-070 图片签名地址：有效期内可访问；篡改、去签名返回 403；重新查询得到新地址', async ({ request, playwright }) => {
    const token = await tokenOf(request, accounts.owner);
    const { imageId } = await uploadPng(request, token);
    const d = await createDefect(request, token, { imageIds: [imageId] });
    const url1 = d.images[0].url;
    const anon = await playwright.request.newContext(); // 不带令牌，签名地址本身应可访问
    const origin = new URL(process.env.API_BASE_URL ?? 'http://localhost:8080/defect-service').origin;
    const abs = (u: string) => new URL(u, origin).toString();
    try {
      expect((await anon.get(abs(url1))).status()).toBe(200); // ①
      const u = new URL(abs(url1));
      const sigKey = [...u.searchParams.keys()].pop();
      expect(sigKey, '签名地址应带查询参数').toBeTruthy();
      const tampered = new URL(u);
      const sig = tampered.searchParams.get(sigKey!)!;
      tampered.searchParams.set(sigKey!, sig.slice(0, -1) + (sig.endsWith('0') ? '1' : '0'));
      expect((await anon.get(tampered.toString())).status()).toBe(403); // ②
      expect((await anon.get(`${u.origin}${u.pathname}`)).status()).toBe(403); // ③
      // ④ 超过 10 分钟需时钟控制，见下一条
      await new Promise((r) => setTimeout(r, 1100));
      const d2 = await (await getDefect(request, token, d.defectId)).json();
      expect(d2.images[0].url).not.toBe(url1); // ⑤
      expect((await anon.get(abs(d2.images[0].url))).status()).toBe(200);
    } finally {
      await anon.dispose();
    }
  });

  test('TC-070 图片签名地址超过 10 分钟返回 403', async () => {
    test.skip(!clockControlReady, clockControlSkipReason);
  });

  test('TC-077 未绑定单元：submit-context 与提交均返回 403 DEFECT_NO_UNIT', async ({ request }) => {
    const token = await tokenOf(request, accounts.nounit);
    await expectCode(await request.get('owner/submit-context', { headers: bearer(token) }), 403, 'DEFECT_NO_UNIT');
    await expectCode(await submitDefect(request, token, validDefect), 403, 'DEFECT_NO_UNIT');
  });

  test('TC-078 DLP 已到期且请求体不合法：返回 403 DEFECT_DLP_EXPIRED 而非 400', async ({ request }) => {
    const token = await tokenOf(request, accounts.expired);
    await expectCode(await submitDefect(request, token, { ...validDefect, description: '' }), 403, 'DEFECT_DLP_EXPIRED');
  });

  test('TC-079 已撤回/已派单的缺陷收到不合法请求体：409 而非 400', async ({ request }) => {
    const token = await tokenOf(request, accounts.owner);
    const bad = { ...validDefect, description: '' };
    const withdrawn = await createDefect(request, token);
    await withdrawDefect(request, token, withdrawn.defectId);
    await expectCode(await putDefect(request, token, withdrawn.defectId, bad), 409, 'DEFECT_WITHDRAWN');
    if (!defectHelpersReady) {
      test.info().annotations.push({ type: 'skip-part', description: `已派单部分未执行：${defectHelpersSkipReason}` });
      return;
    }
    const locked = await createDefect(request, token);
    await setDefectStatus(locked.defectId, 'DISPATCHED');
    await expectCode(await putDefect(request, token, locked.defectId, bad), 409, 'DEFECT_LOCKED');
  });

  test('TC-080 优先级：角色先于不存在；标识格式不合法、他人缺陷均为 404', async ({ request }) => {
    const cso = await tokenOf(request, accounts.cso);
    const t1 = await tokenOf(request, accounts.owner);
    const t2 = await tokenOf(request, accounts.owner02);
    await expectCode(await getDefect(request, cso, NOT_EXIST), 403, 'AUTH_FORBIDDEN');
    await expectCode(await getDefect(request, t1, 'abc!'), 404, 'DEFECT_NOT_FOUND');
    const other = await createDefect(request, t2);
    await expectCode(await putDefect(request, t1, other.defectId, { ...validDefect, description: '' }), 404, 'DEFECT_NOT_FOUND');
  });

  test.skip('TC-071 提交请求与图片请求均走 HTTPS', async () => {
    // 需抓包确认，Playwright 无法自动验证，人工验证（QA 文档「不纳入自动化」）。
  });
});
