import { APIRequestContext, APIResponse, expect } from '@playwright/test';
import { accounts } from './accounts';

// 来源：API-defect-002-user（CICD-DEMO-CONTEXT）。基础路径由 playwright.config 的 baseURL 提供。
type Account = { account: string; password: string };

export const validDefect = {
  location: 'KITCHEN',
  category: 'PLUMBING_ELECTRICAL',
  description: 'QA 自动化：水管渗水',
};

export async function tokenOf(request: APIRequestContext, a: Account) {
  const res = await request.post('auth/login', { data: a });
  expect(res.status(), `登录 ${a.account} 失败`).toBe(200);
  return (await res.json()).token as string;
}

export const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

/** 最小合法 PNG（1x1），再补零字节到指定大小；文件头合法，满足「以文件头为准」 */
const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);
export const MB10 = 10 * 1024 * 1024;
export function pngOfSize(size: number) {
  return size <= PNG_1X1.length ? PNG_1X1 : Buffer.concat([PNG_1X1, Buffer.alloc(size - PNG_1X1.length)]);
}
export const gifBuffer = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');

export function uploadRaw(
  request: APIRequestContext,
  token: string,
  file?: { name: string; mimeType: string; buffer: Buffer },
) {
  return request.post('defect-images', { headers: bearer(token), multipart: file ? { file } : {} });
}

export async function uploadPng(request: APIRequestContext, token: string, name = 'ok.png') {
  const res = await uploadRaw(request, token, { name, mimeType: 'image/png', buffer: pngOfSize(2048) });
  expect(res.status()).toBe(200);
  return (await res.json()) as { imageId: string; url: string };
}

export const submitDefect = (request: APIRequestContext, token: string, data: Record<string, unknown>) =>
  request.post('defects', { headers: bearer(token), data });

export async function createDefect(request: APIRequestContext, token: string, extra: Record<string, unknown> = {}) {
  const res = await submitDefect(request, token, { ...validDefect, ...extra });
  expect(res.status()).toBe(200);
  return (await res.json()) as Defect;
}

export const getDefect = (request: APIRequestContext, token: string, id: string) =>
  request.get(`defects/${id}`, { headers: bearer(token) });
export const putDefect = (request: APIRequestContext, token: string, id: string, data: Record<string, unknown>) =>
  request.put(`defects/${id}`, { headers: bearer(token), data });
export const withdrawDefect = (request: APIRequestContext, token: string, id: string) =>
  request.post(`defects/${id}/withdraw`, { headers: bearer(token) });

export interface Defect {
  defectId: string;
  defectNo: string;
  unitName: string;
  location: string;
  category: string;
  description: string;
  images: { imageId: string; url: string }[];
  status: string;
  submittedAt: string;
  lastModifiedAt: string;
  editable: boolean;
}

export async function expectCode(res: APIResponse, status: number, code: string) {
  expect(res.status()).toBe(status);
  expect(await res.json()).toMatchObject({ code });
}

export async function expectFieldError(res: APIResponse, field: string, message?: string) {
  await expectCode(res, 400, 'DEFECT_VALIDATION_FAILED');
  const { fieldErrors } = await res.json();
  const hit = (fieldErrors as { field: string; message: string }[]).find((e) => e.field === field);
  expect(hit, `fieldErrors 应含 ${field}`).toBeTruthy();
  if (message) expect(hit!.message).toBe(message);
}

export { accounts };
