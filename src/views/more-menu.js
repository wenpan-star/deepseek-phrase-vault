// filename: src/views/more-menu.js
// ========================================================================
// DeepSeek 语句工坊 · 更多菜单
// 点击顶栏"更多 ▾"按钮后从右上方展开的下拉菜单
// 包含：回收站（带计数徽章）、设置、快捷键帮助、关于
//
// 【方案 A 收尾（上一轮）】
//   1. 新增 pendingBadgeCount 模块级缓存：
//      首次 updateMoreMenuBadge 被调用时，菜单 DOM 尚未创建
//      （菜单是惰性创建的，只有用户点击"更多"时才会注入 body）。
//      若不缓存，徽章计数会丢失，用户点击"更多"时看不到回收站数量。
//      修复：所有调用都先更新缓存；ensureMenuElement 创建菜单后
//      立即把缓存值应用到 DOM。
//   2. 抽出 applyBadgeState 内部函数，消除两处重复的徽章写入逻辑。
//   3. 删除未使用的 escapeHtml 死导入。
//   4. 其余所有行为、导出、事件绑定保持与原实现完全一致。
//
// 【本轮深度审核修复（第一批）】
//   C2（设置面板无 UI 入口）：
//     新增"设置"菜单项（data-action="settings"），
//     新增 onOpenSettings 回调并接线到 main.js 的 handleOpenSettings。
//
// 【本轮重构（第一批）】
//   问题 F（closeMoreMenu 与 forceCloseMoreMenu 逻辑重复）：
//     原实现中两个函数体几乎相同，只差返回值。现改为 closeMoreMenu
//     委托 forceCloseMoreMenu，消除逻辑重复，同时保持两个导出
//     以维持现有调用方的兼容性：
//       · forceCloseMoreMenu：供 shortcuts.js 的 Esc 优先级链使用，
//         返回 boolean 表示"是否真的关闭了菜单"
//       · closeMoreMenu：供 main.js 在打开其他浮层前主动调用，
//         无返回值（调用方确知需要关闭菜单）
// ========================================================================

import { $ } from '../utils/dom.js';
import { MORE_MENU_POSITION_DELAY_MS } from '../constants.js';

let menuElement = null;
let triggerButton = null;
let mainListElement = null;
let isMenuOpen = false;
let handlers = {
    onOpenRecycleBin: function () {},
    onOpenShortcutsHelp: function () {},
    onOpenSettings: function () {},
    onOpenAbout: function () {}
};

// ---------- 徽章计数缓存 ----------
// 语义：无论菜单 DOM 是否已创建，最后一次 updateMoreMenuBadge 传入的值
//       总是被记录到此处；ensureMenuElement 创建菜单时会读取该值并应用。
let pendingBadgeCount = 0;

/**
 * 惰性创建单例菜单 DOM
 * 首次调用 openMenu 时才注入 body
 * @returns {HTMLElement}
 */
function ensureMenuElement() {
    if (menuElement) return menuElement;

    menuElement = document.createElement('div');
    menuElement.id = 'moreMenu';
    menuElement.className = 'more-menu';
    menuElement.setAttribute('role', 'menu');
    menuElement.setAttribute('aria-hidden', 'true');

    menuElement.innerHTML = `
        <button class="more-menu-item" data-action="recycle-bin" role="menuitem" type="button">
            <i class="fas fa-trash-alt" aria-hidden="true"></i>
            <span class="more-menu-item-label">回收站</span>
            <span class="more-menu-item-badge" id="moreMenuRecycleBadge" aria-hidden="true"></span>
        </button>
        <div class="more-menu-divider" role="separator"></div>
        <button class="more-menu-item" data-action="settings" role="menuitem" type="button">
            <i class="fas fa-cog" aria-hidden="true"></i>
            <span class="more-menu-item-label">设置</span>
        </button>
        <button class="more-menu-item" data-action="shortcuts-help" role="menuitem" type="button">
            <i class="fas fa-keyboard" aria-hidden="true"></i>
            <span class="more-menu-item-label">快捷键帮助</span>
        </button>
        <button class="more-menu-item" data-action="about" role="menuitem" type="button">
            <i class="fas fa-info-circle" aria-hidden="true"></i>
            <span class="more-menu-item-label">关于</span>
        </button>
    `;

    document.body.appendChild(menuElement);
    bindMenuInternalEvents();

    // 应用此前缓存的徽章计数
    const badgeElement = menuElement.querySelector('#moreMenuRecycleBadge');
    if (badgeElement) {
        applyBadgeState(badgeElement, pendingBadgeCount);
    }

    return menuElement;
}

