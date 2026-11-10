# Flash Training · 学习项目原型

新增“目标 → 简短诊断 → 针对性帮助 → 新任务独立复测”的前三步闭环。访问 `/projects` 创建或继续学习目标；推荐体验“数据库 → 订单数据分析”。默认最多两次追问、证据充分提前结束，原有单次练习仍可用。实现范围、体验方式和验证说明见 [学习项目说明](docs/learning-projects.md)。

面向大学生的短时职业任务练习：课程→知识→可观察的行动原子→岗位任务。初始内容包含3个岗位、9个知识概念、15个行动原子、6个约5分钟的文字任务。这是人工编写的教学起步示例，未经行业或学习效果验证。

## 本地运行

需要 Python 3.10+、Node.js 22.12+。在 backend/：

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.lock
Copy-Item .env.ai.example .env.ai
python -m uvicorn api_server:app --host 127.0.0.1 --port 8001
```

在 backend/.env.ai 填写自己账号可用的 OPENAI_API_KEY、OPENAI_BASE_URL、OPENAI_MODEL。在 frontend/：

```powershell
npm ci
Copy-Item .env.example .env
npm run dev -- --host 127.0.0.1
```

打开 [前端](http://localhost:5173/)；[接口文档](http://127.0.0.1:8001/docs)。未配置模型时可浏览目录，生成和评分会明确报错。macOS/Linux 使用 source .venv/bin/activate 和 cp。

## 数据与实现边界

默认库是 backend/data/flash_training_v2.sqlite3，目录版本仍为v2；现有schema v2数据库会在自动备份后增量升级为v3，保留原有业务行，新增学习项目及诊断观察。首次空库初始化从 career_catalog.json 播种。更早的schema v1仍不会自动导入或覆盖，需选择新的路径。

图谱页 /graph 展示课程、知识、行动原子、任务与岗位关联。课程学习不能直接证明行动能力；同一原子可复用于不同场景，电商运营的表现不自动算作产品调研或科研阅读的表现。

四种职责分别是任务设计（模型出题）、原子映射（确定性目录校验）、证据评估（模型加引用校验）、学习规划（确定性推荐）。它们复用应用服务，没有自主联网、执行工具或新增智能体框架。模型适配器在 backend/app/infrastructure/ai.py，提示词和输出校验在 backend/app/application/content.py。

详见 [后端说明](backend/README.md)、[架构说明](backend/架构说明.md)、[数据目录](backend/data/README.md)。

## 最小人工验证

启动后访问 /graph，检查三个岗位及知识、原子、任务关联；选择“核对活动转化简报”，生成题目后提交含算式和材料编号的答案，检查分项证据来自原答案、历史结果可恢复。切换场景后不应沿用原场景表现。

生成和评分会调用配置的真实模型，可能收费；启动、生成和提交会写本地数据库，草稿可能写浏览器存储。密钥和用户数据不提交 Git。当前 user_id 只是数据分组，不是登录认证。

## 已执行验证（2026-11-07）

2026-11-10 新版：80 项后端测试、7 项前端测试通过；生产构建与类型检查通过，lint无错误（保留原有6条UI热更新警告）。浏览器通过临时数据库和模型替身验证完整学习流程、草稿刷新、双窗口冲突、手机布局；正式库升级后逐表核对，旧行完全一致。以上不代表真实模型诊断准确率已获验证。

后端已将现有业务测试适配 v2：51 项测试通过（47 项业务、HTTP 与模型适配器测试，4 项架构测试）；独立虚拟环境的 `pip check` 通过。前端 7 项测试、类型检查、生产构建通过；lint 无错误，保留 6 条共享 UI 组件的热更新警告。

浏览器通过真实本地 HTTP 服务验证了图谱筛选、节点详情、手机宽度布局、引导/独立/迁移练习、草稿与辅助声明刷新恢复、历史恢复，以及按情境隔离证据。验证了有辅助的迁移不计作跨情境表现；满足两个情境无辅助达标且含迁移练习后才显示跨情境观察，控制台未捕获错误。

以上使用临时 SQLite 和替代模型，未调用付费模型，也未修改用户练习库。真实模型的出题质量、评分准确性和网关兼容性尚未验证。本轮修复了前置练习推荐可能优先选中复合任务的问题：同情境候选中优先选择原子数量更少的任务。

复现自动检查（依赖已安装；下列测试不调用真实模型）：

```powershell
Set-Location D:\Project\Flash-Training2.0\backend
.\.venv\Scripts\python.exe -m unittest discover -s tests -v
Set-Location ..\frontend
npm run typecheck
npm test
npm run lint
npm run build
```
