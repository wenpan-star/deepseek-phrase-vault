// filename: src/core/persist.js
// ========================================================================
// DeepSeek 语句工坊 · 持久化层
// 负责：从 localStorage 读取 → 解密 → 归一化；写入时 → 加密 → 配额检查
// 副作用集中地：本模块是唯一允许触碰 localStorage 的地方
// 竞态保护：写入队列 + 版本号，避免旧写入覆盖新写入
// 防抖：高频变更（搜索输入、滚动）走 saveVaultToStorageDebounced
//
// 【性能优化】
//   saveVaultToStorage 不再对 Vault 做完整 JSON 深拷贝。
//   原因：命令层全部为纯函数，每次返回新引用，旧引用不会被原地修改，
//         因此直接传入 vault 引用即可。encryptState 内部会做一次
//         JSON.stringify，无需重复。
//
// 【错误分类】
//   写入失败时，根据错误名区分两类常见故障，给用户更精确的提示：
//     - QuotaExceededError：存储配额耗尽 → "存储空间不足"
//     - SecurityError：隐私模式 / 策略禁用 → "浏览器禁止了本地存储"
//   其他未知错误回退到通用提示。
//
//   这一分类对用户体验很重要：在隐私模式下，即使用户清理了所有数据，
//   仍然会写入失败，"清理数据"这个提示反而误导用户。
//
// 【N1 修复（历史）】
//   移除了写入失败提示上的 `isCryptoAvailable()` 条件判断。
//
//   问题分析：
//     isCryptoAvailable() 判断的是"Web Crypto API 是否可用"，
//     与"localStorage 写入是否成功"完全无关。
//
//     在 crypto 不可用（降级为明文写入）的浏览器环境中，
//     localStorage 依然可能因配额耗尽或策略限制而写入失败。
//     旧实现在这些环境下会静默吞掉错误，用户完全看不到提示，
//     造成"以为保存成功，实际数据丢失"的严重后果。
//
//   修复：
//     任何写入失败都无条件提示用户。
//
// 【W3 修复（本轮）】
//   数据解密失败时的备份保护。
//
//   问题场景：
//     用户数据是加密的（crypto 可用时保存的）。之后环境变化
//     （例如企业策略更新禁用了 Web Crypto、浏览器版本回退、
//     隐私模式切换等），当前环境的 cryptoIsAvailable 变为 false。
//
//     decryptState 会尝试走明文路径 JSON.parse(encryptedBase64)，
//     但 Base64 字符串不是 JSON，因此失败返回 null。
//
//     loadVaultFromStorage 检测到解密失败后，**静默回退到内置预设**。
//     用户看到的是默认数据，原数据仍在 localStorage 中（未被读取）。
//     但用户任何操作触发 saveVaultToStorage 时，会用新的（预设）
//     数据覆盖原键，**原数据永久丢失**。
//
//   修复：
//     检测到 encryptedRaw 存在但 decryptState 返回 null（且返回的
//     对象不符合 vault 形状）时，在返回预设前：
//       1. 把 encryptedRaw 复制到备份键
//         STORAGE_KEY_ENCRYPTED_VAULT_BACKUP
//       2. 通过 safeToast 提示用户（提示仅一次，通过 sessionStorage 标志）
//     这样用户即使没注意到提示，也可以从备份键手动恢复。
//
//   为什么使用固定备份键而非时间戳键：
//     时间戳键会累积多个备份，快速耗尽 localStorage 配额。
//     固定键每次覆盖前一次，用户只需关注"最近一次备份"。
// ========================================================================

import {
    STORAGE_KEY_ENCRYPTED_VAULT,
    STORAGE_KEY_ENCRYPTED_VAULT_LEGACY_V3,
    STORAGE_KEY_ENCRYPTED_VAULT_BACKUP,
    MAX_LOCALSTORAGE_SIZE,
    PERSIST_DEBOUNCE_MS
} from '../constants.js';
import { encryptState, decryptState, isCryptoAvailable } from './crypto.js';
import {
    normalizeVault,
    ensureDefaultTagExists,
    createVaultFromBuiltinPreset
} from './vault.js';

let persistenceVersion = 0;
let persistenceQueue = Promise.resolve();

