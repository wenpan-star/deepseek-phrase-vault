// filename: src/views/modals/tag.js
// ========================================================================
// DeepSeek 语句工坊 · 新建 / 编辑标签模态框
// 返回 Promise<{ name: string, color: string|null, categoryId: string } | null>
//
// 【修复要点（历史）】
//   1. Escape 加 stopPropagation()
//   2. Enter 加 isComposing 判定
//   3. forceCloseTagModal 返回布尔值
//
// 【本次改进（历史）】
//   空名称确认时不再静默 focus，而是：
//     - 给 nameInput 添加 .input-error 类触发抖动动画与红色边框
//     - 立即聚焦 input
//   与 edit.js 的空文本反馈策略保持一致。
//
// 【分类层级（本模块基础）】
//   1. 新增"所属分类"下拉选择器。
//      位置：名称输入框之后、颜色选择器之前。
//
//      为什么放在颜色之前：
//        · 分类归属是更"结构性"的信息，用户先想清楚"放哪个分类"
//        · 颜色是更"装饰性"的选择，放后面更符合决策顺序
//        · 与"先选分类再选颜色"的直觉一致
//
//   2. openTagModal 增加 categories 与 initialCategoryId 参数：
//        · categories：当前 vault 的所有分类（用于填充下拉选项）
//        · initialCategoryId：初始选中的分类 id
//
//   3. 返回值增加 categoryId 字段：
//        · 用户在下拉中选择的分类 id
//
//   4. 分类下拉的语义：
//        · 用户切换分类通过此下拉完成（不通过拖拽）
//        · 理由：触屏设备也可用，操作明确，实现简单
//
// 【Bug 3 修复 · currentCategories 校验启用】
//   背景：
//     本模块声明了 currentCategories 变量并在 openTagModal 中赋值，
//     注释声明"用于 handleConfirm 时校验分类 id 的合法性（防御性）"，
//     但 handleConfirm 实际上**未使用**该变量。
//     这是一个半成品实现——承诺的防御性校验从未落地。
//
//   当前为何不触发问题：
//     默认分类始终存在（normalizeCategories 保证），
//     下拉选项始终至少包含默认分类，用户不可能选中一个不存在的分类 id。
//     所以这个 bug 是"逻辑完整性问题"，不是"用户可感知的功能问题"。
//
//   修复方案：
//     在 handleConfirm 中对选中的分类 id 做存在性校验：
//       · 若为空 → 回退 DEFAULT_CATEGORY_ID
//       · 若不在 currentCategories 中 → 回退 DEFAULT_CATEGORY_ID
//     这是对"未来可能新增的边界场景"的防御（例如：分类列表在
//     打开模态框后被其他操作清空）。
//
//   为什么不删除这个半成品：
//     用户明确要求"不得删除、降级或绕过任何现有功能"。
//     半成品本身是"承诺的功能"，正确做法是**补齐实现**而非删除承诺。
// ========================================================================

import {
    PRESET_COLORS,
    TAG_MODAL_FOCUS_DELAY_MS,
    INPUT_ERROR_SHAKE_DURATION_MS,
    DEFAULT_CATEGORY_ID,
    MAX_TAG_NAME_LENGTH
} from '../../constants.js';
import { escapeHtml } from '../../utils/dom.js';

// ---------- 模块级 DOM 缓存 ----------
let modalElement = null;
let titleElement = null;
let nameInput = null;
let categorySelect = null;
let colorContainer = null;
let confirmButton = null;
let cancelButton = null;

// ---------- 生命周期状态 ----------
let currentResolve = null;
let currentColor = null;
let isEditMode = false;
let inputErrorTimer = null;

// ---------- 当前可选分类列表（本次交互） ----------
// 每次 openTagModal 时由参数覆盖。
// 用于 handleConfirm 时校验分类 id 的合法性（Bug 3 修复）。
let currentCategories = [];

/**
 * 构建模态框 DOM（首次调用时执行）
 * @returns {HTMLElement}
 */
