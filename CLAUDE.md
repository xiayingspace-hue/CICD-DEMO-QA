# CLAUDE.md · QA（CICD-DEMO-QA）

Playwright + TypeScript，包含接口测试（`tests/api/`）和浏览器端到端测试（`tests/e2e/`）。

## 事实源在哪里

需求和 QA 用例在 **CICD-DEMO-CONTEXT** 仓库（`https://github.com/xiayingspace-hue/CICD-DEMO-CONTEXT`，本地 `../CICD-DEMO-CONTEXT`，读 `main` 分支）。

| 要回答的问题 | 读哪里 |
|---|---|
| 测什么、预期结果是什么 | `outputs/qa/QA-*.md`（用例，含 TC 编号）与 `requirements/**` 需求文档（AC） |
| 接口路径、字段、错误码 | `outputs/api/API-*.md` |
| 页面元素怎么定位 | 前端代码 `../CICD-DEMO-WEB`（只用来取定位方式） |

## 铁律：预期结果只来自文档，不来自代码

1. **预期结果只取自 QA 用例和需求文档**，不从前端或后端代码推断。
2. 前端代码**只用来回答**「怎么定位这个元素、怎么触发这个操作、路由是什么」。
3. 代码与需求不一致时，**不改脚本去迁就代码**。在 CONTEXT 仓库开 Issue 报告「实现与 AC-xxx 不符」，写明代码位置和现象，脚本保持按需求断言（可先 `test.fixme` 并注明 Issue 编号）。
4. 否则测试只是给实现做快照，发现不了问题。

## 命名与追溯

- 每个 Playwright 用例标题以 TC 编号开头：`test('TC-011 密码错误：提示并清空密码', ...)`。一条 QA 用例对应一个 `test`。
- 文件按需求命名：`tests/api/auth-001-admin.spec.ts`、`tests/e2e/auth-001-admin.spec.ts`。
- 追溯靠编号：`grep TC-011` 能在两个仓库里找到用例和脚本。
- 用例变了，回 CONTEXT 改 QA 文档，再同步脚本；**不在脚本里自行补用例**。
- 哪些用例走接口、哪些走页面：只需要后端参与的（错误码、DLP 到期可登录、不泄露账号状态）写 API 测试；涉及页面行为的写 E2E。

## 不能自动化的用例

无法在 Playwright 中验证的用例（例如抓包确认 HTTPS 与日志，TC-026）：保留一个 `test.skip`，写明原因，不要删除，保证每个 TC 编号都能追溯到。

## 环境与账号

- 地址与账号放环境变量，不提交真实值，参考 `.env.example`：
  - `API_BASE_URL`：网关加服务前缀，例如 `http://localhost:8080/defect-service`
  - `WEB_BASE_URL`：前端地址
  - 测试账号及密码：`owner01`、`cso01`、`sub01`、`off01`、`owner-expired`（约定见 QA 用例文档开头），密码用环境变量传入
- 页面异常场景（接口延迟、网络失败、超时）用 `page.route` 模拟，不依赖真实故障。

## 示例测试

`tests/api/posts.spec.ts` 与 `tests/e2e/home.spec.ts` 是模板自带的示例，访问的是外部站点。**登录用例的 API 与 E2E 都写好并通过后再删除**，并把 `.env.example` 和 `playwright.config.ts` 里的默认地址改为本项目地址。

## 命令

```
npm install
npx playwright install chromium
npm run typecheck      # 提交前必须通过
npm run test:api
npm run test:e2e
npm run report
```

## 遇到疑问怎么办

不要自行发明。按顺序：

1. 先查 QA 用例、需求、需求第 11 章「已知缺口」。能推出来的不问。
2. 缺口表里有「默认处理」的，按默认做，并在 PR 描述里写明。
3. 都没有，在 **CICD-DEMO-CONTEXT 仓库开 Issue**（`gh issue create -R xiayingspace-hue/CICD-DEMO-CONTEXT`），标签 `question`、`ai-raised`、对应的 `REQ-xxx`。内容包含：引用的文档位置、疑问、2-3 个选项、你建议的默认选项。开之前先搜已有未关闭的 Issue，已有就追加评论。
4. 在自己的 PR 里写「阻塞于 CONTEXT#<编号>」，**继续完成不受阻塞的部分**。

## 分支与 PR

- 分支：`test/<REQ编号>-<简述>`，例如 `test/req-001-login`。不直接提交到 `main`。
- PR 描述写明：覆盖了哪些 TC、哪些用例 `skip` 或 `fixme` 及原因、发现了哪些与需求不符之处。
- 开**草稿 PR**，由人评审，不自行合并。
