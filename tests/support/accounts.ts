// 测试账号约定见 CICD-DEMO-CONTEXT 的 QA-auth-001-admin.md；联调环境由 dev 种子脚本写入，密码统一为 Test@1234。
const pwd = process.env.TEST_ACCOUNT_PASSWORD ?? 'Test@1234';

export const accounts = {
  owner: { account: 'owner01', password: pwd },
  cso: { account: 'cso01', password: pwd },
  sub: { account: 'sub01', password: pwd },
  disabled: { account: 'off01', password: pwd },
  expired: { account: 'owner-expired', password: pwd },
  revoke: { account: 'owner-revoke', password: pwd }, // 仅供 TC-029
};
