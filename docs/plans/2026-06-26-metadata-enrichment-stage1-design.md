# 检索结果元数据富化（阶段 1）设计文档

> 日期：2026-06-26　　状态：待确认　　关联：`docs/plans/2026-06-26-stuck-job-auto-recovery-design.md`

## 1. 目标与范围

**问题**：检索报告 ~67% 文献缺作者、~27% 缺公开时间。根因是让 LLM 从联网片段/训练记忆"产出"结构化作者/日期元数据，而片段/记忆本身不含这些信息；prompt 又禁止编造，AI 正确地填"未知"/空。

**阶段 1 目标**：新增元数据富化管线，按 URL/title 从权威结构化源取 ground truth 回填 `authors`/`pub_date`，把缺失率从 ~67% 降到个位数。

**范围（做）**：arXiv / Crossref(DOI) / Semantic Scholar / 通用网页 meta+JSON-LD（含专利）四类来源；在 `executeSingleTask` 的 `filterByQuality` 之前对缺字段结果富化（质量优先，救回更多结果），质量分由 `filterByQuality` 重算。

**范围（不做，留给后续阶段）**：按 title 的批量补全检索（阶段 2，仅作为 S2-by-title 兜底已在本阶段内）；`enableWebSearch` 关闭策略调整（阶段 3）；专利专用 API（如 EPO OPS，需 OAuth，阶段 1 用 JSON-LD/meta 覆盖已够）。

## 2. 集成点与数据流

集成在 `worker/src/handlers/search-job.ts` 的 `executeSingleTask` 内，**质量优先：富化前置到 `filterByQuality` 之前**，使原本因缺作者/日期被低分丢弃的结果也能被救回：

```
parseSearchResults(raw, per_task_limit*2)   // 现状：解析 + 初算质量分
  → ★ enrichMetadata(results)              // 新增：仅对缺 authors/pub_date 的结果回填；不重算（下一步会算）
  → filterByQuality(50)                     // 现状：用回填后的字段重算分数 → 救回的结果不再被丢
  → slice(per_task_limit)                   // 现状：取前 N
  → updateTaskStatus('done', { results })   // 现状：持久化（富化后的数据落库）
  → return（带 source 标签的 EnrichedResult）
```

要点：
- **富化在 filter 之前**（质量优先，接受更多 API 调用）；但 `enrichOne` 对"两字段都已填"的结果**直接跳过**（不发请求），对"无 URL 且无 title"的结果也**无标识符可富化**（不发请求）——所以额外调用只花在"有标识符且缺字段"的可救回结果上，不浪费。
- 质量分重算由现有 `filterByQuality` 完成（它内部调 `calculateQualityScore`，用回填后的 authors/pub_date 重算分数/警告），无需单独 rescore 步骤。
- 富化结果随 `search_tasks.results` 落库，部分重试时 `seedResultsFromDoneTasks` 直接复用，不重复富化。
- `allResults` 合并后进 `generateReport`，报告的 `missingAuthors`/`missingDates` 统计与 `.missing` 黄标自动随回填减少（`report.ts:299-300,383` 是按 authors/pub_date 实值判断的，无需改报告逻辑）。

## 3. API 选型

| 来源 | 触发条件 | 端点 | 返回格式 | 取得字段 | 限流 |
|---|---|---|---|---|---|
| arXiv | URL 含 arxiv.org | `http://export.arxiv.org/api/query?id_list={id}&max_results=1` | Atom XML | `<author><name>`(多个)、`<published>`(取日期) | 建议 ≥3s/req，复用 `callWithRetry` 处理 429 |
| Crossref | URL 含 doi.org / DOI 模式 | `https://api.crossref.org/works/{doi}` | JSON | `message.author[].{given,family}`、`published-print/online.date-parts` | polite pool，~50/s，宽松 |
| Semantic Scholar(按 id) | URL 含 semanticscholar.org/paper | `https://api.semanticscholar.org/graph/v1/paper/{id}?fields=title,authors,year` | JSON | `authors[].name`、`year` | 免费 ~1 req/s，429 重试 |
| Semantic Scholar(按 title) | 无可用 URL 或前面步骤未取到作者 | `.../paper/search?query={title}&limit=1&fields=title,authors,year` | JSON | 同上；**需标题相似度校验** | 同上 |
| 通用网页 meta + JSON-LD | 其它有效 http(s) URL（含专利） | 直接 GET 页面 HTML | HTML | `<meta name="citation_author">`、`citation_publication_date`、`DC.creator`、`og:article:author`；**+ `<script type="application/ld+json">` schema.org**（Patent/Article 的 author/inventor、datePublished/filingDate） | 视站点，超时兜底；含 SSRF 私网过滤 |

