# filename: README.md

# DeepSeek 语句工坊

一个离线可用、加密存储的语句 / 提示词管理工具。零构建、零依赖、纯静态。

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)

---

## 一、项目简介

**DeepSeek 语句工坊** 是一个完全运行在浏览器端的轻量级语句管理工具，用于收集、整理、分类和复用日常使用的高频提示词、代码片段、常用语句。

所有数据使用 **AES-256-GCM** 加密后写入浏览器本地存储，**不依赖任何后端服务，不上传任何数据到服务器**。整个应用零构建、零 npm 依赖，`git push` 即完成部署。

### 核心特征

- **端到端加密**：PBKDF2 派生密钥 + AES-256-GCM 认证加密，所有数据在写入 localStorage 之前完成加密
- **命令-查询分离架构**：单一数据源 + 单向数据流，所有状态变更必须通过 `commands/` 层的纯函数
- **原生 ES Modules**：零构建、零打包器、零转译，直接由浏览器加载
- **离线优先**：首次访问后可完全离线使用（除 Font Awesome 图标外，无任何外部资源依赖）
- **多标签管理**：拖拽排序、双击改名、色点标识、计数徽章
- **智能搜索**：关键词 AND 匹配、正则模式、本地 / 全局作用域切换、命中高亮、**拼音首字母搜索**
- **拼音首字母搜索**：数据由《通用规范汉字表.xlsx》生成，源码零硬编码；搜索 `zfb` 可命中「支付宝」
- **批量操作**：全选、批量删除、批量移动到指定标签
- **导入导出**：完整 JSON 备份、旧格式智能导入
- **滚动位置记忆**：按标签 / 全局上下文独立记忆主列表滚动位置
- **UI 状态持久化**：侧边栏展开状态、搜索关键词、正则开关等全部跨会话保留
- **长文本优雅显示**：卡片默认两行截断，鼠标悬停时浮层显示全文，不改变列表布局

---

## 二、快速开始

### 环境要求

- 任意现代浏览器（Chrome 100+ / Edge 100+ / Firefox 100+ / Safari 16+）
- 一个本地 HTTP 服务（ESM 不支持 `file://` 协议）

### 本地运行

由于 ES Modules 不支持 `file://` 协议直接加载，需要通过 HTTP 服务启动：

方式一：Python 内置服务器

```bash
python3 -m http.server 8080
```

方式二：Node.js

```bash
npx serve
```

方式三：VS Code Live Server 插件

在 VS Code 中打开项目，右键 `index.html` → **Open with Live Server**。

启动后浏览器访问：

```
http://localhost:8080
```

### 部署到静态托管

本项目为纯静态站点，可直接部署到任意静态托管平台：

- **GitHub Pages**：仓库内置 `.github/workflows/pages.yml`，推送到 `main` 分支即自动部署
- **Netlify / Vercel / Cloudflare Pages**：连接 Git 仓库，构建命令留空，发布目录设置为 `/`
- **自建服务器**：直接上传整个目录到 Nginx / Apache 的静态目录即可

> 部署到子路径时无需额外配置，因为所有资源路径均使用相对路径（`./src/...`、`./styles/...`）。

### 拼音字典维护（首次使用必读）

本项目内置的 `src/utils/pinyin-data.js` 为**初始占位版本**，只包含极少量汉字。要启用完整的拼音首字母搜索，需要从《通用规范汉字表.xlsx》生成完整数据。

**准备**：确认 `scripts/data/通用规范汉字表.xlsx` 已就位。

**一键生成**：双击项目根目录的 `拼音字典库维护.bat`，按提示完成「生成 → 校验 → 清理」。

**手动生成**：

```bash
cd scripts/tools
npm install --no-save xlsx
node generate-pinyin-data.js
node check-dict-gaps.js
```

生成成功后，`src/utils/pinyin-data.js` 将包含约 8105 个汉字，搜索 `zfb` 即可命中「支付宝」。

> 回滚方法：`copy /y src\utils\pinyin-data.js.bak src\utils\pinyin-data.js`

---

## 三、使用指南

