// filename: src/views/modals/confirm.js
// ========================================================================
// DeepSeek 语句工坊 · 自定义确认对话框
// 返回 Promise<boolean>，DOM 动态创建并注入 body
//
// 【本次改进 · N2 修复（历史）】
//   在"若已有打开的对话框，先取消"分支中补充 cleanup() 调用，
//   与 openEditModal / openTagModal / openSelectTagModal 保持一致。
//
//   背景：
//     四个模态框在"处理已存在的对话框"时的流程本应完全一致：
//       1. 取出旧的 resolver
//       2. 清空 currentResolve
//       3. 调用旧 resolver（返回"取消"语义）
//       4. 清理旧状态（cleanup）
//
//     但本文件此前遗漏了第 4 步，导致代码风格与其他三个模态框
//     不一致，容易在未来维护时被误认为"confirm 不需要 cleanup"。
//
//   影响评估：
//     cleanup() 内部会 removeEventListener 与清空定时器。
//     由于 addEventListener 对同一函数引用天然去重，本文件的
//     遗漏在当前场景下不产生可见 bug。
//     但代码一致性是长期可维护性的基础，因此补齐。
//
// 【本轮深度审核（第三批）】
//   本模块无需逻辑修改。
// ========================================================================

let modalElement = null;
let messageElement = null;
let okButton = null;
let cancelButton = null;
let currentResolve = null;

function buildModal() {
    const modal = document.createElement('div');
    modal.id = 'confirmDialog';
    modal.className = 'modal confirm-dialog';
    modal.innerHTML = `
        <div class="modal-card">
            <div class="confirm-icon"><i class="fas fa-question-circle" aria-hidden="true"></i></div>
            <div class="confirm-message" id="confirmMessage"></div>
            <div class="confirm-actions">
                <button class="btn btn-outline" id="confirmCancelBtn" type="button">取消</button>
                <button class="btn btn-primary" id="confirmOkBtn" type="button">确定</button>
            </div>
        </div>
    `;
    document.body.appendChild(modal);
    return modal;
}

function cleanup() {
    if (!modalElement) return null;
    modalElement.style.display = 'none';
    modalElement.removeEventListener('click', handleBackdropClick);
    okButton.removeEventListener('click', handleOk);
    cancelButton.removeEventListener('click', handleCancel);
    const resolver = currentResolve;
    currentResolve = null;
    return resolver;
}

function handleOk() {
    const resolver = cleanup();
    if (resolver) resolver(true);
}

function handleCancel() {
    const resolver = cleanup();
    if (resolver) resolver(false);
}

function handleBackdropClick(event) {
    if (event.target === modalElement) {
        handleCancel();
    }
}

/**
 * 显示确认对话框
 * @param {string} message
 * @returns {Promise<boolean>} true=确认, false=取消
 */
export function showConfirmDialog(message) {
    if (!modalElement) {
        modalElement = buildModal();
        messageElement = modalElement.querySelector('#confirmMessage');
        okButton = modalElement.querySelector('#confirmOkBtn');
        cancelButton = modalElement.querySelector('#confirmCancelBtn');
    }

    // 若已有打开的对话框，先取消并清理旧状态
    // 顺序：
    //   1. 取出旧 resolver
    //   2. 清空 currentResolve（避免 cleanup 内部重复处理）
    //   3. 调用旧 resolver（返回"取消"语义）
    //   4. cleanup（移除事件监听、隐藏弹窗）
    if (currentResolve) {
        const oldResolver = currentResolve;
        currentResolve = null;
        oldResolver(false);
        cleanup();
    }

    messageElement.innerText = message;
    modalElement.style.display = 'flex';

    okButton.addEventListener('click', handleOk);
    cancelButton.addEventListener('click', handleCancel);
    modalElement.addEventListener('click', handleBackdropClick);

    return new Promise(function (resolve) {
        currentResolve = resolve;
    });
}

/**
 * 关闭当前确认框（视为取消）
 * @returns {boolean} true 表示确实关闭了弹窗；false 表示当前没有弹窗
 */
export function forceCloseConfirmDialog() {
    if (!currentResolve) return false;
    const resolver = currentResolve;
    currentResolve = null;
    cleanup();
    resolver(false);
    return true;
}