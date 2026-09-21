// filename: src/views/modals/edit.js
// ========================================================================
// DeepSeek 语句工坊 · 编辑语句模态框
// 返回 Promise<{ text: string } | null>
//
// 【修复要点（历史）】
//   1. Escape 加 stopPropagation()：避免 document 级监听器同时触发
//   2. Ctrl+Enter 加 isComposing 判定：避免中文输入法下误提交
//   3. forceCloseEditModal 返回布尔值：供 shortcuts.js 判断是否真的关闭了
//   4. textarea rows 从 3 改为 6，配合 CSS flex: 1 + min-height
//   5. 空文本保存时触发抖动动画与红色边框，避免用户误以为按钮失灵
//
// 【本次重构 · 动态尺寸】
//   编辑模态框尺寸改为按主列表布局动态计算：
//     · 宽度 = （序号左边缘 → 按钮区左边缘 的距离）× 2/3
//     · 高度 = 视口高度 × 1/2
//
//   具体规则：
//     基准宽度 W = cardActionsElement.getBoundingClientRect().left
//                - cardIndexElement.getBoundingClientRect().left
//     模态框宽度 = clamp(360, W × 2/3, 800)
//     模态框高度 = max(360, window.innerHeight / 2)
//
//   实现方式：
//     · computeAndApplyEditModalSize() 计算尺寸并写入 CSS 变量
//       --modal-card-width-edit-dynamic 和
//       --modal-card-height-edit-dynamic
//     · CSS 层的 #editModal .modal-card 规则引用这两个变量
//     · 每次打开模态框前调用一次；窗口 resize 时若模态框打开也刷新
//
//   为什么用 CSS 变量而非直接设置 style：
//     项目约定所有尺寸走 tokens.css 的设计令牌。JS 计算的值
//     仍然通过 CSS 变量注入，保持 CSS 侧声明式的一致性。
//
//   为什么空状态下不报错：
//     computeAndApplyEditModalSize 内部检测 .statement-card 是否存在，
//     不存在时直接 return，CSS 变量保持 tokens.css 中的默认值。
// ========================================================================

import {
    EDIT_MODAL_FOCUS_DELAY_MS,
    INPUT_ERROR_SHAKE_DURATION_MS
} from '../../constants.js';

let modalElement = null;
let textareaElement = null;
let saveButton = null;
let cancelButton = null;
let currentResolve = null;
let inputErrorTimer = null;

// 用于确保窗口 resize 监听只注册一次
let resizeListenerBound = false;

function buildModal() {
    const modal = document.createElement('div');
    modal.id = 'editModal';
    modal.className = 'modal';
    modal.innerHTML = `
        <div class="modal-card">
            <h3><i class="fas fa-pen-fancy" aria-hidden="true"></i> 编辑语句</h3>
            <textarea id="editTextarea" rows="6" aria-label="编辑语句内容"></textarea>
            <div class="modal-actions">
                <button class="btn btn-outline" id="cancelEditBtn" type="button">取消</button>
                <button class="btn btn-primary" id="saveEditBtn" type="button">保存</button>
            </div>
        </div>
    `;
    document.body.appendChild(modal);
    return modal;
}

function cleanup() {
    if (!modalElement) return null;
    modalElement.style.display = 'none';
    saveButton.removeEventListener('click', handleSave);
    cancelButton.removeEventListener('click', handleCancel);
    modalElement.removeEventListener('click', handleBackdropClick);
    textareaElement.removeEventListener('keydown', handleKeydown);
    // 清理可能残留的输入错误状态与定时器
    if (inputErrorTimer) {
        clearTimeout(inputErrorTimer);
        inputErrorTimer = null;
    }
    if (textareaElement) {
        textareaElement.classList.remove('input-error');
    }
    const resolver = currentResolve;
    currentResolve = null;
    return resolver;
}

/**
 * 触发输入错误反馈：
 *   1. 移除旧的 input-error（若存在），强制重排以重启动画
 *   2. 添加 input-error（触发 CSS 抖动 + 红色边框）
 *   3. 定时移除（避免长时间保留红色边框）
 *   4. 立即聚焦以便用户修正
 *
 * @param {HTMLElement} element
 */
function triggerInputErrorFeedback(element) {
    if (!element) return;

    // 清除可能残留的定时器
    if (inputErrorTimer) {
        clearTimeout(inputErrorTimer);
        inputErrorTimer = null;
    }

    // 强制重排以重启动画：先移除类，读取 offsetWidth 后再添加
    element.classList.remove('input-error');
    // eslint-disable-next-line no-unused-expressions
    void element.offsetWidth;
    element.classList.add('input-error');

    // 定时移除类
    inputErrorTimer = setTimeout(function () {
        inputErrorTimer = null;
        if (element) {
            element.classList.remove('input-error');
        }
    }, INPUT_ERROR_SHAKE_DURATION_MS);

    // 聚焦以便用户立即修正
    element.focus();
}