### 3.1 添加语句

在页面底部输入框内输入语句内容，按 `Enter` 或点击「添加」按钮即可加入当前标签。

> 当前标签下已存在相同文本时会被拒绝，并给出提示。

### 3.2 编辑语句

- **双击卡片**：直接进入编辑模式
- **点击编辑图标**：同样进入编辑模式
- 编辑框内按 `Ctrl+Enter` 或点击「保存」提交，按 `Esc` 取消

### 3.3 复制语句

- 点击卡片上的复制图标 → 内容写入剪贴板，同时累加该语句的复制计数
- 在默认语库中，语句会按**复制次数降序排列**（越常用越靠前）

### 3.4 查看长文本全文

语句卡片默认只显示**前两行**，超出部分自动截断（移动端为前 3 行）。

- **鼠标悬停**在卡片文本上约 0.25 秒 → 浮层显示完整内容
- 浮层位置自动适配视口：优先显示在卡片下方，下方空间不足时翻到上方
- 移开鼠标约 0.12 秒后自动隐藏
- 短文本（未溢出两行）不会触发浮层
- 触屏设备无 hover 语义，不启用浮层；但移动端放宽为 3 行，已能显示更多内容

### 3.5 组织语句

| 操作 | 入口 | 说明 |
|---|---|---|
| 复制到其他标签 | 卡片上的分享图标 | 保留原语句，在目标标签创建副本 |
| 添加到默认语库 | 卡片上的星标图标 | 快速把非默认标签的语句收藏到默认语库 |
| 批量移动到标签 | 底部批量操作栏 | 支持一次移动多条到同一目标标签 |
| 批量删除 | 底部批量操作栏 | 需二次确认，显示前 3 条预览 |
| 拖拽排序 | 卡片本身 | 仅当前标签非默认、非搜索状态下可用 |

### 3.6 标签管理

- **新建标签**：点击侧边栏底部「新建标签」按钮
- **编辑标签**：双击标签项（默认语库不可编辑）
- **删除标签**：点击标签项右侧的 × 图标（默认语库不可删除）
- **拖拽排序**：拖动标签项本身（默认语库固定首位）

### 3.7 搜索

- **关键词 AND 匹配**：空格分隔的多个关键词需全部命中
- **拼音首字母搜索**：输入纯 ASCII 关键词时，除字面匹配外还会尝试整段文本的拼音首字母子串匹配
  - 例：搜索 `zfb` 可命中「支付宝」
  - 例：搜索 `qbwyg` 可命中「请帮我写一个...」
  - 中文查询会优先走字面匹配，零首字母计算开销
- **正则模式**：点击搜索框内的 `*` 图标开启
- **作用域切换**：
  - 图标为 🏷️ 时：仅搜索当前标签
  - 图标为 🌐 时：搜索所有标签（命中结果显示所属标签彩色徽章）
- **清除搜索**：点击搜索框右侧的 × 图标，或按 `Esc`

### 3.8 导入 / 导出

- **导出全局**：生成完整 JSON 备份，文件名包含时间戳与统计信息
- **导入全局**：覆盖式导入，导入前二次确认
- **导入旧档**：兼容旧版数组格式，可追加到当前标签

---

## 四、键盘快捷键

| 快捷键 | 功能 |
|---|---|
| `Ctrl / Cmd + K` | 聚焦搜索框 |
| `Ctrl / Cmd + /` | 聚焦新建语句输入框 |
| `Esc` | 优先关闭弹窗；无弹窗时清空搜索并让输入框失焦 |
| `Delete` | 删除已勾选的语句（需先勾选） |
| `Ctrl + Enter` | 编辑模态框内提交保存 |
| `Enter` | 底部输入框内快速添加语句 |

> 说明：原 `Ctrl + N` 与浏览器「新建窗口」快捷键冲突，无法被页面阻止，因此改用无冲突的 `Ctrl + /`。

---

## 五、数据安全

### 5.1 加密方案

