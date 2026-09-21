// filename: src/views/modals/tag.js
// ========================================================================
// DeepSeek 语句工坊 · 新建 / 编辑标签模态框
// 返回 Promise<{ name: string, color: string|null } | null>
//
// 【修复要点】
//   1. Escape 加 stopPropagation()
//   2. Enter 加 isComposing 判定
//   3. forceCloseTagModal 返回布尔值
//
// 【本次改进】
//   空名称确认时不再静默 focus，而是：
//     - 给 nameInput 添加 .input-error 类触发抖动动画与红色边框
//     - 立即聚焦 input
//   与 edit.js 的空文本反馈策略保持一致。
// ========================================================================

import {
    PRESET_COLORS,
    TAG_MODAL_FOCUS_DELAY_MS,
    INPUT_ERROR_SHAKE_DURATION_MS
} from '../../constants.js';
import { escapeHtml } from '../../utils/dom.js';

let modalElement = null;
let titleElement = null;
let nameInput = null;
let colorContainer = null;
let confirmButton = null;
let cancelButton = null;
let currentResolve = null;
let currentColor = null;
let isEditMode = false;
let inputErrorTimer = null;

function buildModal() {
    const modal = document.createElement('div');
    modal.id = 'tagModal';
    modal.className = 'modal';
    modal.innerHTML = `
        <div class="modal-card">
            <h3 id="tagModalTitle"><i class="fas fa-tag" aria-hidden="true"></i> 标签</h3>
            <input type="text" id="tagNameInput" placeholder="标签名称" maxlength="20" aria-label="标签名称">
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

function handleConfirm() {
    const name = nameInput.value.trim();
    if (!name) {
        triggerInputErrorFeedback(nameInput);
        return;
    }
    const resolver = cleanup();
    if (resolver) resolver({ name: name, color: currentColor });
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
 * @param {{ mode: 'create'|'edit', initialName?: string, initialColor?: string|null }} options
 * @returns {Promise<{ name: string, color: string|null } | null>}
 */
export function openTagModal(options) {
    if (!modalElement) {
        modalElement = buildModal();
        titleElement = modalElement.querySelector('#tagModalTitle');
        nameInput = modalElement.querySelector('#tagNameInput');
        colorContainer = modalElement.querySelector('#colorPickerContainer');
        confirmButton = modalElement.querySelector('#confirmTagBtn');
        cancelButton = modalElement.querySelector('#cancelTagBtn');
    }
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
    currentColor = options.initialColor === undefined ? null : options.initialColor;
    renderColorPicker();

    modalElement.style.display = 'flex';
    confirmButton.addEventListener('click', handleConfirm);
    cancelButton.addEventListener('click', handleCancel);
    modalElement.addEventListener('click', handleBackdropClick);
    nameInput.addEventListener('keydown', handleKeydown);
    setTimeout(function () { nameInput.focus(); }, TAG_MODAL_FOCUS_DELAY_MS);

    return new Promise(function (resolve) {
        currentResolve = resolve;
    });
}

/**
 * 强制关闭当前标签框
 * @returns {boolean} true 表示确实关闭了弹窗；false 表示当前没有弹窗
 */
export function forceCloseTagModal() {
    if (!currentResolve) return false;
    const resolver = currentResolve;
    currentResolve = null;
    cleanup();
    resolver(null);
    return true;
}