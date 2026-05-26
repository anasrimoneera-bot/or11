# CLAUDE.md

Behavioral guidelines to reduce common LLM coding mistakes. Merge with project-specific instructions as needed.

**Tradeoff:** These guidelines bias toward caution over speed. For trivial tasks, use judgment.

## 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

## 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

## 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:
```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

---

**These guidelines are working if:** fewer unnecessary changes in diffs, fewer rewrites due to overcomplication, and clarifying questions come before implementation rather than after mistakes.

---

## 项目专属（蓝鲸跨境海外仓 / DropXL B2B 分销 ERP）

技术栈：后端 Node + Express + better-sqlite3（**同步**库）；前端 React + Vite。**同一个 Node 进程既托管前端静态资源又服务全部 API**。

### 运行 / 构建
- 后端：`npm start`（`server/index.js`，默认端口 5000）
- 前端：`cd client && npm run build`（产物 `client/dist` 由后端托管）
- 数据库：`data/erp.db`；建表与迁移都在 `server/db.js`，进程启动时自动执行

### 绝不阻塞事件循环（最重要，踩过最多的坑）
better-sqlite3 是同步的，且同一进程还服务前端 + 所有 API，任何重活都会卡死整站：
- 重活（DropXL 商品/订单同步、总表解析、大国 20 万+行的 xlsx 生成、批量预览）一律 `fork` 到 `server/workers/*` 子进程跑，主进程只通过 IPC 转发进度。
- 被前端轮询或高频调用的接口里，**禁止**对大表（`dropxl_products`、`purchase_orders` 可达数十万行）做全表扫描 / 排序 / 相关子查询（correlated subquery）。
  - 需要排序分页 → 建表达式索引（参考 `idx_dropxl_products_sort`），别让 `ORDER BY CAST(code AS INTEGER)` 走临时 B-tree 全排序。
  - 需要计数 → 用快照列（如 `inventory_uploads` 里的行数），别每次 `COUNT(*)` 扫全表。

### 分销商数据安全边界（务必守住）
- 分销商可达接口（`/api/orders`、`/api/aftersales` 等）查 `purchase_orders` **必须用列白名单，禁止 `SELECT *`**。
- **绝不**向分销商返回：`real_amount_usd`、`markup_pct`、`paypal_rate`、`raw_payload`、`raw_response`（真实成本 / 加价 / 利润）。
- 权限分层（`server/middleware/auth.js`）：`authRequired` → `adminRequired`（`/api/admin/*`）→ `ownerRequired`（仅 BOSS）→ `permRequired(key)`（BOSS 或被授权的管理员）。可分配的功能权限注册在 `GRANTABLE_PERMISSIONS`，前端 `AdminStaff.jsx` 的 `FEATURES` 需同步。

### 约定
- 提交信息用中文，格式 `type(scope): 描述`。
- 改动尽量小、贴合现有风格，不顺手重构无关代码。
