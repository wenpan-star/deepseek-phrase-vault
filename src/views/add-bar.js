// filename: src/views/add-bar.js
// ========================================================================
// DeepSeek 语句工坊 · 底部添加栏
// 输入框 + 添加按钮，回车亦可提交
//
// 【中文输入法兼容】
//   使用 keydown + isComposing 判定，避免拼音 / 五笔 / 日文输入法
//   在"确认候选词"时按回车被误判为提交。
//   keypress 已废弃且在部分移动浏览器不可靠，统一改用 keydown。
// ========================================================================

import { $ } from '../utils/dom.js';

let inputElement = null;
let buttonElement = null;
let handlers = {
    onAdd: function () {}
};

/**
 * 初始化添加栏
 * @param {{ onAdd: (text: string) => void }} options
 */
export function initializeAddBar(options) {
    handlers = Object.assign(handlers, options || {});
    inputElement = $('#newStatementInput');
    buttonElement = $('#addStatementBtn');

    if (buttonElement) {
        buttonElement.addEventListener('click', function () {
            submit();
        });
    }
    if (inputElement) {
        inputElement.addEventListener('keydown', function (event) {
            if (event.key !== 'Enter') return;
            // 输入法合成中的回车（确认候选词）不应触发提交
            if (event.isComposing || event.keyCode === 229) return;
            event.preventDefault();
            submit();
        });
    }
}

function submit() {
    if (!inputElement) return;
    const text = inputElement.value.trim();
    if (!text) return;
    handlers.onAdd(text);
}

/**
 * 清空输入框
 */
export function clearAddBarInput() {
    if (inputElement) inputElement.value = '';
}

/**
 * 聚焦添加输入框
 */
export function focusAddBarInput() {
    if (inputElement) {
        inputElement.focus();
        inputElement.select();
    }
}