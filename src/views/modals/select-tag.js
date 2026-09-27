// filename: src/views/modals/select-tag.js
// ========================================================================
// DeepSeek 语句工坊 · 选择目标标签模态框
// 用于"复制到其他标签"与"批量移动到标签"
// 返回 Promise<{ tagId: string } | null>
//
// 【分类分组 + 可收起】
//
//   一、数据契约
//     新增可选参数 options.categories。传入非空数组时启用分组渲染，
//     未传或传空数组时退化为平铺渲染（原行为）。
//
//     为什么不在 main.js 预先分组：
//       "把 tags 按 categoryId 分桶"是呈现组织逻辑，不属于调用方
//       职责。若放在 main.js，4 个调用点各写一遍分组，且未来加新
//       规则需改 4 处。与项目既有风格（视图接收原始数据 + 组织参数，
//       如 openTagModal({ categories, initialCategoryId })）一致。
//
//   二、折叠实现：原生 <details> / <summary>
//     折叠交互的本质就是 HTML 原生 <details> 元素的语义。
//     使用原生元素可获得以下"零成本"收益：
//       · 零 JS 状态管理（折叠状态即 DOM 的 [open] 属性）
//       · 零 ARIA 手工同步（浏览器自动维护 role / aria-expanded）
//       · 零键盘处理（<summary> 原生响应 Enter / Space）
//       · 零焦点管理（<summary> 天然可聚焦、可 Tab）
//       · 零图标切换逻辑（纯 CSS [open] 选择器即可）
//     手写 div + role="button" + aria-expanded + keydown + classList
//     + display:none + 图标换类，等于重造浏览器。
//
//   三、状态重置策略：靠"每次打开重建 DOM"天然重置
//     sidebar 的折叠状态是"跨会话的视图偏好"，存 localStorage 独立键。
//     select-tag 的折叠状态是"单次打开期间的临时注意力聚焦"：
//       · 用户上次找"物料申请"，折叠了 Py 分类
//       · 下次打开想找"Py程序书写"
//       · 若持久化，第一眼看到 Py 分类是折叠的 → 困惑 + 手动展开
//     因此本模块的折叠状态**不持久化**。每次 openSelectTagModal
//     都执行 listElement.innerHTML = ''，新 DOM 无任何 [open] 状态，
//     天然重置为全部展开。零额外代码。
//
//   四、分组顺序：严格按 categories 顺序
//     vault.categories 是单一真相源（normalizeCategories 保证默认
//     分类在首位）。按它遍历，保证 select-tag 与 sidebar 的分类顺序
//     严格一致。若按 tags 首次出现顺序分组，则顺序会与 sidebar 不同
//     （因为 vault.tags 是跨分类的全局顺序），用户会感到"两个界面
//     不一致"。
//
//   五、空分组跳过
//     用户的任务是"选一个标签"。一个没有任何候选标签的分类，对
//     选择毫无帮助。与 sidebar 不同——sidebar 是结构浏览视图
//     （用户可能点空分类后想加标签），select-tag 是选择操作流。
//
//   六、事件绑定：委托到 listElement
//     与项目其他视图（sidebar / statement-list / recycle-bin-modal）
//     一致。委托在父容器上，不受子元素 innerHTML 清空的影响，
//     只需绑定一次即可跨多次打开持续有效。
//
//   七、ARIA 语义
//     分组模式：<details> / <summary> 是原生语义元素，浏览器自动
//               关联 summary 与内容区，无需额外 role。
//               由于 listElement 的直接子元素是 <details> 而非
//               listitem，应移除 listElement 的 role="list"。
//     平铺模式：listElement 保留 role="list"，直接子元素为 listitem。
//     空候选集：listElement 移除 role（提示不是 listitem）。
//               这是本轮 B1/I1 修复的一部分——见下。
//
//   八、向后兼容
//     若调用方未传 categories，自动退化为平铺渲染，并打印
//     console.warn 提示。之所以不静默降级，是因为"忘记传 categories"
//     是编程错误，应该暴露而非掩盖。
//
//     若调用方显式传 categories: []，视为"明确表示不需要分组"，
//     静默退化为平铺渲染，不打印告警。
//
//     这两种场景语义完全不同，必须区分对待——见下【B1 修复】。
//
// 【本轮 B1 修复 · 告警触发条件与注释承诺对齐】
//   背景：
//     原实现用 `categories.length === 0` 判定"未传"，同时覆盖两种
//     语义完全不同的场景：
//       1. 调用方未传 categories（undefined / null / 非数组）
//          → 这是编程错误，应该告警
//       2. 调用方显式传 categories: []（空数组）
//          → 这是"明确表示不要分组"的意图，不应告警
//
//     但原实现的告警文案承诺"可显式传 categories: [] 以消除本告警"，
//     与实现矛盾——开发者按文案操作，告警依然存在，从而失去对
//     告警的信任。
//
//   根因：
//     `Array.prototype.length === 0` 无法区分"未传"与"空数组"。
//
//   修复方案：
//     用 `Array.isArray(options.categories)` 判定参数是否传入：
//       · 非数组（undefined / null / 字符串等）→ 未传 → 告警 + 平铺
//       · 空数组 []                            → 显式空 → 静默 + 平铺
//       · 非空数组                             → 分组渲染
//     这与注释承诺的语义严格一致。
//
// 【本轮 I1 修复 · 空候选集分支的 ARIA role 残留】
//   背景：
//     listElement 的 role 属性由三条分支分别处理：
//       · 平铺渲染：setAttribute('role', 'list')
//       · 分组渲染：removeAttribute('role')
//       · 空候选集：**未处理**
//
//     若上一次打开走了平铺渲染（role="list"），本次打开遇到空候选
//     集，listElement 会残留 role="list"，但唯一子元素是提示 div，
//     无 role="listitem"。这违反 ARIA 规范，屏幕阅读器可能播报
//     语义不一致。
//
//   修复方案：
//     空候选集分支显式 `listElement.removeAttribute('role')`。
//     "没有可选的目标标签"是信息性提示，不是可选列表项。
//
// 【历史说明】
//   本模块是"纯展示模块"，不修改任何数据、不 dispatch 命令。
//   openSelectTagModal 只接收数据 + 返回用户选择。
// ========================================================================

