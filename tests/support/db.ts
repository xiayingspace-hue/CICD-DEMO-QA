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
