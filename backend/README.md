# 后端结构与数据约定

FastAPI 路由调用应用服务；领域层定义模型、规则和仓库协议；SQLite 仓库与模型客户端提供实际能力。事务管理统一创建和关闭连接，仓库不自行提交；模型网络调用位于写事务之外。

## 数据（目录 v2 / 数据库 schema v4）

默认库为 data/flash_training_v2.sqlite3。首次初始化从 data/career_catalog.json 播种岗位、知识、行动原子、任务及关联，不导入旧 JSON 或学习历史。旧数据不再需要，但显式配置的数据库不会被自动清空或删除；schema v2与两种历史v3数据库在一致性备份后增量升级到v4；schema v1仍需选择新文件。

迁移训练将数据库结构升级至 schema v3，已有 schema v2 在事务内新增诊断存储，文件名不变。schema v1 仍不支持自动导入。目录格式版本 2 与数据库结构版本是两个概念。新增原子条件存入 definition_json；只对未修改的内置 v1 定义补充条件并升至定义版本 2，已保存的会话快照不变。

任务沿用 skill_id，原子沿用 atomic_skill_id，以复用已有练习入口。原子包括动作、输入输出、边界、量规、知识及先修关联；任务包括岗位、场景、简报和交付物。课程→知识→原子→任务是教学映射，不是经过验证的能力推断。

作答基于保存的题目、任务和原子快照。评分覆盖本次目标原子，证据引文必须来自实际答案，缺失证据不能用编造引用替代。模型或校验失败不保存成功成绩。表现与推荐保留场景边界，旧总分不追认为新证据。

引导模式保守地视为有辅助条件，即使没有点击提示也不记作独立完成；独立和迁移模式在提交前不返回提示及示例，使用外部帮助时由用户主动声明。本产品是训练工具，不能证明考试环境中没有外部帮助。

单个原子按0–10评分，任务总分是可观察原子的等权平均，展示时乘10。不可观察项没有分数，不进入平均或情境状态更新；全部不可观察时返回明确错误，不保存成绩。最近一次可观察得分达到7，且使用独立/迁移模式、未声明帮助，才标为独立完成证据；两个不同情境均有这样的证据且其中包含迁移练习，才显示跨情境观察。阈值是教学规则，不是经过校准的掌握概率。

## 服务职责

- ContentService：生成完整材料、调用模型评分并校验结构和证据。
- 原子映射：按目录与任务目标确定性检查引用，自定义任务提案只选择既有原子。
- 练习服务：保存题目、恢复会话、提交评估并在事务内保存结果。
- 学习规划：根据目标、先修与场景证据确定性推荐后续任务。

这里的 Agent 是应用职责划分，没有自主工具调用或新智能体框架。

v1 全局得分、掌握度、预测、学习曲线、自评和优化接口统一返回 410，指向 v2 场景证据与推荐接口。任务原子映射接口仍提供定义，但 score/current_score 为 null，表示这里没有提供场景表现，而不是得分为零。

## 主要接口

[完整 OpenAPI](http://127.0.0.1:8001/docs)

| 路径 | 用途 |
| --- | --- |
| GET /api/health | 服务与模型配置状态 |
| GET /api/v1/skills | 任务目录 |
| GET /api/v1/atomic/skills | 行动原子目录 |
| POST /api/v1/practice/start | 生成并保存题目 |
| GET /api/v1/practice/sessions/{id}?user_id=... | 恢复会话 |
| POST /api/v1/practice/submit | 提交文字答案与评估 |
| GET /api/v2/graph | 课程、知识、原子、任务与岗位关联 |
| GET /api/v2/evidence/{user_id} | 用户证据 |
| GET /api/v2/recommendations/{user_id} | 依据证据与先修关系的建议 |
| GET /api/v2/bridge/catalog | 固定基线、变式与综合交付案例 |
| GET /api/v2/bridge/sessions/{id}?user_id=... | 案例元数据、配对观察与诊断状态 |
| POST /api/v2/bridge/sessions/{id}/diagnosis | 保存诊断选择与规则解释 |

受控练习仍从 `/api/v1/practice/start` 开始，在 params 传入 `bridge_case_id`（`conversion_baseline`、`conversion_representation`、`conversion_boundary`、`conversion_synthesis`）。关联基线时同时传 `source_session_id`；服务端校验会话所有者、完成状态和目标定义。固定材料及版本保存在会话中，评分复用原提交接口。

诊断提交体为 `{ "user_id": "default_user", "answers": { "formula": "选项ID", "denominator": "选项ID", "comparability": "选项ID" } }`，选项 ID 来自会话诊断响应。诊断题在文字交付完成后提供；选择对应的标准答案及解释在诊断提交后返回。相同选择可幂等重试，不同选择冲突时应开始新的练习，避免覆盖已经展示反馈后的原始诊断。

## 运行与人工验证

在 backend/ 安装 requirements.lock，复制 .env.ai.example 为 .env.ai 并填写模型配置后执行：

```powershell
python -m uvicorn api_server:app --host 127.0.0.1 --port 8001
```

在 frontend/ 执行 npm ci 和 npm run dev -- --host 127.0.0.1。访问 /graph 检查目录，完成一次指标核算文字练习，检查证据引文来自答案、刷新能恢复结果、其他场景不出现本次表现。生成和评分可能产生真实模型费用，启动与提交写入本地数据库。

2026-11-09 已重跑后端现有 51 项测试并通过，另用临时 SQLite 和既有 FakeAI 完成迁移训练专项 62 个断言，包括配对边界、诊断串行及并发幂等/冲突、回滚、v2→v3 升级及快照保留。没有调用真实模型或修改用户库。复现已有检查（执行目录 backend/，依赖已安装；专项检查为临时脚本，未新增测试文件）：

```powershell
.\.venv\Scripts\python.exe -m unittest discover -s tests -v
```

测试使用临时 SQLite、FakeAI 和模拟 OpenAI SDK，不调用付费模型或写用户数据库。覆盖题目快照、引用与分值校验、提示隐藏、事务回滚、并发幂等、情境隔离、迁移规则、前置推荐和接口流程；浏览器另行通过真实本地 HTTP 验证练习闭环。真实模型质量与外部网关尚未验证。当前不提供账号认证，user_id 不能作为权限凭据。

学习项目接口与简短诊断说明见 [学习项目说明](../docs/learning-projects.md)。schema v4同时包含迁移训练与学习项目存储。