function buildModal() {
    const modal = document.createElement('div');
    modal.id = 'tagModal';
    modal.className = 'modal';
    modal.innerHTML = `
        <div class="modal-card">
            <h3 id="tagModalTitle">
                <i class="fas fa-tag" aria-hidden="true"></i> 标签
            </h3>
            <input
                type="text"
                id="tagNameInput"
                placeholder="标签名称"
                maxlength="${MAX_TAG_NAME_LENGTH}"
                aria-label="标签名称">
            <label class="form-label" for="tagCategorySelect">所属分类</label>
            <select id="tagCategorySelect" class="form-select" aria-label="所属分类"></select>
            <div class="color-label">标签颜色</div>
            <div id="colorPickerContainer" class="color-picker-row"></div>
            <div class="modal-actions">
                <button class="btn btn-outline" id="cancelTagBtn" type="button">取消</button>
                <button class="btn btn-primary" id="confirmTagBtn" type="button">确定</button>
            </div>
        </div>
    `;
    document.body.appendChild(modal);
    return modal;
}

/**
 * 渲染分类下拉选项
 *
 * @param {Array<{id: string, name: string}>} categories
 * @param {string} selectedCategoryId
 */
function renderCategoryOptions(categories, selectedCategoryId) {
    categorySelect.innerHTML = '';

    let hasSelectedMatch = false;
    for (const category of categories) {
        const option = document.createElement('option');
        option.value = category.id;
        option.textContent = category.name;
        if (category.id === selectedCategoryId) {
            option.selected = true;
            hasSelectedMatch = true;
        }
        categorySelect.appendChild(option);
    }

    // 防御：若 selectedCategoryId 不在列表中（例如标签的 categoryId
    // 指向已被删除的分类，理论不会，normalizeVault 已保证），
    // 回退选中第一个选项（默认分类始终在第一位）
    if (!hasSelectedMatch && categories.length > 0) {
        categorySelect.selectedIndex = 0;
    }
}

/**
 * 渲染颜色选择器
 */
function renderColorPicker() {
    colorContainer.innerHTML = '';
    PRESET_COLORS.forEach(function (color) {
        const circle = document.createElement('div');
        circle.className = 'color-circle' + (color === currentColor ? ' selected' : '');
        circle.style.backgroundColor = color;
        circle.setAttribute('role', 'button');
        circle.setAttribute('aria-label', '颜色 ' + color);
        circle.addEventListener('click', function () {
            currentColor = color;
            updateColorSelection();
        });
        colorContainer.appendChild(circle);
    });
    const noneCircle = document.createElement('div');
    noneCircle.className = 'color-circle' + (currentColor === null ? ' selected' : '');
    noneCircle.style.backgroundColor = '#e0e0e0';
    noneCircle.title = '无颜色';
    noneCircle.setAttribute('role', 'button');
    noneCircle.setAttribute('aria-label', '无颜色');
    noneCircle.addEventListener('click', function () {
        currentColor = null;
        updateColorSelection();
    });
    colorContainer.appendChild(noneCircle);
}

/**
 * 更新颜色选择器的选中状态
 */
