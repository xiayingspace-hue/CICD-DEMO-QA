import mysql from 'mysql2/promise';

// 账号管理模块未开发前，TC-029 直连联调库改账号状态（表 account，字段 status：ENABLED / DISABLED）。
export const dbConfigured = !!process.env.DB_HOST;

export async function setAccountStatus(account: string, status: 'ENABLED' | 'DISABLED') {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT ?? 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  });
  try {
    await conn.execute('UPDATE account SET status = ? WHERE account = ?', [status, account]);
  } finally {
    await conn.end();
  }
}

// ---- REQ-002 测试辅助脚本（QA-defect-002-user「测试辅助脚本」）----
// 缺陷表、单元表的表名与字段写在后端 defect-service README，后端 REQ-002 尚未合入，QA 不自行假设。
// README 给出后，改下面的 defectHelpersReady 与三个函数，依赖它们的用例会自动恢复执行。
export const defectHelpersReady = false;
export const defectHelpersSkipReason =
  '阻塞于后端 defect-service README：缺陷表/单元表的表名与字段未给出，状态脚本、DLP 脚本尚不可用';
const notReady = (): never => {
  throw new Error(defectHelpersSkipReason);
};

/** 状态脚本：把缺陷改为指定状态（DISPATCHED 或未知值如 FUTURE_STATUS） */
export async function setDefectStatus(_defectId: string, _status: string): Promise<void> {
  notReady();
}
/** DLP 脚本：修改账号所属单元的 DLP 截止日（YYYY-MM-DD，新加坡时间） */
export async function setDlpEndDate(_account: string, _date: string): Promise<void> {
  notReady();
}

/** 时钟控制：联调环境设置服务端时间的方式后端尚未说明，TC-036/037 与 TC-070 过期项据此 skip */
export const clockControlReady = false;
export const clockControlSkipReason = '阻塞于后端：联调环境的服务端时钟控制手段未给出';

/** 新加坡时间的今天，YYYY-MM-DD */
export const sgToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Singapore' }).format(new Date());
