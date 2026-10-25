import { APIRequestContext, expect } from '@playwright/test';
import { bearer, Defect, getDefect } from './defect';

// 来源：API-defect-003-user / QA-defect-003-user（CICD-DEMO-CONTEXT，feat/req-003-defect-list）。

export interface ListItem {
  defectId: string;
  defectNo: string;
  location: string;
  category: string;
  descriptionSummary: string;
  status: string;
  submittedAt: string;
}
export interface ListPage {
  items: ListItem[];
  pageNo: number;
  pageSize: number;
  total: number;
}

export const listDefects = (request: APIRequestContext, token: string, query = '') =>
  request.get(`defects${query ? `?${query}` : ''}`, { headers: bearer(token) });

export async function listPage(request: APIRequestContext, token: string, query = ''): Promise<ListPage> {
  const res = await listDefects(request, token, query);
  expect(res.status(), `GET /defects?${query}`).toBe(200);
  return (await res.json()) as ListPage;
}

/** 取全部（pageSize=100 逐页），用于做整体核对 */
export async function listAll(request: APIRequestContext, token: string, filter = ''): Promise<ListItem[]> {
  const out: ListItem[] = [];
  for (let pageNo = 1; ; pageNo++) {
    const p = await listPage(request, token, `pageSize=100&pageNo=${pageNo}${filter ? `&statusFilter=${filter}` : ''}`);
    out.push(...p.items);
    if (out.length >= p.total || p.items.length === 0) return out;
  }
}

export const rawDescription = async (request: APIRequestContext, token: string, id: string) =>
  ((await (await getDefect(request, token, id)).json()) as Defect).description;

/**
 * 摘要期望值：按需求 §5 的步骤从原描述推出（独立于后端实现）。
 * 1 取前 50 个码点；2 第 50 个码点落在组合 emoji（多码点字形簇）中间时整体舍去该簇；
 * 3 每个换行（\r\n、\r、\n）换成 1 个空格；4 原描述超过 50 个码点时加「…」。
 */
export function expectedSummary(desc: string): string {
  const total = Array.from(desc).length;
  const seg = new Intl.Segmenter('und', { granularity: 'grapheme' });
  let taken = '';
  let count = 0;
  for (const { segment } of seg.segment(desc)) {
    const n = Array.from(segment).length;
    if (count + n > 50) break;
    taken += segment;
    count += n;
  }
  const body = taken.replace(/\r\n|\r|\n/g, ' ');
  return total > 50 ? `${body}…` : body;
}

export const STATUS_LABEL: Record<string, string> = {
  PENDING_DISPATCH: '待派单',
  DISPATCHED: '已派单',
  WITHDRAWN: '已撤回',
};
export const statusLabel = (s: string) => STATUS_LABEL[s] ?? '处理中';

export const LOCATION_LABEL: Record<string, string> = {
  LIVING_ROOM: '客厅', BEDROOM: '卧室', KITCHEN: '厨房', BATHROOM: '卫生间', BALCONY: '阳台', CORRIDOR: '走廊', ENTRANCE_DOOR: '入户门', OTHER: '其他',
};
export const CATEGORY_LABEL: Record<string, string> = {
  WALL_CEILING: '墙面与天花', FLOOR: '地面', DOOR_WINDOW: '门窗', PLUMBING_ELECTRICAL: '水电', SANITARY: '卫浴', CABINET_FURNITURE: '橱柜与家具', PAINT: '油漆', OTHER: '其他',
};

/** 按 submittedAt 倒序、相同时 defectNo 倒序是否成立 */
export function isSortedNewestFirst(items: { submittedAt: string; defectNo: string }[]) {
  for (let i = 1; i < items.length; i++) {
    const a = items[i - 1];
    const b = items[i];
    const ta = Date.parse(a.submittedAt);
    const tb = Date.parse(b.submittedAt);
    if (ta < tb) return false;
    if (ta === tb && a.defectNo < b.defectNo) return false;
  }
  return true;
}

const sgFmt = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Singapore', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});
/** ISO 时间 → 新加坡时间 DD/MM/YYYY HH:mm */
export function sgDateTime(iso: string) {
  const p = Object.fromEntries(sgFmt.formatToParts(new Date(iso)).map((x) => [x.type, x.value]));
  return `${p.day}/${p.month}/${p.year} ${p.hour}:${p.minute}`;
}

/** 条目所在的页码（每页 20 条） */
export const pageOf = (all: { defectNo: string }[], item: { defectNo: string }, size = 20) =>
  Math.floor(all.findIndex((i) => i.defectNo === item.defectNo) / size) + 1;
