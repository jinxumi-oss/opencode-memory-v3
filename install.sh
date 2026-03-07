#!/bin/bash
# OpenCode Memory System 安装脚本

set -e

echo "=========================================="
echo "  OpenCode Memory System v3.0 安装"
echo "=========================================="
echo ""

# 检查依赖
echo "检查依赖..."
if ! command -v sqlite3 &> /dev/null; then
    echo "错误: 需要安装 sqlite3"
    echo "Ubuntu/Debian: sudo apt-get install sqlite3"
    echo "macOS: brew install sqlite"
    exit 1
fi

if ! command -v bc &> /dev/null; then
    echo "警告: 建议安装 bc 用于高级计算"
fi

echo "✓ 依赖检查通过"
echo ""

# 创建目录
echo "创建目录..."
INSTALL_DIR="$HOME/.opencode"
mkdir -p "$INSTALL_DIR/bin"
mkdir -p "$INSTALL_DIR/memory"
mkdir -p "$INSTALL_DIR/backup"

echo "✓ 目录创建完成"
echo ""

# 复制工具
echo "安装工具..."
cp bin/* "$INSTALL_DIR/bin/"
chmod +x "$INSTALL_DIR/bin/"*

echo "✓ 工具安装完成"
echo ""

# 初始化数据库
echo "初始化数据库..."
sqlite3 "$INSTALL_DIR/memory/memory.db" < memory/schema_v3.sql 2>/dev/null || true

echo "✓ 数据库初始化完成"
echo ""

# 复制文档
echo "复制文档..."
cp memory/README.md "$INSTALL_DIR/memory/" 2>/dev/null || true
cp memory/SOUL.md "$INSTALL_DIR/memory/" 2>/dev/null || true
cp memory/USER.md "$INSTALL_DIR/memory/" 2>/dev/null || true
cp memory/TOOLS.md "$INSTALL_DIR/memory/" 2>/dev/null || true

echo "✓ 文档复制完成"
echo ""

# 添加到 PATH
echo "配置环境变量..."
if ! grep -q 'export PATH="$HOME/.opencode/bin:$PATH"' "$HOME/.bashrc"; then
    echo 'export PATH="$HOME/.opencode/bin:$PATH"' >> "$HOME/.bashrc"
    echo "✓ 已添加到 ~/.bashrc"
else
    echo "✓ 已存在于 ~/.bashrc"
fi

echo ""
echo "=========================================="
echo "  安装完成！"
echo "=========================================="
echo ""
echo "使用方法:"
echo "  1. 重新加载配置: source ~/.bashrc"
echo "  2. 开始会话: session start"
echo "  3. 存储记忆: working-memory \"内容\" --importance 0.8"
echo "  4. 检索记忆: memory-recall-enhanced \"关键词\""
echo "  5. 查看统计: memory-stats"
echo ""
echo "测试系统: test-architecture"
echo ""