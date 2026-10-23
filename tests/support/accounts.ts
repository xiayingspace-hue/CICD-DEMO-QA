// 测试账号约定见 CICD-DEMO-CONTEXT 的 QA-auth-001-admin.md；密码走环境变量，不提交真实值。
export const accounts = {
  owner: { account: 'owner01', password: process.env.OWNER01_PASSWORD ?? '' },
  cso: { account: 'cso01', password: process.env.CSO01_PASSWORD ?? '' },
  sub: { account: 'sub01', password: process.env.SUB01_PASSWORD ?? '' },
  disabled: { account: 'off01', password: process.env.OFF01_PASSWORD ?? '' },
  expired: { account: 'owner-expired', password: process.env.OWNER_EXPIRED_PASSWORD ?? '' },
};
