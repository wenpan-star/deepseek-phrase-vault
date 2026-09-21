// filename: src/constants.js
// ========================================================================
// DeepSeek 语句工坊 · 全局常量
// 所有"魔数"集中于此，任何模块不得内联硬编码
//
// 【历史调整】
//   1. 新增 MAX_TAG_NAME_LENGTH：标签名称长度上限。
//      供命令层（tag-crud.js）做防御性校验，UI 层（modals/tag.js）
//      的 input maxlength 属性也保持与此一致。
//   2. 删除 STORAGE_KEY_PLAIN_UI：早期设计的明文 UI 状态存储键，
//      最终未采用（UI 状态随 Vault 一起加密），属死代码。
//   3. 删除 SORTABLE_CDN：index.html 中已通过 <script src="...">
//      直接硬编码了 Sortable.js 的 CDN 地址。保留本常量会导致
//      "看起来可以改 CDN，实际改了无效"的误导。统一由 index.html
//      作为唯一来源。
//   4. 新增 STORAGE_KEY_ENCRYPTED_VAULT_BACKUP：
//      当主存储键中存在数据但无法解密时（例如 Web Crypto 变为不可用），
//      把原密文备份到此键，避免后续 save 覆盖导致数据永久丢失。
//      修复点：W3（数据安全）。
//
// 【本次调整 · 8-3 修复】
//   删除 POPOVER_MAX_WIDTH_PX。
//
//   背景：
//     浮层宽度已改为"从 .card-index 左边缘 → .card-actions 左边缘"的
//     实测距离，不再需要 640px 上限截断。该常量已不再被任何模块 import，
//     保留会造成"看起来能改、实际改了无效"的误导。
//
//   POPOVER_MIN_WIDTH_PX 保留：
//     仍在 statement-list.js 的 positionPopover 中作为测量异常时的
//     绝对下限保护。虽然当前 DOM 结构下不会触发，但作为防御性兜底
//     存在，注释中已说明。
// ========================================================================

// -------------------- 存储键 --------------------
export const STORAGE_KEY_ENCRYPTED_VAULT = "ds_encrypted_vault_v4";
export const STORAGE_KEY_ENCRYPTED_VAULT_LEGACY_V3 = "ds_encrypted_vault_v3";

// 备份键：仅当主键数据存在但解密失败时写入。
// 场景：用户环境的 Web Crypto 从可用变为不可用（例如企业策略更新、
//       浏览器版本变化、隐私模式切换）。此时无法解密原数据，
//       若不备份，后续任何操作触发 saveVaultToStorage 会覆盖原数据，
//       造成永久丢失。
//
// 键名固定（不追加时间戳）：
//   - 每次新备份覆盖旧备份，避免累积消耗配额
//   - 用户只需关注"最近一次备份"
//   - 若用户希望保留历史，可手动导出
export const STORAGE_KEY_ENCRYPTED_VAULT_BACKUP = "ds_encrypted_vault_v4_backup";

// 主列表滚动位置：按"上下文键"分段存储
// 实际键名 = SESSION_KEY_SCROLL_POSITION_PREFIX + contextKey
// contextKey 由 statement-list.js 生成：
//   - 本地模式：`local:<tagId>`
//   - 全局模式：`global`
export const SESSION_KEY_SCROLL_POSITION_PREFIX = "ds_scroll_position_v4_";
export const SESSION_KEY_SIDEBAR_SCROLL_POSITION = "ds_sidebar_scroll_position_v4";

// -------------------- 加密参数 --------------------
export const PBKDF2_ITERATIONS = 100000;
export const ENCRYPTION_KEY_STRING = "deepseek-statement-vault-2025-v4";
export const AES_GCM_IV_LENGTH = 12;
export const SALT = new Uint8Array([
    0x3d, 0x8e, 0x2a, 0x1f, 0x6c, 0xb4, 0x5e, 0x9a,
    0x7c, 0x2d, 0x4b, 0x8a, 0x1e, 0x3c, 0x6f, 0x9d
]);

// -------------------- 默认标签 --------------------
export const DEFAULT_TAG_ID = "default_main_tag_001";
export const DEFAULT_TAG_NAME = "默认语库";

// -------------------- 标签名称长度上限 --------------------
// 命令层与 UI 层共用。
// 取值依据：
//   - 侧边栏在展开态下可用宽度约 280px
//   - 中文字符按 14px 字号估算，20 字约占 280px，正好铺满且不换行
//   - 20 字足以表达绝大多数标签语义
export const MAX_TAG_NAME_LENGTH = 20;

// -------------------- 预设颜色 --------------------
// 颜色白名单：导入数据时仅接受此列表中的颜色，杜绝 CSS 注入
export const PRESET_COLORS = [
    '#1976d2', '#e53935', '#43a047', '#fb8c00',
    '#8e24aa', '#00acc1', '#3949ab', '#d81b60',
    '#00897b', '#7cb342', '#5e35b1', '#546e7a'
];

// -------------------- 存储配额 --------------------
export const MAX_LOCALSTORAGE_SIZE = 4.5 * 1024 * 1024;
// 导入文件大小上限（防止超大文件导致主线程阻塞）
export const MAX_IMPORT_FILE_SIZE_BYTES = 20 * 1024 * 1024;

// -------------------- 数据上限 --------------------
// 单条语句的复制计数上限，防止异常数据污染排序
export const MAX_COPY_COUNT = 1000000;