说明：
- **不引新依赖**：arXiv Atom XML、页面 meta、JSON-LD 均用正则/原生 JSON 解析；Crossref/S2 用原生 `fetch`+`JSON.parse`。worker 运行在 Node 18+，`fetch` 全局可用（`openai-compat.ts` 已在用）。
- **专利**：靠"通用网页 meta + JSON-LD"增强覆盖（patents.google.com 服务端渲染的 HTML 含 meta 与 schema.org Patent JSON-LD，可取发明人/公开日）；取不到则保持标黄。无 API key、不调用非官方端点。

## 4. 分流逻辑（每条结果的优先级链）

对每条结果按以下顺序尝试，**任一步取到 authors 或 pub_date 即回填该字段；两字段都填满或链路走完则停止**：

1. **URL → arXiv id**：`extractArxivId(url)` 命中 → `fetchArxiv(id)`。
2. **URL → DOI**：`extractDoi(url)` 命中 → `fetchCrossref(doi)`。
3. **URL → S2 paper id**：`extractS2Id(url)` 命中 → `fetchS2ByPaperId(id)`。
4. **URL 有效 http(s)** → `fetchPageMeta(url)`（取 meta 标签）。
5. **仍缺 authors 且有 title** → `fetchS2ByTitle(title)`（带相似度校验）。

每步独立 `try/catch` + `withTimeout`，失败/超时/无数据 → 顺延下一步。无 URL 且无 title → 直接放弃（保持原值）。

标识符提取：
- `extractArxivId`：`arxiv.org/abs/{id}`、`arxiv.org/pdf/{id}[vN]`、老格式 `arxiv.org/abs/{archive}/{id}`。
- `extractDoi`：`doi.org/{10.\d{4,9}/\S+}`、`dx.doi.org/...`、URL 内嵌 DOI 模式。
- `extractS2Id`：`semanticscholar.org/paper/{slug}/{40位hex}` 或新式 `/paper/{id}`。

## 5. 回填规则（防幻觉/防错数据——核心原则）

- **不使用 LLM 产出元数据**：富化全程只做"结构化权威源检索 + 解析"，无任何模型调用，从源头杜绝幻觉。
- **只填不覆写**：仅当 `authors` 为空/`'未知'`、`pub_date` 为空时才回填；AI 已给出有效值则保留（不拿富化覆盖可能正确的人工/AI 值）。
- **S2 按 title 的相似度守卫（最后手段）**：`titleSimilarity(inputTitle, s2Title) ≥ 0.85`（Jaccard token 与 Levenshtein 比取大值 × 长度约束）才采信，否则丢弃——宁可标黄也不张冠李戴。arXiv/Crossref/S2-by-id/页面 meta 都按权威标识/真实页面取，无歧义，不需守卫。
- **作者多值统一**：多个作者用 `;` 分隔（与现有 prompt 约定一致）。
- **日期归一**：复用 `normalizeDate`（`prompt.ts:287`）把 `YYYY`、`YYYY/MM/DD`、`YYYY年M月D日` 归一到 `YYYY-MM-DD`；仅年份 → `YYYY-01-01`（年份为真值，月/日为约定占位，非幻觉）。
- **SSRF 防护**：页面 meta 抓取前过滤指向私网/本地的 URL（localhost/127./10./192.168./172.16-31./169.254/.local），只抓公网结果链接。
- 记录 `metadata_source`（如 `'arXiv'`/`'Crossref'`/`'Semantic Scholar'`/`'页面meta'`）便于追溯（报告不展示，仅存档）。

## 6. 超时与并发

- **单步超时**：每个外部请求 `withTimeout(fetch, 8000ms)`（复用 `utils/retry.ts`）。
- **429/瞬态重试**：每个 fetcher 的请求套 `callWithRetry({maxRetries:2, baseDelayMs:1000})`（复用现有限流重试工具）。
- **结果间并发**：`mapWithConcurrency(results, 3, enrichOne)`——自写轻量并发池（不引 `p-limit`），限 3 并发，避免冲击 S2/arXiv 限流。
- **整体有界**：10 条结果 × 3 并发 × 链路 ≤ 几步，通常 < 10s；最坏（多步全超时）≈ 10 × (链路步数 × 8s) / 3，可接受且不阻塞主流程（富化失败即降级，不抛错）。
- 不与 handler 硬超时冲突：富化在 `executeSingleTask` 内，整 task 仍受 25min 硬超时兜底。

