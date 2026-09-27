// filename: src/views/modals/category.js
// ========================================================================
// DeepSeek 语句工坊 · 新建 / 编辑分类模态框
// 返回 Promise<{ name: string } | null>
//
// 【本次重构 · 分类层级（新建）】
//   本模块与 tag.js 同构（去掉颜色选择器），负责分类的
//   "新建 / 重命名"交互。
//
//   设计要点（与 tag.js 一致，保持交互一致性）：
//     1. Escape 加 stopPropagation()：避免 document 级监听器同时触发
//     2. Enter 提交时加 isComposing 判定：避免中文输入法下误提交
//     3. forceCloseCategoryModal 返回布尔值：供 shortcuts.js 判断
//     4. 空名称确认时不再静默 focus，而是给 nameInput 添加 .input-error
//        类触发抖动动画与红色边框，与 edit.js / tag.js 保持一致
//     5. 焦点延迟使用 CATEGORY_MODAL_FOCUS_DELAY_MS（与 TAG 一致）
//
//   与 tag.js 的差异：
//     · 无颜色选择器（分类不参与色点标识，减少视觉噪音）
//     · 无初始颜色参数
//     · 返回 { name } 而非 { name, color }
//     · 使用不同的 DOM id（categoryModal / categoryNameInput 等）
//     · 使用不同的 CSS 类（category-modal 便于在样式层独立调整）
//
//   为什么"分类无颜色"：
//     · 标签已有色点，分类再加会造成视觉噪音
//     · 分类的视觉区分通过"折叠箭头 + 文件夹图标 + 层级缩进"实现
//     · 用户日常使用中"分类"的语义是"结构容器"，
//       不需要颜色来传达额外信息
//
// 【本轮深度审核（第一批 / 第二批）】
//   本模块无需逻辑修改。
// ========================================================================

import {
    CATEGORY_MODAL_FOCUS_DELAY_MS,
    INPUT_ERROR_SHAKE_DURATION_MS,
    MAX_TAG_NAME_LENGTH
} from '../../constants.js';

// ---------- 模块级 DOM 缓存 ----------
let modalElement = null;
let titleElement = null;
let nameInput = null;
let confirmButton = null;
let cancelButton = null;

// ---------- 生命周期状态 ----------
let currentResolve = null;
let isEditMode = false;
let inputErrorTimer = null;

/**
 * 构建模态框 DOM（首次调用时执行）
 * @returns {HTMLElement}
 */
function buildModal() {
    const modal = document.createElement('div');
    modal.id = 'categoryModal';
    modal.className = 'modal';
    modal.innerHTML = `
        <div class="modal-card">
            <h3 id="categoryModalTitle">
                <i class="fas fa-folder" aria-hidden="true"></i> 分类
            </h3>
            <input
                type="text"
                id="categoryNameInput"
                placeholder="分类名称"
                maxlength="${MAX_TAG_NAME_LENGTH}"
                aria-label="分类名称">
            <div class="modal-actions">
                <button class="btn btn-outline" id="cancelCategoryBtn" type="button">取消</button>
                <button class="btn btn-primary" id="confirmCategoryBtn" type="button">确定</button>
            </div>
        </div>
    `;
    document.body.appendChild(modal);
    return modal;
}

/**
 * 清理：隐藏模态框、移除事件监听、清除定时器与错误状态
 * @returns {Function|null} 未完成的 Promise resolver（若有）
 */
function cleanup() {
    if (!modalElement) return null;
    modalElement.style.display = 'none';
    confirmButton.removeEventListener('click', handleConfirm);
    cancelButton.removeEventListener('click', handleCancel);
    modalElement.removeEventListener('click', handleBackdropClick);
    nameInput.removeEventListener('keydown', handleKeydown);

    // 清理可能残留的输入错误状态与定时器
    if (inputErrorTimer) {
        clearTimeout(inputErrorTimer);
        inputErrorTimer = null;
    }
    if (nameInput) {
        nameInput.classList.remove('input-error');
    }

    const resolver = currentResolve;
    currentResolve = null;
    return resolver;
}

