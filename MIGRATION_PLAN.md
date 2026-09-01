# 迁移计划：official-website → ecustesports

## 项目概况

### official-website（源项目）
- **技术栈**：React 18 + Vite + React Router + Tailwind CSS
- **主要功能**：
  - 用户认证系统（队长登录）
  - 队长中心（提交对战请求、查看提交记录）
  - 管理后台（赛程管理、对阵图管理、公告管理、提交审核）
  - 公开页面（首页、新闻、赛程查询、对阵图、联系我们）
  - 游戏专题页面（LOL、CS2、Valorant、守望先锋）

### ecustesports（目标项目）
- **技术栈**：Next.js 16 + React 19 + Tailwind CSS 4 + TypeScript
- **已有功能**：
  - 完整的赛事管理系统（报名、赛程、对阵图、BP工具）
  - 数据层抽象（支持本地JSON和Supabase）
  - 管理后台（/admin）
  - 基础页面（首页、赛事列表、联系我们、新闻）
  - 暖色调设计系统（米色背景、红色强调、网格纹理）

## 架构差异分析

### 1. 路由系统
- **源**：React Router（客户端路由）
- **目标**：Next.js App Router（文件系统路由）
- **迁移策略**：将页面组件迁移到 `src/app` 对应路径

### 2. 数据获取
- **源**：axios + localStorage token + Context API
- **目标**：Server Components + data-store 抽象层
- **迁移策略**：
  - 将 API 调用适配到 ecustesports 的 data-store
  - 认证改用 Next.js 中间件或 Server Actions
  - 保留必要的 Client Components 用于交互

### 3. 样式系统
- **源**：Tailwind CSS 3 + 蓝色主题
- **目标**：Tailwind CSS 4 + 暖色调主题（米色/红色）
- **迁移策略**：复用 ecustesports 的设计 tokens 和组件库

### 4. 状态管理
- **源**：AuthContext（React Context）
- **目标**：需要适配为 Next.js 模式
- **迁移策略**：使用 Server Components + Client Components 混合模式

## 迁移优先级

### 阶段 1：基础设施（已部分完成）
- [x] 基础页面路由已存在
- [ ] 适配认证系统到 Next.js
- [ ] 创建共享的 UI 组件库

### 阶段 2：核心功能页面
1. **新闻系统**（NewsPage 已存在，需增强）
   - 新闻列表页（/news）✓ 已存在
   - 新闻详情页（/news/[id]）需创建
   
2. **游戏专题页面**
   - 统一入口：/[game] 已存在
   - 需添加：LOL、CS2、Valorant、OW 的内容

3. **联系我们**
   - /contact 已存在，需检查功能完整性

### 阶段 3：用户认证与队长中心
1. **登录系统**
   - /login 已存在，需适配 API
   
2. **队长中心**（DashboardPage）
   - 需创建 /dashboard 页面
   - 功能：查看队伍信息、提交对战请求、查看提交历史

### 阶段 4：管理后台功能
1. **现有功能整合**
   - ecustesports 已有完整的赛事管理后台
   - 需要整合 official-website 的特定功能：
     - 提交审核（SubmissionsAdmin）
     - 公告管理（AnnouncementAdmin）

### 阶段 5：赛程与对阵图
- /schedule 已存在
- /bracket 已存在
- 需确保与 official-website 的功能对等

## 需要创建/迁移的文件

### 新增页面
```
src/app/
  news/[id]/page.tsx          # 新闻详情页
  dashboard/page.tsx          # 队长中心
  dashboard/layout.tsx        # 队长中心布局（需认证）
```

### 新增组件
```
src/components/
  auth/
    AuthProvider.tsx          # 认证上下文（Client Component）
    LoginForm.tsx            # 登录表单
  dashboard/
    TeamInfo.tsx             # 队伍信息卡片
    MatchRequestForm.tsx     # 对战请求表单
    SubmissionList.tsx       # 提交记录列表
  news/
    NewsCard.tsx             # 新闻卡片
    NewsDetail.tsx           # 新闻详情
```

### API 适配
```
src/lib/
  api-client.ts              # 统一的 API 客户端
  auth.ts                    # 认证相关函数
```

## 设计系统对比

### official-website（蓝色系）
```css
主色：#1e3a8a (蓝色)
强调色：#3b82f6 (亮蓝)
背景：渐变蓝色
```

### ecustesports（暖色系）✓ 目标样式
```css
背景：#ece8df (米色纸张)
主色：#ff4655 (红色)
文字：#0f1923 (深墨色)
纹理：48px 网格
```

## 数据流迁移

### 源项目 API 端点
```javascript
/api/auth/login              → 需适配
/api/auth/register           → 需适配
/api/schedules               → 已有对应功能
/api/announcements           → 需整合到内容管理
/api/bracket                 → 已有对应功能
/api/match-requests          → 需添加
/api/submissions             → 需添加
```

### 目标数据层
- 使用 `data-store.ts` 抽象层
- 本地开发：JSON 文件
- 生产环境：Supabase

## 行动计划

### Week 1: 基础设施
- [ ] 创建认证系统适配层
- [ ] 创建 API 客户端封装
- [ ] 创建共享 UI 组件

### Week 2: 核心页面
- [ ] 完善新闻系统（列表+详情）
- [ ] 迁移游戏专题页面
- [ ] 检查联系我们页面

### Week 3: 用户功能
- [ ] 适配登录系统
- [ ] 创建队长中心
- [ ] 实现对战请求和提交功能

### Week 4: 管理功能
- [ ] 整合提交审核功能
- [ ] 整合公告管理
- [ ] 测试完整流程

## 技术注意事项

1. **Server vs Client Components**
   - 数据获取优先使用 Server Components
   - 需要交互的部分使用 `'use client'`
   - 认证状态可能需要 Client Component

2. **数据重新验证**
   - 使用 `revalidate` 配置缓存策略
   - 管理后台操作后需要 `revalidatePath`

3. **TypeScript 迁移**
   - 所有新代码使用 TypeScript
   - 定义清晰的类型接口

4. **样式一致性**
   - 完全采用 ecustesports 的设计系统
   - 不保留蓝色主题
   - 使用现有的 CSS 变量和组件

## 风险与挑战

1. **认证系统改造**
   - localStorage token → Next.js 认证方案
   - 需要考虑 SSR 的兼容性

2. **API 兼容性**
   - 后端 API 是否需要修改
   - 数据结构是否一致

3. **功能对等性**
   - 确保迁移后功能不缺失
   - 需要详细的功能对比清单

## 验收标准

- [ ] 所有页面正常访问
- [ ] 用户登录/登出功能正常
- [ ] 队长中心所有功能可用
- [ ] 管理后台功能完整
- [ ] 样式完全符合 ecustesports 设计系统
- [ ] 响应式设计在移动端正常
- [ ] TypeScript 无类型错误
- [ ] 构建无警告