// 防抖状态
let debounceTimer = null;
let pendingDebounceSnapshot = null;
const pendingDebounceResolvers = [];
const pendingDebounceRejecters = [];

// 允许 facade 注入一个"提示消息"回调，避免 persist 直接依赖 UI
let toastHandler = null;

// 用于确保"数据解密失败"的提示在单次 session 内只出现一次
// 键名包含固定前缀，避免与业务数据冲突
const SESSION_KEY_DECRYPT_FAILURE_NOTIFIED = "ds_decrypt_failure_notified_v4";

/**
 * 注入 UI 提示回调（供 facade 在初始化时调用）
 * @param {(message: string, isError?: boolean) => void} handler
 */
export function setPersistToastHandler(handler) {
    toastHandler = handler;
}

function safeToast(message, isError) {
    if (typeof toastHandler === 'function') {
        try {
            toastHandler(message, isError);
        } catch (handlerError) {
            console.error('[persist] toast 处理异常:', handlerError);
        }
    }
}

/**
 * 从存储错误中提取用户可读的中文提示。
 *
 * 分类依据：
 *   - QuotaExceededError：标准名称（Chrome / Firefox / Edge 通用）
 *   - NS_ERROR_DOM_QUOTA_REACHED：Firefox 旧版的配额错误名
 *   - SecurityError：隐私模式 / 无痕窗口 / 企业策略禁用
 *
 * @param {Error} storageError
 * @returns {string}
 */
function describeStorageError(storageError) {
    const errorName = storageError && storageError.name
        ? String(storageError.name)
        : '';

    if (errorName === 'QuotaExceededError'
        || errorName === 'NS_ERROR_DOM_QUOTA_REACHED') {
        return '存储空间不足，请清理部分数据后重试';
    }

    if (errorName === 'SecurityError') {
        return '浏览器禁止了本地存储（可能处于隐私模式或策略限制）';
    }

    return '保存失败，请检查浏览器存储空间';
}

/**
 * 判断解密结果是否是合法的 vault 形状。
 *
 * 用于区分"解密成功且格式正确"（正常路径）与
 * "解密失败 / 格式非法"（需要备份保护的路径）。
 *
 * @param {*} decryptedResult
 * @returns {boolean}
 */
function isVaultShape(decryptedResult) {
    return Boolean(
        decryptedResult
        && typeof decryptedResult === 'object'
        && Array.isArray(decryptedResult.tags)
        && decryptedResult.statementsMap
        && typeof decryptedResult.statementsMap === 'object'
    );
}

/**
 * 尝试把无法解密的数据备份到独立键。
 *
 * 备份失败（例如配额不足）时仅记录日志，不阻断启动流程——
 * 因为备份的目的是"有总比没有好"，失败时用户至少还能
 * 通过开发者工具手动查看原键。
 *
 * @param {string} encryptedRaw
 * @returns {boolean} 备份是否成功
 */
function tryBackupUndecryptableData(encryptedRaw) {
    try {
        localStorage.setItem(
            STORAGE_KEY_ENCRYPTED_VAULT_BACKUP,
            encryptedRaw
        );
        return true;
    } catch (backupError) {
        console.error('[persist] 备份无法解密的数据失败:', backupError);
        return false;
    }
}

/**
 * 尝试提示用户"数据解密失败，已备份"。
 *
 * 使用 sessionStorage 标志确保每次会话只提示一次，
 * 避免用户每次打开应用都被弹窗打扰。
 *
 * @param {boolean} backupSucceeded
 */
function tryNotifyDecryptFailure(backupSucceeded) {
    // 检查本次会话是否已提示过
    let alreadyNotified = false;
    try {
        alreadyNotified = sessionStorage.getItem(SESSION_KEY_DECRYPT_FAILURE_NOTIFIED) === '1';
    } catch (storageReadError) {
        // sessionStorage 读取失败时，按"未提示过"处理（保守策略）
        alreadyNotified = false;
    }

    if (alreadyNotified) return;

    const message = backupSucceeded
        ? '⚠️ 检测到无法解密的历史数据，已备份至浏览器存储。'
          + '如需恢复，请打开开发者工具查找 ds_encrypted_vault_v4_backup。'
        : '⚠️ 检测到无法解密的历史数据，且备份失败（存储空间可能已满）。'
          + '请勿保存新数据，并尽快在开发者工具中导出 ds_encrypted_vault_v4。';

    safeToast(message, true);

    // 记录已提示
    try {
        sessionStorage.setItem(SESSION_KEY_DECRYPT_FAILURE_NOTIFIED, '1');
    } catch (storageWriteError) {
        // 写入失败时忽略，下次可能再次提示
        console.warn('[persist] 记录提示状态失败:', storageWriteError);
    }
}