function updateColorSelection() {
    const circles = colorContainer.querySelectorAll('.color-circle');
    circles.forEach(function (circle, index) {
        circle.classList.remove('selected');
        if (currentColor === null && index === circles.length - 1) {
            circle.classList.add('selected');
        } else if (PRESET_COLORS[index] === currentColor) {
            circle.classList.add('selected');
        }
    });
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
 * 确认：读取名称、颜色、分类并 resolve
 *
 * 【Bug 3 修复】
 *   对选中的分类 id 做存在性校验：
 *     · 若为空 → 回退 DEFAULT_CATEGORY_ID
 *     · 若不在 currentCategories 中 → 回退 DEFAULT_CATEGORY_ID
 *
 *   防御的场景（当前不可触发，但属于契约保证）：
 *     · 未来分类列表可能因某种原因与下拉选项不一致
 *     · 用户通过开发者工具修改下拉选项的 value
 */
function handleConfirm() {
    const name = nameInput.value.trim();
    if (!name) {
        triggerInputErrorFeedback(nameInput);
        return;
    }

    // 分类 id 兜底：若下拉为空（理论不会），回退默认分类
    let selectedCategoryId = categorySelect.value;
    if (!selectedCategoryId) {
        selectedCategoryId = DEFAULT_CATEGORY_ID;
    }

    // 【Bug 3 修复】防御性校验：选中的分类必须在可选列表中
    const isCategoryValid = currentCategories.some(function (category) {
        return category.id === selectedCategoryId;
    });
    if (!isCategoryValid) {
        selectedCategoryId = DEFAULT_CATEGORY_ID;
    }

    const resolver = cleanup();
    if (resolver) {
        resolver({
            name: name,
            color: currentColor,
            categoryId: selectedCategoryId
        });
    }
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
 * 打开标签模态框
 *
 * @param {{
 *   mode: 'create' | 'edit',
 *   initialName?: string,
 *   initialColor?: string|null,
 *   categories: Array<{id: string, name: string}>,
 *   initialCategoryId?: string
 * }} options
 * @returns {Promise<{ name: string, color: string|null, categoryId: string } | null>}
 */
export function openTagModal(options) {
    if (!modalElement) {
        modalElement = buildModal();
        titleElement = modalElement.querySelector('#tagModalTitle');
        nameInput = modalElement.querySelector('#tagNameInput');
        categorySelect = modalElement.querySelector('#tagCategorySelect');
        colorContainer = modalElement.querySelector('#colorPickerContainer');
        confirmButton = modalElement.querySelector('#confirmTagBtn');
        cancelButton = modalElement.querySelector('#cancelTagBtn');
    }

    // 若已有打开的标签模态框，先关闭旧实例（视为取消）
    if (currentResolve) {
        const oldResolver = currentResolve;
        currentResolve = null;
        oldResolver(null);
        cleanup();
    }

    isEditMode = options.mode === 'edit';
    titleElement.innerHTML = isEditMode
        ? '<i class="fas fa-edit" aria-hidden="true"></i> 编辑标签'
        : '<i class="fas fa-plus" aria-hidden="true"></i> 新建标签';

    nameInput.value = options.initialName || '';
    nameInput.classList.remove('input-error');

    // 保存本次可选分类列表（用于 handleConfirm 时的防御性校验）
    // 【Bug 3 修复】此变量现在被 handleConfirm 实际使用
    currentCategories = Array.isArray(options.categories)
        ? options.categories
        : [];

    // 渲染分类下拉
    const initialCategoryId = options.initialCategoryId
        ? String(options.initialCategoryId)
        : DEFAULT_CATEGORY_ID;
    renderCategoryOptions(currentCategories, initialCategoryId);

    // 渲染颜色选择器
    currentColor = options.initialColor === undefined ? null : options.initialColor;
    renderColorPicker();

    // 显示模态框并绑定事件
    modalElement.style.display = 'flex';
    confirmButton.addEventListener('click', handleConfirm);
    cancelButton.addEventListener('click', handleCancel);
    modalElement.addEventListener('click', handleBackdropClick);
    nameInput.addEventListener('keydown', handleKeydown);

    setTimeout(function () {
        nameInput.focus();
    }, TAG_MODAL_FOCUS_DELAY_MS);

    return new Promise(function (resolve) {
        currentResolve = resolve;
    });
}

/**
 * 强制关闭当前标签模态框（视为取消）
 *
 * 供 src/shortcuts.js 的 Esc 优先级链调用。
 * 与其他模态框的 forceCloseXxx 保持一致的返回语义：
 *   返回 true  = 当前有打开的模态框，已被关闭；
 *   返回 false = 当前无打开的模态框，未做任何事。
 *
 * @returns {boolean}
 */
export function forceCloseTagModal() {
    if (!currentResolve) return false;
    const resolver = currentResolve;
    currentResolve = null;
    cleanup();
    resolver(null);
    return true;
}