import { escapeHtml } from '../../utils/dom.js';
import { DEFAULT_CATEGORY_ID } from '../../constants.js';

// ---------- 模块级 DOM 缓存 ----------
let modalElement = null;
let listElement = null;
let cancelButton = null;

// ---------- 生命周期状态 ----------
let currentResolve = null;

// ---------- 列表委托绑定标志 ----------
// 确保在 listElement 上只绑定一次 click 委托。
//
// 为什么只需绑定一次：
//   listElement 是模态框 DOM 的固定子元素。每次打开模态框执行
//   listElement.innerHTML = '' 只清空其子节点，不替换它本身。
//   因此监听器跨多次 openSelectTagModal 调用持续有效。
let isListClickBound = false;

/**
 * 构建模态框 DOM（首次调用时执行）
 * @returns {HTMLElement}
 */
function buildModal() {
    const modal = document.createElement('div');
    modal.id = 'selectTagModal';
    modal.className = 'modal';
    modal.innerHTML = `
        <div class="modal-card">
            <h3><i class="fas fa-share-alt" aria-hidden="true"></i> 选择目标标签</h3>
            <div id="tagSelectList" class="tag-select-list" role="list"></div>
            <div class="modal-actions">
                <button class="btn btn-outline" id="cancelSelectTagBtn" type="button">取消</button>
            </div>
        </div>
    `;
    document.body.appendChild(modal);
    return modal;
}

/**
 * 清理：隐藏模态框、移除事件监听、返回未完成的 resolver
 * @returns {Function|null}
 */
function cleanup() {
    if (!modalElement) return null;
    modalElement.style.display = 'none';
    cancelButton.removeEventListener('click', handleCancel);
    modalElement.removeEventListener('click', handleBackdropClick);
    const resolver = currentResolve;
    currentResolve = null;
    return resolver;
}

/**
 * 取消：resolve null
 */
function handleCancel() {
    const resolver = cleanup();
    if (resolver) resolver(null);
}

/**
 * 点击遮罩关闭（视为取消）
 * @param {MouseEvent} event
 */
