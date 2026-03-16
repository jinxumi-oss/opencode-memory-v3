# OpenCode Memory System v4.2

> TypeScript + BM25 + 向量搜索 + NER + 关系推理 + 上下文压缩

## 快速开始

```bash
# 搜索记忆 (BM25 + 向量混合搜索)
~/.opencode/bin/memory recall "API配置" -l 5

# 存储新记忆
~/.opencode/bin/memory store "重要决策：采用微服务架构" -t decision --tags "architecture"

# 查看统计
~/.opencode/bin/memory stats

# 会话管理
~/.opencode/bin/memory session start
~/.opencode/bin/memory session status
~/.opencode/bin/memory session end

# 学习分析
~/.opencode/bin/memory learn

# 实体抽取
~/.opencode/bin/memory-extract -l 100

# 关系推理
~/.opencode/bin/memory-infer

# 智能分类
~/.opencode/bin/memory-classify -l 50

# 相关推荐
~/.opencode/bin/memory-recommend <memoryId>

# 软删除
~/.opencode/bin/memory forget <id>
~/.opencode/bin/memory restore <id>
```

## v4.2 新特性

| 特性 | v3.0 | v4.2 |
|------|------|------|
| 实现语言 | Bash | **TypeScript** |
| 搜索方式 | LIKE 模式匹配 | **FTS5 BM25 + 向量** |
| 类型安全 | 无 | **Zod Schema** |
| 向量嵌入 | 未实现 | **Ollama 集成** |
| 知识图谱 | 仅创建节点 | **NER + 关系推理** |
| 学习层 | 空表 | **NLP 增强** |
| 会话管理 | 基础 | **上下文压缩** |
| 软删除 | 未实现 | **可恢复删除** |

## 架构

```
src/
├── types/index.ts          # Zod schemas + 类型定义
├── db/database.ts          # SQLite + FTS5 初始化
├── services/
│   ├── store.ts            # 存储服务 (自动去重/分类)
│   ├── search.ts           # 混合搜索 (BM25 + 向量)
│   ├── embedding.ts        # Ollama 向量嵌入
│   ├── learning.ts         # 学习层 (规则提取)
│   ├── session.ts          # 会话管理
│   ├── knowledge-graph.ts  # 知识图谱查询
│   ├── ner.ts              # 实体抽取 (NER)
│   ├── inference.ts        # 关系推理引擎
│   ├── nlp.ts              # NLP 增强服务
│   ├── compression.ts      # 上下文压缩
│   └── decay.ts            # 记忆衰减
├── cli/                    # CLI 工具
└── migrate.ts              # 数据迁移脚本
```

## 三层架构

```
┌─────────────────────────────────────────┐
│    L2: 学习层 (Learning Memory)          │
│    learning_rules / user_profile        │
│    功能: NLP 增强、规则提取、智能分类     │
└─────────────────────────────────────────┘
              ↑ 学习事件
┌─────────────────────────────────────────┐
│    L1: 知识层 (Long-term Memory)         │
│    memories / knowledge_graph           │
│    功能: 长期存储、NER、关系推理          │
└─────────────────────────────────────────┘
              ↑ 提升 (importance >= 0.7)
┌─────────────────────────────────────────┐
│    L0: 状态层 (Working Memory)           │
│    sessions / working_memory            │
│    功能: 会话上下文、自动压缩             │
└─────────────────────────────────────────┘
```

## CLI 命令

### 记忆管理

```bash
memory store <content>       # 存储记忆 (自动实体抽取)
memory recall <query>        # 混合搜索
memory get <id>              # 获取单条记忆
memory forget <id>           # 软删除记忆
memory restore <id>          # 恢复已删除记忆
memory stats                 # 统计信息
memory rebuild               # 重建索引
memory decay                 # 衰减分析
```

### 会话管理

```bash
memory session start         # 开始新会话
memory session end           # 结束当前会话 (自动压缩)
memory session status        # 查看会话状态
memory session context       # 查看会话上下文
```

### 学习与推理

