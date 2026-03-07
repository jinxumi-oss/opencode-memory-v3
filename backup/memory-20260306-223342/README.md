# Timeline Memory System

6层时序记忆系统，为 OpenCode 提供持久化记忆能力。

## 架构

| 层级 | 模块 | 职责 |
|------|------|------|
| L0 | l0-linear.ts | 线性底座（追加写入） |
| L1 | l1-chunking.ts | 分块锚定（块管理） |
| L2 | l2-index.ts | 索引调度（向量检索） |
| L3 | l3-tiers.ts | 分层聚合（热/温/冷/隔离） |
| L4 | l4-dedup.ts | 参数校验（去重） |
| L5 | timeline-memory.ts | API 接口（工具注册） |

## 使用

### OpenCode 工具

- `memory_store` - 存储记忆
- `memory_recall` - 检索记忆
- `memory_forget` - 遗忘记忆

### CLI 命令

```bash
~/.opencode/bin/memory.sh stats    # 统计信息
~/.opencode/bin/memory.sh list     # 列出记忆
~/.opencode/bin/memory.sh recall <query>  # 搜索
```

## 数据存储

- **线性记忆**: `~/.opencode/memory/timeline/YYYY-MM-DD.md`
- **索引数据**: `~/.opencode/memory/memory.db`

## 依赖

- SQLite (bun:sqlite)
- Ollama + nomic-embed-text（可选，用于向量检索）

## 安装 Ollama

```bash
curl -fsSL https://ollama.com/install.sh | sh
ollama pull nomic-embed-text
```