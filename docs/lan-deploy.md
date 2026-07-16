# 局域网部署指南

把 Patent Search 系统部署到你电脑上，让单位内网同事通过浏览器访问。

**目标**：同事输入 `http://192.168.184.29` 即可使用，不用输端口号，你关掉窗口服务还在跑。

---

## 一次性准备（约 10 分钟）

### 1. 下载 Nginx for Windows

1. 访问 https://nginx.org/en/download.html
2. 下载 **nginx/Windows-1.27.x stable**（zip 格式）
3. 解压到 `D:\nginx\`（路径必须是这个，脚本写死了）
4. 完成后应该有 `D:\nginx\nginx.exe`

### 2. 防火墙放行（管理员 PowerShell）

右键开始菜单 → "终端（管理员）" 或 "PowerShell（管理员）"：

```powershell
cd "D:\Claude Code Files\Project_Patent search system_v1"
.\scripts\open-firewall.ps1
```

会放行 80（Nginx）+ 3001（worker 健康检查），仅对内网 192.168.0.0/16 段开放。

> ⚠️ 如果你们单位是 10.x 或 172.16~31.x 内网，先打开 `scripts/open-firewall.ps1`，把两处 `192.168.0.0/16` 改成对应网段再跑。

### 3. Supabase 加白名单（必须！）

不配这步同事会卡在登录回调。

打开 Supabase Dashboard → **Authentication** → **URL Configuration**：

- **Site URL**：`http://192.168.184.29`
- **Redirect URLs**（追加到现有列表）：
  ```
  http://192.168.184.29/**
  http://localhost:3000/**
  ```

> 两个 URL 都加，是为了让本机和同事都能用。保存。

---

## 日常启动（约 30 秒）

启动 **3 个东西**：PM2（frontend + worker）+ Nginx。顺序无所谓。

### A. 启动 PM2（frontend + worker）

右键 PowerShell（普通权限即可）：

```powershell
cd "D:\Claude Code Files\Project_Patent search system_v1"
.\scripts\start-pm2.ps1
```

输出会显示 `patent-frontend` 和 `patent-worker` 都是 `online`。

### B. 启动 Nginx

```powershell
cd "D:\Claude Code Files\Project_Patent search system_v1"
.\scripts\nginx-start.ps1
```

输出 `[OK] Nginx 已在 80 端口监听`。

### C. 验证

```powershell
curl http://127.0.0.1/         # 应该 200
curl http://127.0.0.1:3001/health  # 应该 200
```

---

## 同事怎么用

把下面这段贴给同事（替换 `[你的IP]` 为 `192.168.184.29`）：

> **访问地址**：http://192.168.184.29
>
> **管理员账号**（已有）：admin-test@local.invalid / AdminTest123!
>
> **首次使用**：
> 1. 浏览器打开上面地址
> 2. 用管理员账号登录 → 进入"管理后台"
> 3. "用户管理" → "新增用户" 给你自己开个新账号（建议角色选"用户"）
> 4. 退出管理员账号，用你的新账号重新登录
>
> **注意**：
> - 你的电脑必须保持开机
> - 必须和你在同一个内网（同一 WiFi / 同一办公室网段）
> - 不要上传真实涉密专利，本环境数据在云端 Supabase 但 API 走本机

---

## 日常运维速查

| 操作 | 命令 |
|------|------|
| 看进程状态 | `npx pm2 list` |
| 实时监控 | `npx pm2 monit` |
| 看日志（实时） | `npx pm2 logs` |
| 看日志（最近 100 行） | `npx pm2 logs --lines 100 --nostream` |
| 改代码后重载（不中断） | `npx pm2 reload all` |
| 重启 | `npx pm2 restart all` |
| 全部停止 | `npx pm2 stop all` |
| 看 Nginx 错误 | `type D:\nginx\logs\error.log` 或打开 `logs/nginx-error.log` |
| 重载 Nginx（改配置后） | `D:\nginx\nginx.exe -s reload` |
| 停 Nginx | `.\scripts\nginx-stop.ps1` |