/**
 * 触发输入错误反馈：抖动 + 红色边框 + 聚焦
 *
 * 【为什么用强制重排重启动画】
 *   若连续两次触发错误反馈，直接 add/remove 同一个类不会重启动画。
 *   通过 void element.offsetWidth 触发同步重排，浏览器会认为
 *   元素样式发生了"实际变化"，从而重新播放 CSS 动画。
 *
 * @param {HTMLElement} element
 */
function triggerInputErrorFeedback(element) {
    if (!element) return;

    if (inputErrorTimer) {
        clearTimeout(inputErrorTimer);
        inputErrorTimer = null;
    }

    element.classList.remove('input-error');
    // eslint-disable-next-line no-unused-expressions
    void element.offsetWidth;
    element.classList.add('input-error');

    inputErrorTimer = setTimeout(function () {
        inputErrorTimer = null;
        if (element) {
            element.classList.remove('input-error');
        }
    }, INPUT_ERROR_SHAKE_DURATION_MS);

    element.focus();
}

/**
 * 确认：读取名称并 resolve
 */
function handleConfirm() {
    const name = nameInput.value.trim();
    if (!name) {
        triggerInputErrorFeedback(nameInput);
        return;
    }
    const resolver = cleanup();
    if (resolver) resolver({ name: name });
}

/**
 * 取消：resolve null
 */
function handleCancel() {
    const resolver = cleanup();
    if (resolver) resolver(null);
}

/**
 * 点击背景关闭（视为取消）
 * @param {MouseEvent} event
 */
function handleBackdropClick(event) {
    if (event.target === modalElement) handleCancel();
}

/**
 * 键盘事件：Escape 取消 / Enter 提交
 * @param {KeyboardEvent} event
 */
function handleKeydown(event) {
    if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        handleCancel();
        return;
    }
    if (event.key === 'Enter') {
        // 输入法合成中的回车不触发确认
        if (event.isComposing || event.keyCode === 229) return;
        event.preventDefault();
        handleConfirm();
    }
}

/**
 * 打开分类模态框
 *
 * @param {{
 *   mode: 'create' | 'edit',
 *   initialName?: string
 * }} options
 * @returns {Promise<{ name: string } | null>}
 */
export function openCategoryModal(options) {
    if (!modalElement) {
        modalElement = buildModal();
        titleElement = modalElement.querySelector('#categoryModalTitle');
        nameInput = modalElement.querySelector('#categoryNameInput');
        confirmButton = modalElement.querySelector('#confirmCategoryBtn');
        cancelButton = modalElement.querySelector('#cancelCategoryBtn');
    }

    // 若已有打开的分类模态框，先关闭旧实例（视为取消）
    if (currentResolve) {
        const oldResolver = currentResolve;
        currentResolve = null;
        oldResolver(null);
        cleanup();
    }

    isEditMode = options.mode === 'edit';
    titleElement.innerHTML = isEditMode
        ? '<i class="fas fa-edit" aria-hidden="true"></i> 编辑分类'
        : '<i class="fas fa-folder-plus" aria-hidden="true"></i> 新建分类';

    nameInput.value = options.initialName || '';
    nameInput.classList.remove('input-error');

    modalElement.style.display = 'flex';
    confirmButton.addEventListener('click', handleConfirm);
    cancelButton.addEventListener('click', handleCancel);
    modalElement.addEventListener('click', handleBackdropClick);
    nameInput.addEventListener('keydown', handleKeydown);

    setTimeout(function () {
        nameInput.focus();
        // 编辑模式下选中已有文本，便于用户直接输入替换
        if (isEditMode && nameInput.value) {
            nameInput.select();
        }
    }, CATEGORY_MODAL_FOCUS_DELAY_MS);

    return new Promise(function (resolve) {
        currentResolve = resolve;
    });
}

/**
 * 强制关闭当前分类模态框（视为取消）
 *
 * 供 src/shortcuts.js 的 Esc 优先级链调用。
 * 与其他模态框的 forceCloseXxx 保持一致的返回语义：
 *   返回 true  = 当前有打开的模态框，已被关闭；
 *   返回 false = 当前无打开的模态框，未做任何事。
 *
 * @returns {boolean}
 */
export function forceCloseCategoryModal() {
    if (!currentResolve) return false;
    const resolver = currentResolve;
    currentResolve = null;
    cleanup();
    resolver(null);
    return true;
}