/**
 * 从 localStorage 加载并归一化 Vault
 *
 * 优先级：v4 键 → v3 键 → 内置预设
 *
 * 若读取到数据但无法解密，会先把原数据备份到独立键，再返回预设。
 * 详见文件头【W3 修复】说明。
 *
 * @returns {Promise<Object>}
 */
export async function loadVaultFromStorage() {
    let encryptedRaw = null;
    let sourceStorageKey = null;

    try {
        encryptedRaw = localStorage.getItem(STORAGE_KEY_ENCRYPTED_VAULT);
        if (encryptedRaw) {
            sourceStorageKey = STORAGE_KEY_ENCRYPTED_VAULT;
        }
    } catch (readError) {
        console.warn('[persist] 读取主存储键失败:', readError);
    }

    if (!encryptedRaw) {
        try {
            encryptedRaw = localStorage.getItem(STORAGE_KEY_ENCRYPTED_VAULT_LEGACY_V3);
            if (encryptedRaw) {
                sourceStorageKey = STORAGE_KEY_ENCRYPTED_VAULT_LEGACY_V3;
            }
        } catch (readError) {
            console.warn('[persist] 读取旧存储键失败:', readError);
        }
    }

    if (encryptedRaw) {
        const decrypted = await decryptState(encryptedRaw);

        if (isVaultShape(decrypted)) {
            // ---------- 正常路径：解密成功且格式合法 ----------
            const normalized = ensureDefaultTagExists(normalizeVault(decrypted));
            const defaultList = normalized.statementsMap[normalized.tags[0].id] || [];
            if (defaultList.length === 0) {
                const presetVault = createVaultFromBuiltinPreset();
                const presetDefaultList = presetVault.statementsMap[presetVault.tags[0].id] || [];
                if (presetDefaultList.length > 0) {
                    normalized.statementsMap[normalized.tags[0].id] = presetDefaultList;
                }
            }
            return normalized;
        }

        // ---------- 异常路径：有数据但无法解密 / 格式非法 ----------
        // 关键防护：先备份原数据，避免后续 save 覆盖导致永久丢失。
        console.warn(
            '[persist] 检测到无法解密的数据（来源键：' + sourceStorageKey
            + '）。加密是否可用：' + isCryptoAvailable()
            + '。即将备份原数据并回退到内置预设。'
        );

        const backupSucceeded = tryBackupUndecryptableData(encryptedRaw);
        tryNotifyDecryptFailure(backupSucceeded);
    }

    return createVaultFromBuiltinPreset();
}

/**
 * 将 Vault 加密写入 localStorage
 * 使用队列 + 版本号避免竞态
 *
 * 注意：此处不再对 Vault 做深拷贝。原因：
 *   - 命令层是纯函数，每次 dispatch 都返回新的顶层引用
 *   - 传入的 vaultSnapshot 引用在整个写入过程中保持不变
 *   - encryptState 内部会执行 JSON.stringify 序列化
 * 因此直接传引用即可，可以显著降低大数据量下的开销
 *
 * @param {Object} vaultSnapshot
 * @returns {Promise<void>}
 */