/**
 * 绑定菜单内部的点击事件
 * 用一次绑定替代每次打开时重复绑定
 */
function bindMenuInternalEvents() {
    if (!menuElement) return;
    menuElement.addEventListener('click', function (event) {
        const menuItem = event.target.closest('.more-menu-item');
        if (!menuItem) return;
        // 阻止事件冒泡到 document，避免触发 outside-click 关闭逻辑
        event.stopPropagation();

        const action = menuItem.getAttribute('data-action');
        // 先关闭菜单（避免回调中打开模态框时菜单仍然显示）
        closeMenu();

        switch (action) {
            case 'recycle-bin':
                handlers.onOpenRecycleBin();
                break;
            case 'settings':
                handlers.onOpenSettings();
                break;
            case 'shortcuts-help':
                handlers.onOpenShortcutsHelp();
                break;
            case 'about':
                handlers.onOpenAbout();
                break;
            default:
                break;
        }
    });
}

/**
 * 计算并应用菜单位置
 *
 * 策略：
 *   - 顶端：对齐触发按钮的下边缘 + 8px
 *   - 右端：对齐触发按钮的右边缘（不超出视口）
 *
 * 为什么不用"left: 0"相对按钮：
 *   窄屏时按钮可能靠近视口右边缘，菜单从按钮左边缘展开会溢出视口右侧
 *   因此改为右对齐
 */
function applyMenuPosition() {
    if (!menuElement || !triggerButton) return;

    const triggerRect = triggerButton.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    // 顶端：按钮下边缘 + 8px
    let top = triggerRect.bottom + 8;

    // 右端：距视口右边缘的距离 = 距按钮右边缘的距离
    let right = viewportWidth - triggerRect.right;

    // 左边界保护：若菜单宽度可能超出，调整 right
    // 菜单最小宽度 220px，右侧若不足则至少保留 16px 边距
    if (right < 16) right = 16;

    // 底部越界保护：若菜单高度超过视口剩余空间，向上偏移
    // 但菜单高度是动态的，此处先设置位置，测量后再判断
    menuElement.style.top = top + 'px';
    menuElement.style.right = right + 'px';

    // 测量菜单实际高度，判断是否需要向上翻转
    // 使用 setTimeout(0) 等待菜单完成布局
    setTimeout(function () {
        if (!menuElement || !isMenuOpen) return;
        const menuRect = menuElement.getBoundingClientRect();
        if (menuRect.bottom > viewportHeight - 8) {
            // 向上展开（对齐按钮上边缘 - 8px - 菜单高度）
            const newTop = Math.max(8, triggerRect.top - menuRect.height - 8);
            menuElement.style.top = newTop + 'px';
        }
    }, MORE_MENU_POSITION_DELAY_MS);
}

/**
 * 打开菜单
 */
function openMenu() {
    if (isMenuOpen) return;
    ensureMenuElement();

    isMenuOpen = true;
    menuElement.classList.add('is-open');
    menuElement.setAttribute('aria-hidden', 'false');
    if (triggerButton) {
        triggerButton.classList.add('is-active');
        triggerButton.setAttribute('aria-expanded', 'true');
    }

    applyMenuPosition();
}

/**
 * 关闭菜单
 */
function closeMenu() {
    if (!isMenuOpen) return;
    isMenuOpen = false;
    if (menuElement) {
        menuElement.classList.remove('is-open');
        menuElement.setAttribute('aria-hidden', 'true');
    }
    if (triggerButton) {
        triggerButton.classList.remove('is-active');
        triggerButton.setAttribute('aria-expanded', 'false');
    }
}

/**
 * 文档级点击处理（用于点击菜单外部关闭）
 * @param {MouseEvent} event
 */
function handleDocumentClick(event) {
    if (!isMenuOpen) return;
    // 点击在菜单内：不关闭（由菜单内的 stopPropagation 处理，
    // 这里再兜底一次）
    if (menuElement && menuElement.contains(event.target)) return;
    // 点击在触发按钮上：由按钮自己的 click 处理，不在这里关闭
    if (triggerButton && triggerButton.contains(event.target)) return;
    // 其他区域：关闭
    closeMenu();
}

/**
 * 文档级键盘处理
 * 注意：Escape 的全局处理由 shortcuts.js 负责，调用 forceCloseMoreMenu。
 * 这里只监听"Tab 键移出菜单"的关闭场景。
 * @param {KeyboardEvent} event
 */
