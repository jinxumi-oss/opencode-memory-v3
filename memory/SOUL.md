# OpenCode 记忆系统架构定义

## 核心原则

1. **极简** - 2层架构，单一数据源
2. **自动** - 所有操作通过工具完成，无需手动维护
3. **可靠** - 自动去重，软删除可恢复
4. **高效** - 全文搜索，多条件过滤

---

## 记忆类型

| 类型 | 说明 |
|------|------|
| `decision` | 决策记录 |
| `pattern` | 模式/规则 |
| `preference` | 用户偏好 |
| `note` | 普通笔记 |

---

## 工具列表

### memory-store

存储新记忆

```bash
memory-store "内容" --type <类型> --tag <标签>
```

### memory-recall

检索记忆

```bash
memory-recall <查询> [--type <类型>] [--tag <标签>] [--recent <天数>]
```

### memory-forget

删除记忆

```bash
memory-forget <memory-id> [--older <天数>]
```

### memory-stats

统计信息

```bash
memory-stats [--by-type] [--by-tag] [--recent <天数>]
```

---

## 数据结构

- **数据库**: `memory/memory.db`
- **表**: `memories`, `deleted_memories`
- **索引**: `type`, `created_at`, `content_hash`

---

## 自动化特性

1. **自动ID生成** - 时间戳 + 随机数
2. **自动时间戳** - created_at, updated_at
3. **自动去重** - 内容hash检查
4. **自动访问计数** - 检索时更新access_count
5. **软删除** - 移动到deleted_memories表，可恢复

---

## 最佳实践

1. 使用 `--type` 标记记忆类型
2. 使用 `--tag` 添加标签，便于分类
3. 定期使用 `memory-stats` 查看记忆分布
4. 使用 `--older` 定期清理旧记忆