function handleBackdropClick(event) {
    if (event.target === modalElement) handleCancel();
}

// ==================== 标签选项创建 ====================

/**
 * 创建单个标签选项元素
 *
 * 【为什么用 createElement 而非 innerHTML 拼字符串】
 *   · 天然避免 XSS（无需手工 escapeHtml 每个字段）
 *   · DOM 节点直接可查询
 *   · 与项目其他动态 DOM 构建方式一致
 *
 * 【为什么用类而非内联 style】
 *   原实现用内联 style 拼接到 innerHTML，本轮提取为三个语义类：
 *     · .tag-color-dot   —— 色点
 *     · .tag-option-name —— 名称（含省略号）
 *     · .tag-option-count—— 计数
 *   好处：
 *     · 视觉调整集中在 CSS 层，无需改 JS
 *     · 与项目"样式与结构分离"的风格一致
 *
 * 【关于色点的 XSS 防护】
 *   通过 CSSOM 的 `style.background = colorValue` 赋值而非
 *   innerHTML 注入。CSSOM 只接受合法颜色值，非法值被浏览器静默
 *   忽略，不存在执行风险。normalizeVault 已保证 tag.color 是
 *   PRESET_COLORS 白名单之一，此处是双保险。
 *
 * 【关于名称的 XSS 防护】
 *   使用 `textContent` 而非 `innerHTML`，从源头杜绝注入。
 *
 * @param {{id: string, name: string, color: string|null}} tag
 * @param {number} count
 * @returns {HTMLElement}
 */
function createTagOptionElement(tag, count) {
    const option = document.createElement('div');
    option.className = 'tag-option';
    option.setAttribute('role', 'listitem');
    option.setAttribute('data-tag-id', tag.id);

    const colorDotElement = document.createElement('span');
    colorDotElement.className = 'tag-color-dot';
    colorDotElement.style.background = tag.color ? tag.color : '#ccc';

    const nameElement = document.createElement('span');
    nameElement.className = 'tag-option-name';
    nameElement.textContent = tag.name;

    const countElement = document.createElement('span');
    countElement.className = 'tag-option-count';
    countElement.textContent = String(count) + ' 条';

    option.appendChild(colorDotElement);
    option.appendChild(nameElement);
    option.appendChild(countElement);

    return option;
}

// ==================== 渲染：平铺模式 ====================

/**
 * 平铺渲染（向后兼容路径）
 *
 * 语义：所有候选标签平铺显示，无分组、无折叠。
 * 触发条件：
 *   · 调用方显式传 categories: []（明确表示不要分组）
 *   · 调用方未传 categories（编程错误，已告警）
 *
 * 【为什么保留这条路径】
 *   1. openSelectTagModal 是通用接口，不应强制要求 categories 参数
 *   2. 未传 categories 时的语义清晰：不分组 = 平铺
 *   3. 平铺模式与分组模式是两个真正不同的呈现，用两个函数表达
 *      比用一个"匿名分类"的隐式概念更诚实
 *
 * 【关于 ARIA】
 *   role="list" + 直接子元素 role="listitem" 是合法的 ARIA 结构。
 *   与"分组模式移除 role"形成对照（分组模式的直接子元素是
 *   <details>，不是 listitem，保留 role="list" 会违反规范）。
 *
 * @param {Array} candidateTags
 * @param {Object<string, number>} counts
 */
function renderFlatOptions(candidateTags, counts) {
    // 平铺模式：listElement 保留 role="list"（直接子元素是 listitem）
    listElement.setAttribute('role', 'list');

    candidateTags.forEach(function (tag) {
        const option = createTagOptionElement(tag, counts[tag.id] || 0);
        listElement.appendChild(option);
    });
}

// ==================== 渲染：分组模式 ====================