export function saveVaultToStorage(vaultSnapshot) {
    const currentVersion = ++persistenceVersion;
    const snapshot = vaultSnapshot;

    return new Promise(function (resolve, reject) {
        persistenceQueue = persistenceQueue
            .then(async function () {
                // 若有更新版本已排入队列，本快照已过期，直接跳过
                if (currentVersion !== persistenceVersion) {
                    resolve();
                    return;
                }
                try {
                    const encrypted = await encryptState(snapshot);
                    if (currentVersion !== persistenceVersion) {
                        resolve();
                        return;
                    }
                    let estimatedSize = 0;
                    try {
                        estimatedSize = new Blob([encrypted]).size;
                    } catch (sizeError) {
                        estimatedSize = encrypted.length;
                    }
                    if (estimatedSize > MAX_LOCALSTORAGE_SIZE) {
                        safeToast("存储空间不足，请清理部分数据后重试", true);
                        reject(new Error("存储空间不足"));
                        return;
                    }
                    localStorage.setItem(STORAGE_KEY_ENCRYPTED_VAULT, encrypted);
                    resolve();
                } catch (writeError) {
                    console.error('[persist] 写入失败:', writeError);
                    // 无条件提示：写入失败与加密是否可用无关
                    safeToast(describeStorageError(writeError), true);
                    reject(writeError);
                }
            })
            .catch(function (queueError) {
                console.error('[persist] 队列异常:', queueError);
                reject(queueError);
                // 显式返回一个已完成的 Promise，避免错误继续沿链传播
                return undefined;
            });
    });
}

/**
 * 防抖持久化
 * 在 delayMs 内的多次调用只保留最后一次快照
 * 所有 Promise 在最终写入完成（或失败）时一起 resolve/reject
 * @param {Object} vaultSnapshot
 * @param {number} [delayMs=PERSIST_DEBOUNCE_MS]
 * @returns {Promise<void>}
 */
export function saveVaultToStorageDebounced(vaultSnapshot, delayMs) {
    const effectiveDelay = (typeof delayMs === 'number' && delayMs >= 0)
        ? delayMs
        : PERSIST_DEBOUNCE_MS;

    pendingDebounceSnapshot = vaultSnapshot;

    return new Promise(function (resolve, reject) {
        pendingDebounceResolvers.push(resolve);
        pendingDebounceRejecters.push(reject);

        if (debounceTimer) {
            clearTimeout(debounceTimer);
        }
        debounceTimer = setTimeout(function () {
            debounceTimer = null;
            const snapshotToSave = pendingDebounceSnapshot;
            pendingDebounceSnapshot = null;
            const resolversToCall = pendingDebounceResolvers.splice(0, pendingDebounceResolvers.length);
            const rejectersToCall = pendingDebounceRejecters.splice(0, pendingDebounceRejecters.length);

            if (!snapshotToSave) {
                resolversToCall.forEach(function (resolveCallback) {
                    resolveCallback();
                });
                return;
            }

            saveVaultToStorage(snapshotToSave)
                .then(function () {
                    resolversToCall.forEach(function (resolveCallback) {
                        resolveCallback();
                    });
                })
                .catch(function (persistError) {
                    rejectersToCall.forEach(function (rejectCallback) {
                        rejectCallback(persistError);
                    });
                });
        }, effectiveDelay);
    });
}

/**
 * 立即 flush 尚在防抖窗口中的快照
 * 用于 beforeunload 场景，尽量减少数据丢失概率
 */
export function flushDebouncedPersist() {
    if (!debounceTimer) return;
    clearTimeout(debounceTimer);
    debounceTimer = null;

    const snapshotToSave = pendingDebounceSnapshot;
    pendingDebounceSnapshot = null;
    const resolversToCall = pendingDebounceResolvers.splice(0, pendingDebounceResolvers.length);
    const rejectersToCall = pendingDebounceRejecters.splice(0, pendingDebounceRejecters.length);

    if (!snapshotToSave) {
        resolversToCall.forEach(function (resolveCallback) {
            resolveCallback();
        });
        return;
    }

    saveVaultToStorage(snapshotToSave)
        .then(function () {
            resolversToCall.forEach(function (resolveCallback) {
                resolveCallback();
            });
        })
        .catch(function (persistError) {
            rejectersToCall.forEach(function (rejectCallback) {
                rejectCallback(persistError);
            });
        });
}

/**
 * 强制清空存储（仅用于调试/重置）
 *
 * 注意：本函数只清空主键与旧版键，**不清空备份键**。
 * 备份键的数据是"无法解密的历史数据"，清空它反而造成数据丢失。
 * 如需彻底清空，调用方应显式处理备份键。
 */
export function clearStorage() {
    try {
        localStorage.removeItem(STORAGE_KEY_ENCRYPTED_VAULT);
        localStorage.removeItem(STORAGE_KEY_ENCRYPTED_VAULT_LEGACY_V3);
    } catch (clearError) {
        console.warn('[persist] 清空失败:', clearError);
    }
}