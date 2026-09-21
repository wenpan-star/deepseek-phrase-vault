// filename: src/views/search-bar.js
// ========================================================================
// DeepSeek 语句工坊 · 搜索栏视图
// 包含输入框、正则开关、作用域切换、清除按钮
// 通过回调通知外部，不直接操作状态
//
// 【本轮深度审核修复（第一批）】
//   L1（死代码）：删除未使用的 getSearchInputValue 导出。
//
//     背景：
//       getSearchInputValue 是一个通用的"读输入框当前值"工具函数，
//       但项目实际路径是：
//         · searchInput 的 input 事件直接派发 onKeywordChange
//         · updateSearchBarUI 通过 state.keyword 单向刷新
//         · 从未有任何模块 import 或调用 getSearchInputValue
//
//     决策：
//       删除。理由：
//         1. 减少代码体积
//         2. 避免"看起来有读输入值的工具，实际各处直接读 DOM"
//            造成的认知负担
//         3. 若未来需要，重新加入只需几行
// ========================================================================

import { $ } from '../utils/dom.js';
import { SEARCH_SCOPE_LOCAL, SEARCH_SCOPE_GLOBAL } from '../constants.js';

let searchInput = null;
let clearButton = null;
let regexToggle = null;
let scopeButton = null;
let isProgrammaticUpdate = false;
let handlers = {
    onKeywordChange: function () {},
    onRegexToggle: function () {},
    onScopeToggle: function () {},
    onClear: function () {}
};

/**
 * 初始化搜索栏
 * @param {{
 *   onKeywordChange: (keyword: string) => void,
 *   onRegexToggle: (useRegex: boolean) => void,
 *   onScopeToggle: (scope: string) => void,
 *   onClear: () => void
 * }} options
 */
export function initializeSearchBar(options) {
    handlers = Object.assign(handlers, options || {});
    searchInput = $('#searchInput');
    clearButton = $('#clearSearchBtn');
    regexToggle = $('#regexToggleBtn');
    scopeButton = $('#searchScopeBtn');

    if (searchInput) {
        searchInput.addEventListener('input', function (event) {
            if (isProgrammaticUpdate) return;
            handlers.onKeywordChange(event.target.value);
        });
    }

    if (clearButton) {
        clearButton.addEventListener('click', function () {
            isProgrammaticUpdate = true;
            if (searchInput) searchInput.value = '';
            isProgrammaticUpdate = false;
            handlers.onClear();
        });
    }

    if (regexToggle) {
        regexToggle.addEventListener('click', function () {
            const nextUseRegex = !regexToggle.classList.contains('active');
            handlers.onRegexToggle(nextUseRegex);
        });
    }

    if (scopeButton) {
        scopeButton.addEventListener('click', function () {
            const currentScope = scopeButton.classList.contains('global-active')
                ? SEARCH_SCOPE_GLOBAL
                : SEARCH_SCOPE_LOCAL;
            const nextScope = currentScope === SEARCH_SCOPE_LOCAL
                ? SEARCH_SCOPE_GLOBAL
                : SEARCH_SCOPE_LOCAL;
            handlers.onScopeToggle(nextScope);
        });
    }
}

/**
 * 根据外部状态刷新搜索栏 UI
 * @param {{ keyword: string, useRegex: boolean, searchScope: string }} state
 */
export function updateSearchBarUI(state) {
    if (!searchInput) return;

    if (searchInput.value !== state.keyword) {
        isProgrammaticUpdate = true;
        searchInput.value = state.keyword;
        isProgrammaticUpdate = false;
    }

    if (clearButton) {
        clearButton.style.display = state.keyword ? 'flex' : 'none';
    }

    if (regexToggle) {
        regexToggle.classList.toggle('active', !!state.useRegex);
    }

    if (scopeButton) {
        const isGlobal = state.searchScope === SEARCH_SCOPE_GLOBAL;
        scopeButton.classList.toggle('global-active', isGlobal);
        scopeButton.innerHTML = isGlobal
            ? '<i class="fas fa-globe" aria-hidden="true"></i>'
            : '<i class="fas fa-tag" aria-hidden="true"></i>';
        scopeButton.title = isGlobal
            ? '当前：全局搜索。点击切换到仅搜索当前标签'
            : '当前：仅搜索当前标签。点击切换全局搜索';
    }
}

/**
 * 聚焦搜索框（供快捷键调用）
 */
export function focusSearchInput() {
    if (searchInput) {
        searchInput.focus();
        searchInput.select();
    }
}

/**
 * 让搜索框失焦
 */
export function blurSearchInput() {
    if (searchInput) searchInput.blur();
}