/**
 * 分组渲染（主路径）
 *
 * 按 categories 顺序遍历，为每个非空分组创建 <details> 结构。
 *
 * 【DOM 结构】
 *   <div class="tag-select-list">          ← listElement
 *     <details class="tag-select-group" open>
 *       <summary class="tag-select-group-title">
 *         <i class="fas fa-folder-open folder-icon-open"></i>
 *         <i class="fas fa-folder folder-icon-closed"></i>
 *         <span class="tag-select-group-name">未分类</span>
 *       </summary>
 *       <div class="tag-select-group-items">
 *         <div class="tag-option" data-tag-id="...">...</div>
 *         ...
 *       </div>
 *     </details>
 *     ...
 *   </div>
 *
 * 【为什么不用 role="group" + aria-labelledby】
 *   <details> / <summary> 是原生语义元素。浏览器自动维护：
 *     · summary 与内容区的关联
 *     · summary 上的 aria-expanded 同步
 *     · 焦点管理与键盘响应
 *   额外的 ARIA 不仅多余，还可能覆盖浏览器的原生语义。
 *
 * 【listElement 的 role 变化】
 *   平铺模式：role="list"（直接子元素是 listitem）
 *   分组模式：移除 role（直接子元素是 <details>，不是 listitem）
 *
 * @param {Array} candidateTags
 * @param {Object<string, number>} counts
 * @param {Array<{id: string, name: string}>} categories
 */
function renderGroupedOptions(candidateTags, counts, categories) {
    // 分组模式下，listElement 的直接子元素是 <details>，不是 listitem
    // 因此移除 role="list"，保持 ARIA 语义正确
    listElement.removeAttribute('role');

    // ---------- 把候选标签按 categoryId 分桶 ----------
    const tagsByCategoryId = new Map();
    candidateTags.forEach(function (tag) {
        // 防御性兜底：categoryId 缺失或非法时归入默认分类
        // （normalizeVault 已保证合法，此处是零成本的额外保护）
        const categoryId = tag.categoryId || DEFAULT_CATEGORY_ID;
        if (!tagsByCategoryId.has(categoryId)) {
            tagsByCategoryId.set(categoryId, []);
        }
        tagsByCategoryId.get(categoryId).push(tag);
    });

    // ---------- 按 categories 顺序渲染（空分组跳过）----------
    categories.forEach(function (category) {
        const categoryTags = tagsByCategoryId.get(category.id) || [];
        if (categoryTags.length === 0) return;

        // ---------- <details>：可折叠容器 ----------
        const groupElement = document.createElement('details');
        groupElement.className = 'tag-select-group';
        // 默认展开：open 是布尔属性，property 赋值会同步到 attribute，
        // 使 CSS 的 [open] 选择器匹配
        groupElement.open = true;

        // ---------- <summary>：折叠触发器（原生键盘/ARIA/焦点）----------
        const titleElement = document.createElement('summary');
        titleElement.className = 'tag-select-group-title';

        // 两个文件夹图标，通过 CSS [open] 选择器切换显示。
        // 之所以用两个图标元素而非一个 + 换类：
        //   · 纯 CSS 切换，无需 JS 参与
        //   · 与 sidebar.js 的图标换类逻辑本质相同（sidebar 用 JS
        //     换类，此处用 CSS 属性选择器），但更简洁
        const iconOpen = document.createElement('i');
        iconOpen.className = 'fas fa-folder-open folder-icon-open';
        iconOpen.setAttribute('aria-hidden', 'true');

        const iconClosed = document.createElement('i');
        iconClosed.className = 'fas fa-folder folder-icon-closed';
        iconClosed.setAttribute('aria-hidden', 'true');

        const nameSpan = document.createElement('span');
        nameSpan.className = 'tag-select-group-name';
        nameSpan.textContent = category.name;

        titleElement.appendChild(iconOpen);
        titleElement.appendChild(iconClosed);
        titleElement.appendChild(nameSpan);

        // ---------- 分组内标签容器 ----------
        const itemsElement = document.createElement('div');
        itemsElement.className = 'tag-select-group-items';

        categoryTags.forEach(function (tag) {
            itemsElement.appendChild(
                createTagOptionElement(tag, counts[tag.id] || 0)
            );
        });

        groupElement.appendChild(titleElement);
        groupElement.appendChild(itemsElement);
        listElement.appendChild(groupElement);
    });
}

// ==================== 渲染：空候选集 ====================

