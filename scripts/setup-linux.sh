#!/bin/bash
# setup-linux.sh — 专利检索系统 Linux 一键部署脚本
# 在银河麒麟 / Ubuntu / Debian 上运行
# 用法：chmod +x setup-linux.sh && ./setup-linux.sh

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

info()  { echo -e "${GREEN}[OK]${NC} $1"; }
warn()  { echo -e "${YELLOW}[>>]${NC} $1"; }
error() { echo -e "${RED}[!!]${NC} $1"; }

echo "============================================"
echo "  专利检索系统 — Linux 一键部署"
echo "============================================"
echo ""

# =============================================
# 1. 检查是否在项目根目录
# =============================================
if [ ! -f "package.json" ] || [ ! -d "worker" ]; then
    error "请在项目根目录下运行此脚本（包含 package.json 和 worker/ 的目录）"
    exit 1
fi

PROJECT_DIR="$(pwd)"
info "项目目录: $PROJECT_DIR"

# =============================================
# 2. 检查 Node.js
# =============================================
if ! command -v node &> /dev/null; then
    error "未找到 Node.js，请先安装 Node.js 20+"
    exit 1
fi
NODE_VER=$(node -v)
info "Node.js: $NODE_VER"

# =============================================
# 3. 安装编译工具（ARM 架构可能需要）
# =============================================
warn "检查编译工具..."
ARCH=$(uname -m)
info "CPU 架构: $ARCH"

if ! command -v make &> /dev/null || ! command -v gcc &> /dev/null; then
    warn "安装 build-essential（编译 native 模块需要）..."
    sudo apt-get update -qq
    sudo apt-get install -y -qq build-essential python3
    info "编译工具已安装"
else
    info "编译工具已就绪"
fi

# =============================================
# 4. 安装 PM2
# =============================================
if ! command -v pm2 &> /dev/null; then
    warn "安装 PM2..."
    npm install -g pm2
    info "PM2 已安装"
else
    info "PM2 已安装: $(pm2 -v)"
fi

# =============================================
# 5. 创建 .env.local（如果不存在）
# =============================================
if [ ! -f ".env.local" ]; then
    warn ".env.local 不存在，需要创建"
    echo ""
    echo "请输入以下 Supabase 配置信息（从你的 Windows 电脑 .env.local 复制）："
    echo ""
    read -p "NEXT_PUBLIC_SUPABASE_URL: " SUPABASE_URL
    read -p "NEXT_PUBLIC_SUPABASE_ANON_KEY: " ANON_KEY
    read -p "SUPABASE_SERVICE_ROLE_KEY: " SERVICE_KEY
    read -p "DATABASE_URL (直接回车跳过): " DB_URL

    cat > .env.local << ENVEOF
NEXT_PUBLIC_SUPABASE_URL=${SUPABASE_URL}
NEXT_PUBLIC_SUPABASE_ANON_KEY=${ANON_KEY}
SUPABASE_SERVICE_ROLE_KEY=${SERVICE_KEY}
DATABASE_URL=${DB_URL}
ENVEOF
    info ".env.local 已创建"
else
    info ".env.local 已存在，跳过"
fi

# Worker 也需要 .env
if [ ! -f "worker/.env" ]; then
    cp .env.local worker/.env
    info "worker/.env 已创建（从 .env.local 复制）"
fi

# =============================================
# 6. 安装 npm 依赖
# =============================================
warn "安装前端依赖..."
npm install --no-audit --no-fund
info "前端依赖安装完成"

warn "安装 worker 依赖..."
cd worker
npm install --no-audit --no-fund
cd ..
info "worker 依赖安装完成"

# =============================================
# 7. 构建项目
# =============================================
warn "构建前端（next build）..."
npm run build
info "前端构建完成"

warn "构建 worker（tsc）..."
cd worker
npm run build
cd ..
info "worker 构建完成"

# =============================================
# 8. 创建日志目录
# =============================================
mkdir -p logs worker/logs
info "日志目录已创建"

# =============================================
# 9. 停止旧进程（如果有）
# =============================================
pm2 delete patent-frontend 2>/dev/null || true
pm2 delete patent-worker 2>/dev/null || true

# =============================================
# 10. 启动 PM2
# =============================================
warn "启动服务..."
pm2 start pm2.config.linux.js
pm2 save
info "服务已启动"

# 等几秒检查状态
sleep 3
pm2 list

# =============================================
# 11. 配置防火墙
# =============================================
if command -v ufw &> /dev/null; then
    warn "配置防火墙（放行 3000 和 3001 端口）..."
    sudo ufw allow 3000/tcp comment '专利检索-前端' 2>/dev/null || true
    sudo ufw allow 3001/tcp comment '专利检索-Worker' 2>/dev/null || true
    info "防火墙已配置"
elif command -v firewall-cmd &> /dev/null; then
    warn "配置 firewalld..."
    sudo firewall-cmd --permanent --add-port=3000/tcp 2>/dev/null || true
    sudo firewall-cmd --permanent --add-port=3001/tcp 2>/dev/null || true
    sudo firewall-cmd --reload 2>/dev/null || true
    info "防火墙已配置"
else
    warn "未检测到防火墙，请手动放行 3000/3001 端口"
fi

# =============================================
# 12. 设置 PM2 开机自启
# =============================================
warn "设置 PM2 开机自启..."
pm2 startup systemd -u "$USER" 2>/dev/null || pm2 startup 2>/dev/null || true
info "PM2 开机自启已配置（如失败请手动执行 pm2 startup 并按提示操作）"

# =============================================
# 13. 验证
# =============================================
echo ""
echo "============================================"
info "部署完成！"
echo "============================================"
echo ""

# 获取本机 IP
LOCAL_IP=$(ip addr show | grep "inet " | grep -v 127.0.0.1 | awk '{print $2}' | cut -d/ -f1 | head -1)
if [ -z "$LOCAL_IP" ]; then
    LOCAL_IP="<你的IP>"
fi

echo "  访问地址: http://${LOCAL_IP}:3000"
echo "  Worker 健康检查: http://${LOCAL_IP}:3001/health"
echo ""
echo "  常用命令:"
echo "    pm2 list         查看进程状态"
echo "    pm2 logs         查看日志（实时）"
echo "    pm2 restart all  重启所有服务"
echo "    pm2 stop all     停止所有服务"
echo ""
echo "  代码更新后重新部署:"
echo "    git pull"
echo "    npm run build && cd worker && npm run build && cd .."
echo "    pm2 reload all"
echo ""
echo "  ⚠️  别忘了去 Supabase 后台把 Site URL 改成:"
echo "      http://${LOCAL_IP}:3000"
echo "    （Authentication → URL Configuration → Site URL）"
echo ""