```bash
memory learn                 # 分析记忆并提取规则
memory-extract -l 100        # 批量实体抽取
memory-infer                 # 关系推理
memory-classify -l 50        # NLP 智能分类
memory-recommend <id>        # 获取相关推荐
```

### 选项

```bash
# recall 选项
-l, --limit <number>        # 结果数量 (默认: 10)
-t, --type <type>           # 按类型过滤
--tags <tags>               # 按标签过滤

# store 选项
-t, --type <type>           # 记忆类型 (decision/pattern/preference/note)
--tags <tags>               # 标签 (逗号分隔)

# forget 选项
-p, --permanent             # 永久删除 (不可恢复)

# decay 选项
--dry-run                   # 查看将被归档的记忆
--archive                   # 归档低权重记忆
```

## 实体抽取 (NER)

系统自动从记忆内容中识别实体：

| 实体类型 | 匹配模式 |
|----------|----------|
| entity | React, Vue, TypeScript, Docker, GitHub... |
| concept | 架构, 测试, 性能, 安全... |
| decision | 决策: xxx, 决定采用 xxx |
| pattern | 规则: xxx, 流程: xxx |

```bash
# 批量抽取
~/.opencode/bin/memory-extract -l 100

# 输出示例
🔍 Entity Extraction
Processed: 100 memories
Entities created: 18
Relations created: 0
Total entities: 20
Total relations: 0

By Type:
  concept: 9
  entity: 9
  decision: 2
```

## 关系推理引擎

自动推断实体间关系：

| 推理类型 | 示例 |
|----------|------|
| 传递推理 | A→B, B→C ⇒ A→C |
| 同义推理 | 名称相似度匹配 |
| 领域推理 | 同技术栈实体关联 |

```bash
~/.opencode/bin/memory-infer

# 输出示例
🔮 Relation Inference
Inferred relations applied: 11
Total nodes: 20
Total edges: 11
Avg connectivity: 7.95

Top Entities:
  API: 26 connections
  工具: 18 connections
  规则: 13 connections
```

## NLP 增强学习

智能分类和规则提取：

```bash
~/.opencode/bin/memory-classify -l 50

# 输出示例
🏷️ Memory Classification
Processed: 50
Updated: 12
```

- **LLM 分类**: 使用 GPT-3.5 进行智能分类 (需配置 API Key)
- **规则提取**: 从决策/规则模式中提取学习规则
- **标签生成**: 自动提取技术栈标签

## 上下文压缩

长会话自动压缩保留关键信息：

- 保留高重要性记忆 (importance >= 0.7)
- 保留最近 N 条记忆
- 生成会话摘要
- 提取关键决策和规则

## 记忆衰减机制

基于访问频率和时间衰减：

```
weight = typeWeight × decayFactor × accessBoost

where:
- typeWeight: 按类型权重 (decision=1.5, pattern=1.3, preference=1.2)
- decayFactor: 0.5^(daysSinceAccess / halfLifeDays)
- accessBoost: 1 + log10(1 + accessCount) × 0.2
```

## 向量搜索配置

在 `config.yaml` 中配置 Ollama：

```yaml
memory:
  ollamaUrl: http://localhost:11434
  embeddingModel: nomic-embed-text
  embeddingDimension: 768
  hybridSearchWeights:
    vector: 0.7
    bm25: 0.3
```

## 数据统计

| 指标 | 值 |
|------|-----|
| 总记忆数 | 602 |
| 嵌入覆盖率 | 99.8% |
| 学习规则 | 6 条 |
| 知识节点 | 20 个 |
| 知识边 | 11 条 |
| 向量维度 | 768 |

## 性能

- 检索延迟: < 50ms (SQLite 本地)
- FTS5 索引: BM25 真正全文搜索
- 向量缓存: 1000 条 LRU 缓存
- 存储容量: 无限制 (SQLite 支持 TB 级)

## 开发

```bash
# 安装依赖
npm install

# 类型检查
npm run typecheck

# 构建
npm run build

# 测试
npm run test
```

## 参考

- xMemory (ICML 2026)
- TAME框架
- Mem0自动回忆机制
- Hindsight长期记忆存储
- NOVA结构化记忆

## License

MIT