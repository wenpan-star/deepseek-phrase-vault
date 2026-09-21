// filename: src/views/header.js
// ========================================================================
// DeepSeek 语句工坊 · 顶栏视图
// 包含统计徽章与导出/导入/重置三个按钮
// 搜索相关 UI 在 search-bar.js 中独立处理
//
// 【无障碍修复】
//   <label for="importFileInput" role="button" tabindex="0"> 已声明为按钮，
//   但 <label> 默认不响应 Enter / Space。此处补键盘处理。
// ========================================================================

import { $ } from '../utils/dom.js';

let statCounterElement = null;
let exportButton = null;
let importFileInput = null;
let resetButton = null;
let handlers = {
    onExport: function () {},
    onImport: function () {},
    onReset: function () {}
};

/**
 * 初始化顶栏
 * @param {{
 *   onExport: () => void,
 *   onImport: (file: File) => void,
 *   onReset: () => void
 * }} options
 */
export function initializeHeader(options) {
    handlers = Object.assign(handlers, options || {});
    statCounterElement = $('#statCounter');
    exportButton = $('#exportBtn');
    importFileInput = $('#importFileInput');
    resetButton = $('#resetDefaultBtn');

    if (exportButton) {
        exportButton.addEventListener('click', function () {
            handlers.onExport();
        });
    }
    if (importFileInput) {
        importFileInput.addEventListener('change', function (event) {
            const file = event.target.files && event.target.files[0];
            if (file) handlers.onImport(file);
            event.target.value = '';
        });

        // 为导入 <label> 补键盘支持（Enter / Space 触发点击）
        const importLabelElement = document.querySelector('label[for="importFileInput"]');
        if (importLabelElement) {
            importLabelElement.addEventListener('keydown', function (event) {
                if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    importFileInput.click();
                }
            });
        }
    }
    if (resetButton) {
        resetButton.addEventListener('click', function () {
            handlers.onReset();
        });
    }
}

/**
 * 更新统计数字
 * @param {number} count
 */
export function updateHeaderStats(count) {
    if (!statCounterElement) return;
    const spanElement = statCounterElement.querySelector('span');
    if (spanElement) spanElement.innerText = String(count);
}