function handleDocumentKeydown(event) {
    if (!isMenuOpen) return;
    if (event.key !== 'Tab') return;

    // Tab 键：若焦点将移出菜单，则关闭
    if (!menuElement) return;
    if (!menuElement.contains(document.activeElement)
        && !menuElement.contains(event.target)) {
        // 焦点已在菜单外，无需处理
        return;
    }

    // 用户从菜单内 Tab 出去：让浏览器默认行为处理焦点移动，
    // 然后在下一帧检查焦点是否还在菜单内
    setTimeout(function () {
        if (!isMenuOpen) return;
        if (!menuElement.contains(document.activeElement)) {
            closeMenu();
        }
    }, 0);
}

/**
 * 窗口大小变化处理
 */
function handleWindowResize() {
    if (isMenuOpen) closeMenu();
}

/**
 * 主列表滚动处理
 */
function handleMainListScroll() {
    if (isMenuOpen) closeMenu();
}

/**
 * 初始化更多菜单
 * @param {{
 *   onOpenRecycleBin: () => void,
 *   onOpenShortcutsHelp: () => void,
 *   onOpenSettings: () => void,
 *   onOpenAbout: () => void
 * }} options
 */
export function initializeMoreMenu(options) {
    handlers = Object.assign(handlers, options || {});

    triggerButton = $('#moreMenuBtn');
    mainListElement = $('#mainListContainer');

    if (triggerButton) {
        triggerButton.addEventListener('click', function (event) {
            // 阻止冒泡：防止本次点击触发 document 级 outside-click 逻辑
            event.stopPropagation();
            if (isMenuOpen) {
                closeMenu();
            } else {
                openMenu();
            }
        });
    }

    // 文档级监听：一次性绑定，处理函数内部检查 isMenuOpen
    document.addEventListener('click', handleDocumentClick);
    document.addEventListener('keydown', handleDocumentKeydown);
    window.addEventListener('resize', handleWindowResize, { passive: true });
    if (mainListElement) {
        mainListElement.addEventListener('scroll', handleMainListScroll, { passive: true });
    }
}

/**
 * 将徽章计数写入指定 DOM 元素
 *
 * @param {HTMLElement} badgeElement
 * @param {number} normalizedCount 已归一化的非负整数（0 表示隐藏）
 */
function applyBadgeState(badgeElement, normalizedCount) {
    if (!badgeElement) return;
    if (normalizedCount > 0) {
        badgeElement.textContent = '(' + normalizedCount + ')';
        badgeElement.style.display = 'inline';
    } else {
        badgeElement.textContent = '';
        badgeElement.style.display = 'none';
    }
}

/**
 * 更新更多菜单中回收站徽章的计数
 *
 * 【方案 A 收尾】
 *   - 无论菜单 DOM 是否已创建，都先把计数写入 pendingBadgeCount。
 *   - 若菜单 DOM 已存在，则同步更新 DOM。
 *   - 若菜单 DOM 尚未创建（首次打开前），仅缓存；
 *     ensureMenuElement 创建菜单后会读取缓存并应用。
 *
 * @param {number} count
 */
export function updateMoreMenuBadge(count) {
    const normalizedCount = (typeof count === 'number' && Number.isFinite(count) && count > 0)
        ? Math.floor(count)
        : 0;

    // 先更新缓存（无论菜单是否已创建）
    pendingBadgeCount = normalizedCount;

    // 若菜单尚未创建，缓存完毕即可返回
    if (!menuElement) return;

    const badgeElement = menuElement.querySelector('#moreMenuRecycleBadge');
    applyBadgeState(badgeElement, normalizedCount);
}

/**
 * 强制关闭更多菜单（供快捷键 Esc 调用）
 *
 * 若当前菜单未打开，返回 false；否则关闭并返回 true。
 * @returns {boolean}
 */
export function forceCloseMoreMenu() {
    if (!isMenuOpen) return false;
    closeMenu();
    return true;
}

/**
 * 主动关闭更多菜单（供 main.js 在打开其他浮层前调用）
 *
 * 与 forceCloseMoreMenu 的差异：
 *   · forceCloseMoreMenu 返回 boolean（供 Esc 优先级链判断）
 *   · closeMoreMenu 无返回值（用于"确知需要关闭菜单"的场景）
 *
 * 【本轮重构 · 问题 F】
 *   内部实现委托给 forceCloseMoreMenu，消除逻辑重复。
 *   两个导出均保留，维持现有调用方的兼容性。
 */
export function closeMoreMenu() {
    forceCloseMoreMenu();
}