| 项目 | 实现 |
|---|---|
| 对称加密算法 | AES-256-GCM（认证加密，防篡改） |
| 密钥派生函数 | PBKDF2-SHA256 |
| 迭代次数 | 100,000 |
| 密钥长度 | 256 位 |
| 初始向量（IV） | 12 字节随机数，每次加密重新生成 |
| 存储格式 | `[12 字节 IV][密文 + AuthTag]` 的 Base64 编码 |

### 5.2 存储位置

| 存储介质 | 用途 |
|---|---|
| `localStorage` | 加密后的 Vault 主数据 |
| `sessionStorage` | 滚动位置等瞬态 UI 状态（不含敏感数据） |

### 5.3 隐私保证

- **无网络请求**：除 Font Awesome 图标与 Sortable 拖拽库的 CDN 加载外，无任何外部请求
- **无遥测**：不收集任何使用数据
- **无账号**：不需要注册、登录，数据完全存储在用户浏览器内
- **无后端**：不存在服务器端数据泄露风险

### 5.4 密钥说明

本项目使用**固定盐值 + 固定密码串**通过 PBKDF2 派生密钥，实现 **透明加密**：

- 优点：无需用户记忆密码，打开即用
- 局限：无法抵御拥有浏览器本地存储访问权限的攻击者（例如恶意扩展、物理接触设备）

> 如需抵御上述威胁，可自行修改 `src/constants.js` 中的 `ENCRYPTION_KEY_STRING`，并保管好该字符串。

---

## 六、架构概览

### 6.1 命令-查询分离

整个应用遵循**单一数据源 + 单向数据流**的设计：

- **唯一数据源**：`src/core/facade.js` 中维护的 `currentVault`
- **唯一写入路径**：所有变更必须通过 `dispatch(commandName, payload)` 分发到 `src/commands/` 下的纯函数
- **只读访问**：通过 `query(vault => ...)` 获取视图需要的数据
- **切片订阅**：视图通过 `subscribe('tags' | 'statements' | 'ui', handler)` 订阅变更

**所有命令函数均为纯函数**：输入旧 Vault，输出新 Vault，绝不修改入参。

### 6.2 分层结构

```
┌────────────────────────────────────────────┐
│  views/    视图层（DOM 渲染 + 事件派发）    │
│    ↑ 订阅 slice / ↓ dispatch 命令           │
├────────────────────────────────────────────┤
│  commands/ 命令层（纯函数，业务逻辑）        │
│    ↑ 使用纯查询 / ↓ 通过 facade 更新状态    │
├────────────────────────────────────────────┤
│  core/     核心层                          │
│    · facade.js   —— 状态协调 + 持久化触发   │
│    · vault.js    —— 状态形状 + 纯查询       │
│    · persist.js  —— localStorage 读写       │
│    · crypto.js   —— AES-256-GCM 加解密      │
│    · fa-loader.js —— 图标多级兜底加载       │
├────────────────────────────────────────────┤
│  utils/    工具层（无业务语义）             │
│    · pinyin-data.js —— 汉字→首字母（生成）  │
│    · pinyin.js      —— 首字母查询逻辑       │
└────────────────────────────────────────────┘
```

### 6.3 持久化策略

命令可通过 `persistMode` 指定持久化行为：

| 模式 | 说明 | 适用场景 |
|---|---|---|
| `immediate`（默认）| 命令执行后立即加密写入 localStorage | 增删改等关键操作 |
| `debounced` | 400ms 防抖写入 | 搜索输入、滚动等高频变更 |
| `skip` | 完全不持久化 | 仅瞬态的调试命令 |

**竞态保护**：`persist.js` 内部维护写入队列 + 版本号，避免旧写入覆盖新写入。

### 6.4 拼音字典数据流

```
scripts/data/通用规范汉字表.xlsx              ← 唯一数据源（用户维护）
            │
            ▼
scripts/tools/generate-pinyin-data.js         ← 生成脚本（依赖 xlsx）
            │
            ▼
src/utils/pinyin-data.js                      ← 自动生成（ES Module）
            │
            ▼
src/utils/pinyin.js                           ← 手写逻辑（不硬编码数据）
            │
            ▼
src/commands/search.js                        ← 集成首字母搜索
```

