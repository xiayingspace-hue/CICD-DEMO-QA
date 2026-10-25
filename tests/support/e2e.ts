import { test as base, expect, Page, APIRequestContext, Route } from '@playwright/test';
import { tokenOf } from './defect';

// E2E 公共：接口上下文、接口登录写令牌、按 data-testid 取元素。
const API_URL = (process.env.API_BASE_URL ?? 'http://localhost:8080/defect-service').replace(/\/?$/, '/');

export const test = base.extend<{ api: APIRequestContext }>({
  api: async ({ playwright }, use) => {
    const ctx = await playwright.request.newContext({ baseURL: API_URL, extraHTTPHeaders: { Accept: 'application/json' } });
    await use(ctx);
    await ctx.dispose();
  },
});
export { expect };

export const t = (page: Page, id: string) => page.getByTestId(id);

/** 以接口登录取令牌，写入 localStorage（每个标签只写一次，登录态失效后不会被写回） */
export async function loginAs(page: Page, api: APIRequestContext, a: { account: string; password: string }) {
  const token = await tokenOf(api, a);
  await page.addInitScript((tk) => {
    if (!sessionStorage.getItem('__qa_token_set')) {
      localStorage.setItem('token', tk);
      sessionStorage.setItem('__qa_token_set', '1');
    }
  }, token);
  return token;
}

/** 记录发往列表接口（GET …/defects）的请求 URL */
export function trackList(page: Page) {
  const urls: URL[] = [];
  page.on('request', (r) => {
    const u = new URL(r.url());
    if (r.method() === 'GET' && u.pathname.endsWith('/defects')) urls.push(u);
  });
  return urls;
}
export const isListReq = (r: { method(): string; url(): string }) =>
  r.method() === 'GET' && new URL(r.url()).pathname.endsWith('/defects');

/** 只拦截列表接口的 GET（提交缺陷的 POST /defects 放行） */
export async function routeList(page: Page, handler: (route: Route) => Promise<void> | void) {
  await page.route(
    (u) => u.pathname.endsWith('/defects'),
    (route) => (route.request().method() === 'GET' ? handler(route) : route.fallback()),
  );
}