/**
 * 根据当前主列表的卡片布局，计算编辑模态框的尺寸，
 * 并写入 CSS 变量 --modal-card-width-edit-dynamic 与
 * --modal-card-height-edit-dynamic。
 *
 * 【基准宽度的定义】
 *   基准宽度 = .card-actions 左边缘 − .card-index 左边缘
 *   即：从序号（#N）左边缘到功能按钮区左边缘的水平距离。
 *   这正是用户视觉上"文字区"的自然边界。
 *
 * 【宽度】
 *   模态框宽度 = 基准宽度 × 2/3
 *   下限 360px：保证极端窄屏上编辑框仍可使用
 *   上限 800px：避免超宽屏上编辑框过宽
 *
 * 【高度】
 *   模态框高度 = 视口高度 × 1/2
 *   下限 360px：保证极端矮屏上编辑框仍可使用
 *
 * 【测量策略】
 *   使用 getBoundingClientRect() 获取视口坐标系下的位置，
 *   避免依赖 offsetParent 的定位链（不同层级的元素 offsetLeft
 *   参考系不同，容易踩坑）。
 *
 *   侧边栏展开状态天然反映在 .card-index / .card-actions 的
 *   实测位置中，无需额外判断。
 *
 * 【空状态处理】
 *   若当前标签下无语句（主列表处于空状态），
 *   则 document.querySelector('.statement-card') 返回 null，
 *   函数直接 return，CSS 变量保持 tokens.css 中的默认值。
 *
 * @returns {void}
 */
function computeAndApplyEditModalSize() {
    const cardElement = document.querySelector('.statement-card');
    if (!cardElement) return;

    const cardIndexElement = cardElement.querySelector('.card-index');
    const cardActionsElement = cardElement.querySelector('.card-actions');
    if (!cardIndexElement || !cardActionsElement) return;

    const cardIndexRect = cardIndexElement.getBoundingClientRect();
    const cardActionsRect = cardActionsElement.getBoundingClientRect();

    // 基准宽度：从序号左边缘 → 按钮区左边缘
    const baseWidth = cardActionsRect.left - cardIndexRect.left;
    if (baseWidth <= 0) return;

    // 宽度：基准宽度 × 2/3，钳制到 [360, 800]
    const desiredWidth = Math.round(baseWidth * 2 / 3);
    const safeWidth = Math.max(360, Math.min(800, desiredWidth));

    // 高度：视口 1/2，下限 360px
    const desiredHeight = Math.round(window.innerHeight / 2);
    const safeHeight = Math.max(360, desiredHeight);

    // 写入 CSS 变量（作用在 :root 上，全部元素继承）
    document.documentElement.style.setProperty(
        '--modal-card-width-edit-dynamic',
        safeWidth + 'px'
    );
    document.documentElement.style.setProperty(
        '--modal-card-height-edit-dynamic',
        safeHeight + 'px'
    );
}

/**
 * 绑定窗口 resize 监听（只绑定一次）
 *
 * 若编辑模态框当前处于打开状态，窗口 resize 时重新计算尺寸，
 * 保证模态框在侧边栏展开/收起或窗口尺寸变化后仍按 2/3 比例显示。
 */
function bindResizeListenerOnce() {
    if (resizeListenerBound) return;
    resizeListenerBound = true;

    window.addEventListener('resize', function () {
        // 仅当编辑模态框正在显示时才重新计算
        if (modalElement
            && modalElement.style.display === 'flex'
            && currentResolve) {
            computeAndApplyEditModalSize();
        }
    }, { passive: true });
}

function handleSave() {
    const text = textareaElement.value.trim();
    if (!text) {
        triggerInputErrorFeedback(textareaElement);
        return;
    }
    const resolver = cleanup();
    if (resolver) resolver({ text: text });
}

function handleCancel() {
    const resolver = cleanup();
    if (resolver) resolver(null);
}

function handleBackdropClick(event) {
    if (event.target === modalElement) handleCancel();
}

function handleKeydown(event) {
    if (event.key === 'Escape') {
        event.preventDefault();
        // 阻断冒泡到 document，避免 shortcuts.js 同时处理
        event.stopPropagation();
        handleCancel();
        return;
    }
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
        // 输入法合成中的回车不触发保存
        if (event.isComposing || event.keyCode === 229) return;
        event.preventDefault();
        handleSave();
    }
}

/**
 * 打开编辑模态框
 * @param {{ initialText: string }} options
 * @returns {Promise<{ text: string } | null>}
 */
export function openEditModal(options) {
    if (!modalElement) {
        modalElement = buildModal();
        textareaElement = modalElement.querySelector('#editTextarea');
        saveButton = modalElement.querySelector('#saveEditBtn');
        cancelButton = modalElement.querySelector('#cancelEditBtn');
    }
    if (currentResolve) {
        const oldResolver = currentResolve;
        currentResolve = null;
        oldResolver(null);
        cleanup();
    }

    // 【本次重构】打开前根据当前主列表布局动态计算模态框尺寸
    computeAndApplyEditModalSize();

    // 【本次重构】确保 resize 监听已绑定（只需一次）
    bindResizeListenerOnce();

    textareaElement.value = options.initialText || '';
    textareaElement.classList.remove('input-error');
    modalElement.style.display = 'flex';
    saveButton.addEventListener('click', handleSave);
    cancelButton.addEventListener('click', handleCancel);
    modalElement.addEventListener('click', handleBackdropClick);
    textareaElement.addEventListener('keydown', handleKeydown);

    setTimeout(function () {
        textareaElement.focus();
        textareaElement.select();
    }, EDIT_MODAL_FOCUS_DELAY_MS);

    return new Promise(function (resolve) {
        currentResolve = resolve;
    });
}

/**
 * 强制关闭当前编辑框（视为取消）
 * @returns {boolean} true 表示确实关闭了弹窗；false 表示当前没有弹窗
 */
export function forceCloseEditModal() {
    if (!currentResolve) return false;
    const resolver = currentResolve;
    currentResolve = null;
    cleanup();
    resolver(null);
    return true;
}