**核心约束**：

- 源码零硬编码：任何 `.js` 文件里不出现汉字拼音数据
- 数据可独立重生成：改 xlsx → 重跑 bat → 数据立即更新
- 数据文件可回滚：首次生成时自动备份为 `pinyin-data.js.bak`

---

## 七、项目目录结构

```
deepseek-statement-workshop/
├── .github/
│   └── workflows/
│       └── pages.yml
├── .gitignore
├── .nojekyll
├── 拼音字典库维护.bat                        ← 根目录一键脚本
├── src/
│   ├── main.js
│   ├── constants.js
│   ├── preset.js
│   ├── shortcuts.js
│   ├── core/
│   │   ├── vault.js
│   │   ├── facade.js
│   │   ├── crypto.js
│   │   ├── persist.js
│   │   └── fa-loader.js
│   ├── commands/
│   │   ├── index.js
│   │   ├── statement-crud.js
│   │   ├── statement-organize.js
│   │   ├── tag-crud.js
│   │   ├── ui-state.js
│   │   └── search.js                       ← 集成首字母搜索
│   ├── utils/
│   │   ├── dom.js
│   │   ├── id.js
│   │   ├── pinyin.js                       ← 手写逻辑，无数据
│   │   └── pinyin-data.js                  ← 自动生成（ES Module 数据）
│   └── views/
│       ├── sidebar.js
│       ├── header.js
│       ├── search-bar.js
│       ├── statement-list.js
│       ├── statement-card.js
│       ├── batch-bar.js
│       ├── add-bar.js
│       ├── toast.js
│       └── modals/
│           ├── confirm.js
│           ├── edit.js
│           ├── tag.js
│           └── select-tag.js
├── scripts/
│   ├── data/
│   │   └── 通用规范汉字表.xlsx              ← 唯一数据源（用户维护）
│   └── tools/
│       ├── README.md                       ← 工具说明
│       ├── generate-pinyin-data.js         ← xlsx → src/utils/pinyin-data.js
│       └── check-dict-gaps.js              ← 校验 pinyin-data.js 对 xlsx 的覆盖率
├── styles/
│   ├── tokens.css
│   ├── base.css
│   ├── layout.css
│   ├── sidebar.css
│   ├── header.css
│   ├── search.css
│   ├── statements.css
│   ├── batch.css
│   ├── modals.css
│   ├── toast.css
│   └── icons.css
├── index.html
├── README.md
├── LICENSE
└── project-directory-tree.txt
```

---

## 八、浏览器兼容性

| 浏览器 | 最低版本 | 说明 |
|---|---|---|
| Chrome | 100+ | 完整支持（推荐）|
| Edge | 100+ | 完整支持（推荐）|
| Firefox | 100+ | 完整支持 |
| Safari | 16+ | 完整支持 |
| Chrome for Android | 100+ | 完整支持 |
| Firefox for Android | 100+ | 完整支持 |
| Safari for iOS | 16+ | 完整支持 |

**关键能力依赖**：

- Web Crypto API（`window.crypto.subtle`）：所有目标浏览器均已支持
- ES Modules：原生支持
- `-webkit-line-clamp`：所有目标浏览器均已支持
- `CSS.escape`：所有目标浏览器均已支持

**降级行为**：

- Web Crypto API 不可用时（如某些旧环境），系统会自动**明文存储**并给出提示。请升级浏览器以保障数据安全。
- 拼音数据表未生成时，首字母搜索不会生效，但字面搜索、正则搜索完全正常。

---

## 九、常见问题

### Q1：启动后页面空白 / 控制台报错

**原因**：通过 `file://` 协议打开 `index.html`，浏览器拒绝加载 ES Modules。

**解决**：改用 HTTP 服务启动（参见「快速开始」章节）。

### Q2：图标不显示

**原因**：Font Awesome 的 CDN 被网络环境屏蔽。

**解决**：

