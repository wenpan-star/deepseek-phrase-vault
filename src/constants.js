// filename: src/constants.js
// ========================================================================
// DeepSeek 语句工坊 · 全局常量
// 所有"魔数"集中于此，任何模块不得内联硬编码
//
// 【历史调整】
//   1. 新增 MAX_TAG_NAME_LENGTH：标签名称长度上限
//   2. 删除 STORAGE_KEY_PLAIN_UI（死代码）
//   3. 删除 SORTABLE_CDN（死代码）
//   4. 新增 STORAGE_KEY_ENCRYPTED_VAULT_BACKUP（W3 数据保护）
//   5. 删除 POPOVER_MAX_WIDTH_PX（8-3 修复）
//
// 【本次调整 · 方案 A】
//   1. 新增回收站相关常量：
//        MAX_RECYCLE_BIN_SIZE      条数上限
//        RECYCLE_BIN_RETENTION_DAYS 保留天数
//        TIME_THRESHOLD_*          相对时间格式化阈值
//   2. 新增 SETTINGS_DEFAULTS：所有设置项的默认值表。
//      加新设置项只需在此表加一行，normalizeSettings 自动处理。
//   3. 新增 MORE_MENU_POSITION_DELAY_MS 等交互时间参数。
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

// -------------------- 回收站参数（方案 A 新增）--------------------
// 回收站条数上限：超过时淘汰最旧条目（FIFO）
//
// 取值依据：
//   - 100 条足够覆盖"几天内误删多条目"的场景
//   - 单条平均 200 字节，100 条约 20KB，加密后仍远小于 localStorage 上限
//   - 超过 100 条后，用户多半已不记得当初删了什么
export const MAX_RECYCLE_BIN_SIZE = 100;

// 回收站保留天数：超过时在打开面板时清理
//
// 取值依据：
//   - 30 天足够用户在"发现问题后想起来恢复"
//   - 与多数邮箱的"垃圾箱保留 30 天"惯例一致
export const RECYCLE_BIN_RETENTION_DAYS = 30;

// 回收站时间格式化阈值（毫秒）
// 用于将 deletedAt 时间戳转换为"3 分钟前"等易读字符串
export const TIME_THRESHOLD_JUST_NOW_MS = 60 * 1000;              // < 1 分钟
export const TIME_THRESHOLD_MINUTES_MS = 60 * 60 * 1000;          // < 1 小时
export const TIME_THRESHOLD_HOURS_MS = 24 * 60 * 60 * 1000;       // < 1 天
export const TIME_THRESHOLD_DAYS_MS = 30 * 24 * 60 * 60 * 1000;   // < 30 天

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

// -------------------- 设置项默认值表（方案 A 新增）--------------------
// 加新设置项只需在此表加一行。
// normalizeSettings 会自动：
//   1. 若原始值缺失 → 用默认值
//   2. 若原始值类型与默认值不一致 → 用默认值
//
// 未来若需枚举校验（如 theme: 'light' | 'dark'），
// 另加 SETTINGS_VALIDATORS 表在 normalizeSettings 中应用。
//
// 当前设置项：
//   - enableInitialsSearch: 是否启用拼音首字母搜索
//     默认 true：与历史行为一致，用户升级后无感知
//
// 未来扩展示例：
//   - theme: 'light' | 'dark' | 'auto'
//   - fontSize: 'small' | 'medium' | 'large'
//   - language: 'zh-CN' | 'en-US'
export const SETTINGS_DEFAULTS = {
    enableInitialsSearch: true
};

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
export const INPUT_ERROR_SHAKE_DURATION_MS = 400;

// 更多菜单打开后的位置计算延迟（等待 DOM 渲染后测量）
// 0ms 表示下一个宏任务立即执行；使用 setTimeout(0) 而非同步，
// 是为了保证菜单元素已经完成布局（offsetWidth 可读）
export const MORE_MENU_POSITION_DELAY_MS = 0;

// 设置面板打开后的聚焦延迟（与编辑框保持一致）
export const SETTINGS_MODAL_FOCUS_DELAY_MS = 100;

// 回收站面板打开后的聚焦延迟
export const RECYCLE_BIN_MODAL_FOCUS_DELAY_MS = 100;

// -------------------- 语句卡片全文浮层 --------------------
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