// -------------------- 搜索作用域 --------------------
export const SEARCH_SCOPE_LOCAL = "local";
export const SEARCH_SCOPE_GLOBAL = "global";

// -------------------- 正则搜索安全 --------------------
// 关键词长度上限。超过此长度的关键词在正则模式下会退化为字面匹配，
// 避免灾难性回溯（ReDoS）导致主线程卡死。
//
// 取值依据：
//   - 正常用户手写正则一般不超过 50 字符
//   - 200 字符已远超常规需求，几乎只可能出现在恶意构造的场景
//   - 简单的长度上限不误伤正常使用，比时间预算更可靠——
//     正则匹配是同步操作，一旦开始执行就无法从外部打断，
//     因此只能通过"不执行"来防御
export const MAX_REGEX_KEYWORD_LENGTH = 200;

// -------------------- Font Awesome CDN --------------------
export const FONTAWESOME_SVG_CDNS = [
    'https://cdn.bootcdn.net/ajax/libs/font-awesome/6.1.0/js/all.min.js',
    'https://lib.baomitu.com/font-awesome/6.1.0/js/all.min.js',
    'https://cdn.staticfile.org/font-awesome/6.1.0/js/all.min.js',
    'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.1.0/js/all.min.js'
];

export const FONTAWESOME_CSS_CDNS = [
    'https://cdn.bootcdn.net/ajax/libs/font-awesome/6.1.0/css/all.min.css',
    'https://lib.baomitu.com/font-awesome/6.1.0/css/all.min.css',
    'https://cdn.staticfile.org/font-awesome/6.1.0/css/all.min.css',
    'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.1.0/css/all.min.css'
];

export const FONTAWESOME_LOAD_TIMEOUT_MS = 5000;

// -------------------- UI 时间参数 --------------------
export const TOAST_DURATION_MS = 2200;
export const SCROLL_SAVE_DEBOUNCE_MS = 150;
export const PERSIST_DEBOUNCE_MS = 400;
export const EDIT_MODAL_FOCUS_DELAY_MS = 100;
export const ADD_STATEMENT_SCROLL_DELAY_MS = 50;
export const TAG_MODAL_FOCUS_DELAY_MS = 100;
// 输入校验失败的抖动动画时长，与 styles/modals.css 中 @keyframes 保持一致
export const INPUT_ERROR_SHAKE_DURATION_MS = 400;

// -------------------- 语句卡片全文浮层 · 时间参数 --------------------
// 鼠标悬停在被截断的语句内容上时，延迟此毫秒数后显示全文浮层。
//
// 取值依据：
//   - VS Code 300ms、Chrome DevTools 200ms、GitHub 500ms
//   - 人眼"立即感知"阈值约 100-150ms
//   - 150ms 是"灵敏"与"避免误触"的平衡点
export const POPOVER_SHOW_DELAY_MS = 150;

// 鼠标离开语句内容区域后，延迟此毫秒数再隐藏浮层。
//
// 取值依据：
//   - 允许鼠标从卡片文本滑向浮层（含中间 12px 间距）而不中断
//   - 允许鼠标短暂离开卡片查看旁边内容再回来
//   - 300ms 是"宽容但不迟钝"的甜蜜点
export const POPOVER_HIDE_DELAY_MS = 300;

// 卡片与浮层之间的垂直间距（px）。
// 该间距同时是"小箭头"的显示空间。
export const POPOVER_VERTICAL_GAP_PX = 12;

// 浮层小箭头距浮层左边缘的水平距离（px）。
// 该值同时作为默认值；JS 可基于文本区起点微调。
export const POPOVER_ARROW_OFFSET_PX = 20;

// -------------------- 全文浮层 · 宽度下限（防御性） --------------------
// 浮层宽度采用"从 .card-index 左边缘 → .card-actions 左边缘"的实测
// 距离，正常布局下永远为正数。
//
// 该常量作为**测量异常时的绝对下限**保护存在。触发条件：
//   - DOM 结构被外部脚本破坏（例如 .card-actions 被移动到 .card-index
//     的左侧）
//   - CSS 布局被极端修改（例如 .card-index 的 position 被强行改变）
//
// 当前 DOM 结构下 never happens，保留此常量是为了避免未来重构中的
// 边界情况导致浮层宽度为负值。
export const POPOVER_MIN_WIDTH_PX = 300;

// -------------------- 全文浮层 · 高度约束 --------------------
// 浮层最大高度 = min(视口高 × 40%, 360px)
//   - 40vh：自适应小屏（避免 1080 屏下 60vh=648px 的"撑满感"）
//   - 360px：绝对上限（大屏时避免超过 360px，保持"局部放大"的视觉定位）
//
// 取值依据：
//   典型语句（60 字）约 2 行 + padding ≈ 90px
//   再多看几行的余量 ≈ 150px
//   理想高度 ≈ 240px，360px 上限留出充足余量
//
// 【注】这两个常量目前由 styles/statements.css 中
//       .statement-fulltext-popover 的 max-height: min(40vh, 360px)
//       在 CSS 侧直接表达。保留在 constants.js 中是为了：
//         ① 数据源头单一化（若未来改由 JS 动态设置高度，直接引用）
//         ② 语义文档化（数值 40% 与 360px 的含义在此集中说明）
export const POPOVER_MAX_HEIGHT_VH_RATIO = 0.4;
export const POPOVER_MAX_HEIGHT_MAX_PX = 360;