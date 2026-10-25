// 测试账号约定见 CICD-DEMO-CONTEXT 的 QA-auth-001-admin.md；联调环境由 dev 种子脚本写入，密码统一为 Test@1234。
const pwd = process.env.TEST_ACCOUNT_PASSWORD ?? 'Test@1234';

export const accounts = {
  owner: { account: 'owner01', password: pwd },
  cso: { account: 'cso01', password: pwd },
  sub: { account: 'sub01', password: pwd },
  disabled: { account: 'off01', password: pwd },
  expired: { account: 'owner-expired', password: pwd },
  owner02: { account: 'owner02', password: pwd }, // REQ-002：单元 B，DLP 未到期
  lastday: { account: 'owner-lastday', password: pwd }, // REQ-002：DLP 截止日由 DLP 脚本设为当天
  nounit: { account: 'owner-nounit', password: pwd }, // REQ-002：未绑定单元
  // REQ-003 列表用例账号（QA-defect-003-user）
  list: { account: 'owner-list', password: pwd }, // 只读，25 条
  listRw: { account: 'owner-list-rw', password: pwd }, // 写操作串行，只做相对断言
  listRevoke: { account: 'owner-list-revoke', password: pwd }, // 仅 TC-056
  bulk: { account: 'owner-bulk', password: pwd }, // 只读，45 条（待派单 21）
  pageRw: { account: 'owner-page-rw', password: pwd }, // 仅 TC-062，21 条待派单
  empty: { account: 'owner-empty', password: pwd }, // 0 条
  unbound: { account: 'owner-unbound', password: pwd }, // 2 条，无单元
  revoke: { account: 'owner-revoke', password: pwd }, // 仅供 TC-029
};