- 项目内置多级 CDN 兜底（bootcdn / baomitu / staticfile / cdnjs），通常会自动切换到可用源
- 若全部失败，图标会短暂缺失但不影响功能；刷新页面可重新尝试加载

### Q3：拼音首字母搜索不生效

**原因**：`src/utils/pinyin-data.js` 还是初始占位版本。

**解决**：双击项目根目录的 `拼音字典库维护.bat`，等待生成完成。生成成功后 `src/utils/pinyin-data.js` 将包含约 8105 字。

**验证方法**：搜索 `zfb`，若命中「支付宝」即为生效。

### Q4：数据丢失 / 找回

**原因**：清空浏览器数据、切换浏览器、使用无痕模式等。

**解决**：

- 定期使用「导出全局」功能备份数据
- 换设备或换浏览器时，通过「导入全局」恢复

### Q5：大量语句后变得卡顿

**原因**：单标签内语句数量过多（> 2000 条）时，DOM 渲染与搜索都会变慢。

**解决**：

- 使用多标签拆分数据
- 避免在默认语库中堆积过多条目
- 未来版本可能引入虚拟滚动

### Q6：如何更换默认语料库？

**解决**：编辑 `src/preset.js` 中的 `getBuiltinPreset()` 返回值即可。首次访问或「重置全局」时会使用该预设。

### Q7：长文本卡片能显示多少内容？

- 桌面端默认显示 2 行，鼠标悬停后浮层展示全文
- 移动端默认显示 3 行（触屏无悬停语义，因此放宽行数）
- 短文本（不超过 2 行）不会触发浮层，无任何多余交互

---

## 十、开发约定

### 10.1 不可妥协的规则

1. **视图层不得直接操作 `currentVault`**：所有状态变更必须通过 `dispatch` 命令
2. **命令函数必须为纯函数**：输入旧 Vault，返回新 Vault，绝不修改入参
3. **不得在 `views/` 层引用 `persist.js`**：持久化由 `facade.js` 统一触发
4. **所有用户可控文本必须转义**：写入 DOM 之前必须经过 `escapeHtml`
5. **常量集中管理**：所有"魔数"必须定义在 `src/constants.js`
6. **拼音数据零硬编码**：任何 `.js` 文件里不出现汉字拼音数据；数据一律由 `scripts/tools/generate-pinyin-data.js` 从 xlsx 生成

### 10.2 代码风格

- 使用 **原生 ES Modules**，不引入任何构建工具
- 所有函数与变量使用完整、语义化的英文命名，不缩写
- 使用 `const` 优先，其次 `let`，避免 `var`
- 大括号采用 **K&R 风格**（左括号不换行）
- 每个文件首行标注 `// filename: <path>`

### 10.3 提交信息规范

```
<type>(<scope>): <subject>

type: feat | fix | refactor | perf | docs | chore
scope: core | commands | views | styles | config
```

---

## 十一、版本历史

### V7.0.0

- **架构**：命令-查询分离（单一数据源 + 单向数据流）
- **加密**：AES-256-GCM + PBKDF2-SHA256（100,000 次迭代）
- **导入导出**：完整 JSON 备份 + 旧格式智能导入
- **搜索**：本地 / 全局作用域切换，正则模式
- **拼音首字母搜索**：数据由《通用规范汉字表.xlsx》生成，源码零硬编码
- **批量操作**：全选 / 批量删除 / 批量移动
- **多标签**：拖拽排序、双击改名、色点标识
- **滚动记忆**：按标签 / 全局上下文独立记忆主列表滚动位置
- **UI 状态持久化**：侧边栏展开状态、搜索状态跨会话保留
- **长文本优雅显示**：卡片默认两行截断，悬停浮层显示全文
- **零构建**：原生 ES Modules，`git push` 即部署

---

## 十二、许可证

本项目采用 [MIT License](./LICENSE) 开源。

---

## 十三、致谢

- 图标：[Font Awesome 6](https://fontawesome.com/)
- 拖拽排序：[Sortable.js](https://sortablejs.github.io/Sortable/)
- 字体：[Inter](https://rsms.me/inter/)
- 拼音数据源：《通用规范汉字表》