# Gate 7 上线交接（2026-09-01）

> 给彭杰看的交接。详细操作手册见同目录 `Gate7-正式域名与生产环境上线清单.md`，这份是你需要知道的状态摘要和下一步。

## 一、一句话总结

域名 `ecustesports.top` 确认为**真实办赛入口**（不是作品集演示）。我这边已经把所有代码侧准备做完、测试跑通、推到了 GitHub。**剩下的是你在阿里云 / Supabase / Vercel 三个网站上的点击操作**，我按顺序列在下面。

## 二、我这次做了什么

1. **给数据迁移脚本加了「生产初始化」开关**：`--site-only`，作用是只把网站的站点配置（品牌、导航、首页文案）导进生产库，并且自动清空赛事引用，这样**不会把匿名测试赛那 160 人、50 场的数据带过去**。
2. **写了完整操作清单**：`docs/08-MVP开发/Gate7-正式域名与生产环境上线清单.md`，共 8 个阶段，每一步都写成了可照做的动作。
3. **更新了项目记录**：版本记录 3.80、决策日志 D-069、README、开发交接 prompt。
4. **跑通全部校验**：类型检查、ESLint、规则 20/20、完整闭环 100/100、发布 7/7，全绿。
5. **提交并推送到 GitHub**：commit `b569a17`，Vercel 会自动开始新一轮部署。

## 三、现在的状态

| 项 | 状态 |
|---|---|
| 代码 | 已推到 GitHub，Vercel 自动部署中 |
| 生产数据库 | **还没建**（`esports-production` 需要你在 Supabase 新建） |
| 生产环境变量 | **还没配**（8 个，需要你在 Vercel 填） |
| 域名 | **还没绑**（需要你在 Vercel 加域名、阿里云改 DNS） |
| 生产赛事 | **还没建**（第三届华理瓦理杯，等你建完库后新建） |

## 四、你接下来要做的事（按顺序）

**第 1 步｜阿里云确认域名正常**
登录阿里云 → 域名 → `ecustesports.top`，确认状态是「正常」且已完成**实名认证**（.top 域名没实名会被暂停解析）。

**第 2 步｜Supabase 新建生产库**
新建项目 `esports-production`，地域选**新加坡**；执行 SQL（`supabase/migrations/202608280001_gate6_data_store.sql`）；**再手动建一个 `event-assets` 的 Storage bucket，设为 Public**（这步脚本不管，漏了海报传不上去）。

**第 3 步｜本地导入站点配置**（在 PowerShell 里跑，把 `你的项目` 换成真实值）
```powershell
$env:SUPABASE_URL="https://你的生产项目.supabase.co"
$env:SUPABASE_SECRET_KEY="sb_secret_你的key"
npx tsx tools/data/migrate-local-to-supabase.ts --site-only --apply
Remove-Item Env:\SUPABASE_URL
Remove-Item Env:\SUPABASE_SECRET_KEY
```

**第 4 步｜Vercel 配 8 个生产环境变量**
每个都**只勾 Production**。其中 `APP_ORIGIN` 填 `https://ecustesports.top`，`SUPABASE_URL` 和 `SUPABASE_SECRET_KEY` 填生产项目的值。随机值用这条命令生成：
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

**第 5 步｜用 Vercel 生产地址验证干净**
先不绑域名。确认首页**没有任何「第三届瓦理杯 / 疾风战队」的痕迹**，赛事列表为空，新密码能登录、旧 staging 密码登不上。全部通过再往下。

**第 6 步｜绑域名**
Vercel → Settings → Domains → 添加 `ecustesports.top`，选 **nameservers 方式**；把 Vercel 给的两个 `ns*.vercel-dns.com` 填到阿里云的「修改 DNS 服务器」；再加 `www` 重定向到根域名。等几分钟生效。

**第 7 步｜正式域名冒烟**
重点测：`https://ecustesports.top/api/health` 返回 ok、提交一次报名能成功写入（**返回 403 说明 `APP_ORIGIN` 没配对**）、`www` 能自动跳转。

**第 8 步｜新建第三届华理瓦理杯**
工作台 → 新建赛事 → 两步向导。日期先填占位值，**开放报名前在赛事设置里改成真实日期**。

## 五、最容易踩的 3 个坑

1. **顺序不能反**：必须先配好生产环境并验证干净，最后才绑域名。如果 Production 环境变量还指着 staging 就绑域名，正式域名会直接显示匿名测试赛数据。
2. **`APP_ORIGIN` 忘改 = 全部提交 403**：页面看起来正常，但一提交报名/约赛/报分就失败。改完必须重新部署。
3. **`event-assets` bucket 要手动建**：SQL 脚本只建表和限流函数，不含图片空间。

## 六、未决事项

1. **第三届华理瓦理杯的真实起止日期、报名截止日期**——还没定，这是办赛前必须填实的（Gate 0-R 遗留项）。
2. **站外监控**：是接免费监控服务，还是你人工每天看一眼 `/api/health`，还没定。

## 七、一个已知的小问题（不影响使用）

本地 `git status` 会显示 `[gone]`，这只是本地"远程追踪引用"没写进去的显示问题——代码确实已经推到 GitHub（远程 `main` = `b569a17`），Vercel 能正常拉取。下次你或 Codex 在别处 `git pull` 会正常。不用处理。
