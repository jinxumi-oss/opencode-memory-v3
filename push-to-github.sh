#!/bin/bash
# OpenCode Memory System - GitHub 推送脚本

echo "=========================================="
echo "  推送 OpenCode Memory System 到 GitHub"
echo "=========================================="
echo ""

# 配置 Git
git config user.name "OpenCode User"
git config user.email "user@opencode.ai"

echo "步骤 1: 在 GitHub 创建新仓库"
echo "----------------------------------------"
echo "请访问: https://github.com/new"
echo "仓库名: opencode-memory-system"
echo "描述: Three-layer Memory System for AI Agents"
echo "类型: Public 或 Private"
echo "不要初始化 README、.gitignore 或 license"
echo ""
read -p "创建完成后按 Enter 继续..."

echo ""
echo "步骤 2: 添加远程仓库"
echo "----------------------------------------"
echo "请输入您的 GitHub 用户名 (默认: JinxuMI):"
read -r USERNAME
USERNAME=${USERNAME:-JinxuMI}

REPO_URL="https://github.com/$USERNAME/opencode-memory-system.git"
echo "远程仓库: $REPO_URL"

git remote add origin "$REPO_URL" 2>/dev/null || git remote set-url origin "$REPO_URL"

echo ""
echo "步骤 3: 推送到 GitHub"
echo "----------------------------------------"
echo "正在推送..."
git branch -M main
git push -u origin main

echo ""
echo "=========================================="
echo "  推送完成！"
echo "=========================================="
echo ""
echo "仓库地址: https://github.com/$USERNAME/opencode-memory-system"
echo ""
echo "其他人可以克隆："
echo "  git clone https://github.com/$USERNAME/opencode-memory-system.git"
echo "  cd opencode-memory-system"
echo "  ./install.sh"