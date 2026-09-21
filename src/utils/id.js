// filename: src/utils/id.js
// ========================================================================
// DeepSeek 语句工坊 · ID 生成器
// 使用时间戳 + 随机串，保证局部唯一且可读（前缀可辨识生成顺序）
// ========================================================================

/**
 * 生成唯一 ID
 * 格式：<毫秒时间戳>-<8位随机串>
 * @returns {string}
 */
export function generateUniqueId() {
    const timestampPart = Date.now().toString();
    const randomPart = Math.random().toString(36).substring(2, 10);
    return `${timestampPart}-${randomPart}`;
}