## 7. 质量分重算

富化回填后，对每条结果重跑 `calculateQualityScore`（`prompt.ts:96`，已导出）更新 `quality_score`/`quality_warnings`：
- 作者补齐 → 不再 -20，"作者信息缺失"警告移除。
- 日期补齐 → 不再 -10，"公开时间缺失"警告移除。
- 分数从（如）80 → 100；报告 `toSelectedDoc`（`report.ts:240`）直接读新的 `quality_warnings`，`missingAuthors/missingDates`（`report.ts:299-300`）按实值重算 → 黄标自动减少。

实现：`rescoreResult(r) = { ...r, ...calculateQualityScore(r) }`（`calculateQualityScore` 返回 `{score, warnings}`，映射到 `quality_score`/`quality_warnings`）。

## 8. 与 SearchResult / 报告的衔接

- **SearchResult 扩展**（`worker/src/utils/prompt.ts`）：加可选 `metadata_source?: string`。纯追加，不破坏现有字段。
- **持久化**：富化后的 `finalResults` 经 `updateTaskStatus('done', {results})` 落 `search_tasks.results` → 部分重试/重排时复用，不重跑富化。
- **报告**：核心行为**无需改 `report.ts`**——`toSelectedDoc` 与统计都按 authors/pub_date 实值判断，富化后自然减少缺失。`metadata_source` 的展示（如"元数据来自 Crossref"小徽章）作为可选增强，阶段 1 可不做。
- **类型链路**：`EnrichedResult = SearchResult & {source_task_id, source_platform, source_strategy}`，富化只动 `SearchResult` 部分，source 标签照常在 `executeSingleTask` 末尾打。

## 9. 降级与边界

- 任一来源失败/超时/无数据 → 静默顺延，最终保持原"未知"/空 → 仍标黄+人工核实（**不比现状更差**）。
- 富化整体抛错（不该发生，因每步都 try/catch）→ `executeSingleTask` catch 兜底，任务 abandoned（与现有任何子任务异常一致）。
- **专利**：靠 JSON-LD(meta schema.org Patent) + meta 标签覆盖，无 API key；取不到则标黄（不强制编造）。
- **错填风险**：仅 S2-by-title 有歧义，用相似度守卫；其余按权威标识取，风险低。且"只填不覆写"保证不会把好数据改坏。富化全程无 LLM，无幻觉来源。
- **限流**：S2/arXiv 敏感，靠并发=3 + `callWithRetry` 的 429 退避；大批量时如需更稳，可加按源的最小间隔（阶段 1 暂不做）。

## 10. 落点清单

- `worker/src/services/enrichment.ts`（新）：`enrichMetadata`、`enrichOne`、四个 `fetch*`、标识符提取、`titleSimilarity`、`mapWithConcurrency`、`rescoreResult`。
- `worker/src/handlers/search-job.ts`：在 `executeSingleTask` 的 slice 之后、`updateTaskStatus('done')` 之前插入 `enrichMetadata` + `rescore`；日志输出富化命中数。
- `worker/src/utils/prompt.ts`：`SearchResult` 加 `metadata_source?: string`（可选）。
- 测试 `__tests__/worker/enrichment.test.ts`（新）：mock fetch，测分流路由、各解析器、相似度守卫、只填不覆写、rescore、降级。

## 11. 测试计划

- **单元**：标识符提取（arXiv/DOI/S2 各正反例）；arXiv XML/Crossref JSON/meta HTML 解析；titleSimilarity 阈值；enrichOne 路由链（命中 arXiv 不走后续、失败顺延、两字段填满即停）；只填不覆写；rescore 后警告移除；并发池限流。
- **集成**：`enrichMetadata` 对一组含 arXiv/DOI/普通 URL/无 URL 的样本结果，断言相应字段被回填、`metadata_source` 正确、未命中者保持原值且不抛错。
- **回归**：现有 31 个测试不变；worker `tsc` 通过；人工跑一次检索看报告缺失数下降。