/**
 * 渲染空候选集提示
 *
 * 触发条件：excludeTagId 过滤后候选集为空。
 * 语义：告知用户当前上下文无任何可选标签。
 *
 * 【ARIA 处理】
 *   提示不是可选的列表项，因此 listElement 不应保留 role="list"
 *   （会违反"list 的直接子元素必须是 listitem"的 ARIA 规范）。
 *   显式 removeAttribute('role')。
 *
 *   本轮 I1 修复：原实现未处理 role，可能残留上一次渲染的
 *   role="list"，造成 ARIA 语义不一致。
 */
function renderEmptyMessage() {
    // 提示不是列表项，移除 role="list"（本轮 I1 修复）
    listElement.removeAttribute('role');

    const emptyMessage = document.createElement('div');
    emptyMessage.className = 'tag-option';
    emptyMessage.style.cursor = 'default';
    emptyMessage.textContent = '没有可选的目标标签';
    listElement.appendChild(emptyMessage);
}

// ==================== 事件委托 ====================

/**
 * 在 listElement 上绑定一次 click 委托
 *
 * 【职责】
 *   只处理"点击标签选项 → 选择"。
 *   "点击 summary → 折叠/展开"由浏览器原生处理，本委托不拦截。
 *
 * 【为什么委托而非逐个绑定】
 *   · 与项目其他视图（sidebar / statement-list / recycle-bin-modal）一致
 *   · 减少绑定次数（N 个 option → 1 个委托）
 *   · 与 innerHTML = '' 清空机制天然兼容（委托在父元素上，
 *     不受子元素清空影响）
 *
 * 【为什么只绑定一次】
 *   listElement 是模态框内的固定子元素，跨多次 openSelectTagModal
 *   调用持续存在。innerHTML = '' 只清空其子节点，不替换它本身。
 *   因此只需绑定一次，即可跨所有后续打开持续有效。
 *
 * 【为什么显式判断 summary 点击】
 *   虽然 summary 内不含 .tag-option，closest('.tag-option') 会返回
 *   null，实际上不会误触发。但显式判断使代码意图更清晰，且未来
 *   若在 summary 内加入其他可点击元素时更安全。
 *
 * 【关于空候选集时的委托行为】
 *   空候选集渲染的提示 div 的 class 是 .tag-option（视觉上复用
 *   tag-option 的样式），但无 data-tag-id 属性。委托中
 *   `if (!tagId) return;` 会拦截它，不会误触发选择。
 */
function bindListEventsOnce() {
    if (isListClickBound) return;
    if (!listElement) return;
    isListClickBound = true;

    listElement.addEventListener('click', function (event) {
        // ---------- 优先级 1：summary 点击 ----------
        // 交给浏览器原生处理（折叠/展开），本委托不拦截
        if (event.target.closest('.tag-select-group-title')) {
            return;
        }

        // ---------- 优先级 2：标签选项点击 ----------
        const option = event.target.closest('.tag-option');
        if (!option) return;

        const tagId = option.getAttribute('data-tag-id');
        if (!tagId) return;

        const resolver = cleanup();
        if (resolver) resolver({ tagId: tagId });
    });
}

// ==================== 对外接口 ====================

/**
 * 打开选择标签模态框
 *
 * @param {{
 *   title: string,
 *   tags: Array<{id: string, name: string, color: string|null,
 *                categoryId?: string}>,
 *   counts: Object<string, number>,
 *   categories?: Array<{id: string, name: string}>,
 *   excludeTagId?: string|null
 * }} options
 * @returns {Promise<{ tagId: string } | null>}
 */
