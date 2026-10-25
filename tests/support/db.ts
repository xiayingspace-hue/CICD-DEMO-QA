import mysql from 'mysql2/promise';

// 账号管理模块未开发前，TC-029 直连联调库改账号状态（表 account，字段 status：ENABLED / DISABLED）。
export const dbConfigured = !!process.env.DB_HOST;

async function withConn<T>(fn: (conn: mysql.Connection) => Promise<T>): Promise<T> {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT ?? 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  });
  try {
    return await fn(conn);
  } finally {
    await conn.end();
  }
}

export const setAccountStatus = (account: string, status: 'ENABLED' | 'DISABLED') =>
  withConn((c) => c.execute('UPDATE account SET status = ? WHERE account = ?', [status, account]));

// ---- REQ-002 测试辅助脚本（表名字段见后端 defect-service README「供 QA 的联调辅助 SQL」）----
export const defectHelpersReady = dbConfigured;
export const defectHelpersSkipReason = '未配置 DB_HOST：无法直连联调库执行状态脚本、DLP 脚本';

/** 状态脚本：把缺陷改为指定状态（DISPATCHED 或未知值如 FUTURE_STATUS） */
export const setDefectStatus = (defectId: string, status: string) =>
  withConn((c) => c.execute('UPDATE defect SET status = ? WHERE id = ?', [status, defectId]));

/** DLP 脚本：修改账号所属单元的 DLP 截止日（YYYY-MM-DD，新加坡时间） */
export const setDlpEndDate = (account: string, date: string) =>
  withConn((c) =>
    c.execute('UPDATE unit SET dlp_end_date = ? WHERE id = (SELECT unit_id FROM account WHERE account = ?)', [date, account]),
  );

/** owner-expired 种子缺陷的 defectId（接口没有列表） */
export async function findSeedDefectId(account: string): Promise<string | undefined> {
  const [rows] = await withConn((c) =>
    c.execute('SELECT d.id FROM defect d JOIN account a ON a.id = d.owner_account_id WHERE a.account = ? ORDER BY d.id LIMIT 1', [account]),
  );
  const r = (rows as { id: number }[])[0];
  return r ? String(r.id) : undefined;
}

/**
 * 时钟控制：后端只支持启动时固定时间（app.clock.fixed-instant，仅 dev），无法运行中切换。
 * 跑 TC-036/037 时，用固定时钟启动服务，并把同一个 instant 填到环境变量 SERVER_FIXED_INSTANT（ISO，如 2030-06-15T15:59:59Z）。
 */
export const serverFixedInstant = process.env.SERVER_FIXED_INSTANT ? new Date(process.env.SERVER_FIXED_INSTANT) : undefined;
export function serverSgParts() {
  if (!serverFixedInstant) return undefined;
  const sg = new Date(serverFixedInstant.getTime() + 8 * 3600 * 1000).toISOString(); // 新加坡无夏令时，固定 +8
  return { date: sg.slice(0, 10), time: sg.slice(11, 19) };
}
export const clockSkipReason = (want: string) =>
  `需服务端固定时钟为新加坡时间 ${want}：以 app.clock.fixed-instant 启动服务并设置 SERVER_FIXED_INSTANT`;

/** 新加坡时间的今天，YYYY-MM-DD */
export const sgToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Singapore' }).format(new Date());
/** 前一天（给定 YYYY-MM-DD） */
export const prevDay = (d: string) => new Date(new Date(`${d}T00:00:00Z`).getTime() - 86400000).toISOString().slice(0, 10);