---

## 开机自启（强烈建议配）

PM2 自启（管理员 PowerShell 跑一次）：
```powershell
schtasks /Create /TN "PatentSearch-PM2-Resurrect" /TR "cmd.exe /c npx -y pm2 resurrect" /SC ONLOGON /RL HIGHEST /F
```

Nginx 自启（**Win+R 运行框**输入 `shell:startup` 回车，会打开启动文件夹）：
1. 资源管理器地址栏输入 `shell:startup` 回车（或 `Win+R` → `shell:startup` → 回车）
2. 在打开的文件夹里右键 → 新建快捷方式
3. 目标：`D:\nginx\nginx.exe`
4. 名称：`Patent Search Nginx`

或者一行 PowerShell（普通权限）：
```powershell
$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut("$env:APPDATA\Microsoft\Windows\Start Menu\Programs\Startup\Patent Search Nginx.lnk")
$shortcut.TargetPath = "D:\nginx\nginx.exe"
$shortcut.WorkingDirectory = "D:\nginx"
$shortcut.Save()
```

---

## 你改代码之后

```powershell
cd "D:\Claude Code Files\Project_Patent search system_v1"

# 1. 重新编译
npm run build
cd worker
npm run build
cd ..

# 2. 重载（不中断）
npx pm2 reload all
```

---

## 故障排查

| 现象 | 原因 | 解决 |
|------|------|------|
| 同事访问报 502 Bad Gateway | PM2 没起 / Next.js 没编译 | `npx pm2 list` 看状态；`npx pm2 logs patent-frontend` 看报错 |
| 同事访问报 504 Gateway Timeout | 上传大文件超时 | nginx.conf 里已有 600s，再大就改 `proxy_read_timeout` |
| 同事能打开登录页但登录回调报错 | Supabase 白名单没加 | 回到 Step 3 |
| 同事访问被 Windows 拦截 | 防火墙没放行 | 重跑 `open-firewall.ps1`（管理员） |
| 本机能访问但 LAN IP 访问被拒 | 网络是 Public profile，规则只放行 Private | 管理员跑：`netsh advfirewall firewall set rule name="Patent Search - HTTP 80" new profile=any`（3001 同理） |
| PM2 启动后立刻 errored out | worker 没编译 | `cd worker && npm run build` 再 `npx pm2 restart patent-worker` |
| Nginx 起不来报 "bind" 错误 | 80 端口被占 | `netstat -ano \| findstr :80` 找占用进程，停掉 |
| 同事说"很慢" | 上传大文件没走静态缓存 | 确认 nginx.conf 里 `/_next/static` 块存在并生效 |

---

## 数据备份

导出报告用管理员账号的"批量导出"功能（你刚做完的新功能），Markdown 格式直接下载。如果要备份数据库，去 Supabase Dashboard → Settings → Database → Backups。

---

## 目录结构速查

```
D:\Claude Code Files\Project_Patent search system_v1\
├── pm2.config.js              # PM2 进程定义
├── logs/                       # frontend + nginx 日志
│   ├── pm2-frontend.out.log
│   └── nginx-access.log
├── worker/
│   ├── logs/                   # worker 日志
│   └── dist/                   # 编译产物
├── scripts/
│   ├── start-pm2.ps1
│   ├── nginx-start.ps1
│   ├── nginx-stop.ps1
│   ├── open-firewall.ps1
│   └── nginx.conf
└── .next/                      # Next.js 编译产物

D:\nginx\
├── nginx.exe
└── conf/conf.d/patent.conf     # 由 nginx-start.ps1 自动写入
```

---

## 不需要做的

- ❌ 不需要再跑 `npm run dev`（PM2 跑的是 `next start`，是生产模式）
- ❌ 不需要管理员账号才能启动 PM2（Nginx 也只需普通权限）
- ❌ 不需要每天重启服务（PM2 自动守护）