export function openSelectTagModal(options) {
    // ---------- 首次调用时构建模态框 DOM ----------
    if (!modalElement) {
        modalElement = buildModal();
        listElement = modalElement.querySelector('#tagSelectList');
        cancelButton = modalElement.querySelector('#cancelSelectTagBtn');
        bindListEventsOnce();
    }

    // ---------- 若已有打开的模态框，先取消旧实例 ----------
    // 与 confirm / edit / tag / category 四个模态框的处理流程一致：
    //   1. 取出旧 resolver
    //   2. 清空 currentResolve（避免 cleanup 内部重复处理）
    //   3. 调用旧 resolver（返回"取消"语义）
    //   4. cleanup（移除事件监听、隐藏弹窗）
    if (currentResolve) {
        const oldResolver = currentResolve;
        currentResolve = null;
        oldResolver(null);
        cleanup();
    }

    // ---------- 更新标题 ----------
    const titleElement = modalElement.querySelector('h3');
    titleElement.innerHTML = '<i class="fas fa-share-alt" aria-hidden="true"></i> '
        + escapeHtml(options.title || '选择目标标签');

    // ---------- 清空旧列表（同时也重置了所有折叠状态）----------
    // 【关键设计】
    //   每次打开都从"全部展开"的干净状态开始。
    //   这是有意的设计决策——折叠是"临时注意力聚焦"，
    //   不是"跨会话视图偏好"（与 sidebar 折叠状态的处理不同）。
    //   不需要额外清空任何状态变量，因为 DOM 本身就是唯一的状态源。
    listElement.innerHTML = '';

    // ---------- 计算候选标签集 ----------
    // excludeTagId 语义：调用方可指定一个额外排除的标签
    //   · 当前所有调用点均传 null
    //   · 保留此参数是为了不破坏接口契约（未来可能有用）
    const excludeId = options.excludeTagId || null;
    const candidateTags = options.tags.filter(function (tag) {
        return tag.id !== excludeId;
    });

    // ---------- 空候选集：显示提示，不渲染分组/平铺 ----------
    if (candidateTags.length === 0) {
        renderEmptyMessage();

        modalElement.style.display = 'flex';
        cancelButton.addEventListener('click', handleCancel);
        modalElement.addEventListener('click', handleBackdropClick);

        return new Promise(function (resolve) {
            currentResolve = resolve;
        });
    }

    // ---------- 判定 categories 参数的传入状态 ----------
    //
    // 【本轮 B1 修复】
    //   原实现用 `categories.length === 0` 判定"未传"，无法区分：
    //     (a) 调用方未传 categories（undefined / null / 非数组）
    //     (b) 调用方显式传 categories: []（明确的"不要分组"意图）
    //   但告警文案承诺"显式传 categories: [] 可消除告警"，与实现矛盾。
    //
    //   现改为用 `Array.isArray(options.categories)` 判定是否传入：
    //     · 非数组 → 未传 → 告警 + 平铺
    //     · 空数组 → 显式空 → 静默 + 平铺
    //     · 非空数组 → 分组
    //
    //   这与注释承诺的语义严格一致。
    const isCategoriesParameterProvided = Array.isArray(options.categories);
    const categories = isCategoriesParameterProvided
        ? options.categories
        : [];
    const counts = options.counts || {};

    // ---------- 判定渲染路径 ----------
    if (categories.length > 0) {
        // 分组渲染（主路径）
        renderGroupedOptions(candidateTags, counts, categories);
    } else {
        // 平铺降级（向后兼容路径）
        //
        // 仅在"未传 categories 参数"时告警——这是编程错误。
        // 显式传 categories: [] 是用户的明确意图（不要分组），
        // 不告警。
        if (!isCategoriesParameterProvided) {
            console.warn(
                '[select-tag] 未传入 categories 参数，已降级为平铺列表。'
                + '若不需要分组，可显式传 categories: [] 以消除本告警。'
            );
        }
        renderFlatOptions(candidateTags, counts);
    }

    // ---------- 显示模态框并绑定事件 ----------
    modalElement.style.display = 'flex';
    cancelButton.addEventListener('click', handleCancel);
    modalElement.addEventListener('click', handleBackdropClick);

    return new Promise(function (resolve) {
        currentResolve = resolve;
    });
}

/**
 * 强制关闭当前选择框
 *
 * 供 src/shortcuts.js 的 Esc 优先级链调用。
 * 与其他模态框的 forceCloseXxx 保持一致的返回语义：
 *   返回 true  = 当前有打开的模态框，已被关闭；
 *   返回 false = 当前无打开的模态框，未做任何事。
 *
 * @returns {boolean}
 */
export function forceCloseSelectTagModal() {
    if (!currentResolve) return false;
    const resolver = currentResolve;
    currentResolve = null;
    cleanup();
    resolver(null);
    return true;
}