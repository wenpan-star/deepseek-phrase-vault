// filename: src/core/crypto.js
// ========================================================================
// DeepSeek 语句工坊 · 加密内核
// 使用 Web Crypto API：PBKDF2(SHA-256) 派生密钥 + AES-256-GCM 加密
// 本模块为纯函数，无副作用，不接触 DOM、存储
//
// 【性能优化】
//   派生出的 CryptoKey 被缓存于模块级变量，避免每次加/解密都执行
//   100,000 次 PBKDF2 迭代（约 50–300ms / 次）。
//   首次派生后，后续加解密均直接使用缓存密钥（<1ms）。
//   并发保护：多个调用同时请求密钥时只触发一次派生。
// ========================================================================

import {
    PBKDF2_ITERATIONS,
    ENCRYPTION_KEY_STRING,
    AES_GCM_IV_LENGTH,
    SALT
} from '../constants.js';

let cryptoIsAvailable = true;
try {
    if (!window.crypto || !window.crypto.subtle) {
        cryptoIsAvailable = false;
    }
} catch (availabilityCheckError) {
    cryptoIsAvailable = false;
}

// 缓存的派生密钥：首次派生后所有后续加/解密都复用
let cachedEncryptionKey = null;
// 并发保护：多处同时请求时只触发一次派生
let pendingKeyDerivationPromise = null;

/**
 * 检测当前环境是否支持 Web Crypto
 * @returns {boolean}
 */
export function isCryptoAvailable() {
    return cryptoIsAvailable;
}

/**
 * 通过 PBKDF2 派生 AES-256-GCM 密钥
 * 结果被缓存：首次调用约 50–300ms，后续调用 <1ms
 * @returns {Promise<CryptoKey>}
 */
async function deriveEncryptionKey() {
    if (!cryptoIsAvailable) {
        throw new Error('Web Crypto API 不可用');
    }
    if (cachedEncryptionKey) {
        return cachedEncryptionKey;
    }
    if (!pendingKeyDerivationPromise) {
        pendingKeyDerivationPromise = (async function () {
            try {
                const encoder = new TextEncoder();
                const keyMaterial = await window.crypto.subtle.importKey(
                    "raw",
                    encoder.encode(ENCRYPTION_KEY_STRING),
                    "PBKDF2",
                    false,
                    ["deriveKey"]
                );
                const derivedKey = await window.crypto.subtle.deriveKey(
                    {
                        name: "PBKDF2",
                        salt: SALT,
                        iterations: PBKDF2_ITERATIONS,
                        hash: "SHA-256"
                    },
                    keyMaterial,
                    { name: "AES-GCM", length: 256 },
                    true,
                    ["encrypt", "decrypt"]
                );
                cachedEncryptionKey = derivedKey;
                return derivedKey;
            } catch (keyDerivationError) {
                // 派生失败时清空 pending 状态，允许后续重试
                pendingKeyDerivationPromise = null;
                throw keyDerivationError;
            }
        })();
    }
    return pendingKeyDerivationPromise;
}

/**
 * 将 Uint8Array 转为 Base64 字符串
 * 使用分块方式避免 spread 超长栈溢出
 * @param {Uint8Array} bytes
 * @returns {string}
 */
function bytesToBase64(bytes) {
    const CHUNK_SIZE = 0x8000;
    let binaryString = '';
    for (let index = 0; index < bytes.length; index += CHUNK_SIZE) {
        const chunk = bytes.subarray(index, index + CHUNK_SIZE);
        binaryString += String.fromCharCode.apply(null, chunk);
    }
    return btoa(binaryString);
}

/**
 * 将 Base64 字符串还原为 Uint8Array
 * @param {string} base64String
 * @returns {Uint8Array}
 */
function base64ToBytes(base64String) {
    const binaryString = atob(base64String);
    const bytes = new Uint8Array(binaryString.length);
    for (let index = 0; index < binaryString.length; index++) {
        bytes[index] = binaryString.charCodeAt(index);
    }
    return bytes;
}

/**
 * 加密任意可 JSON 序列化的对象
 * 输出格式：[12 字节 IV][密文 + AuthTag] 的 Base64
 * @param {Object} dataObject
 * @returns {Promise<string>}
 */
export async function encryptState(dataObject) {
    if (!cryptoIsAvailable) {
        return JSON.stringify(dataObject);
    }
    const plaintext = JSON.stringify(dataObject);
    const dataBytes = new TextEncoder().encode(plaintext);
    const key = await deriveEncryptionKey();
    const initializationVector = window.crypto.getRandomValues(
        new Uint8Array(AES_GCM_IV_LENGTH)
    );
    const encryptedBuffer = await window.crypto.subtle.encrypt(
        { name: "AES-GCM", iv: initializationVector },
        key,
        dataBytes
    );
    const combinedArray = new Uint8Array(
        initializationVector.length + encryptedBuffer.byteLength
    );
    combinedArray.set(initializationVector, 0);
    combinedArray.set(new Uint8Array(encryptedBuffer), initializationVector.length);
    return bytesToBase64(combinedArray);
}

/**
 * 解密由 encryptState 生成的 Base64 字符串
 * @param {string} encryptedBase64
 * @returns {Promise<Object|null>} 解密失败时返回 null
 */
export async function decryptState(encryptedBase64) {
    if (!cryptoIsAvailable) {
        try {
            return JSON.parse(encryptedBase64);
        } catch (parseError) {
            return null;
        }
    }
    try {
        const combinedArray = base64ToBytes(encryptedBase64);
        const initializationVector = combinedArray.slice(0, AES_GCM_IV_LENGTH);
        const ciphertext = combinedArray.slice(AES_GCM_IV_LENGTH);
        const key = await deriveEncryptionKey();
        const decryptedBuffer = await window.crypto.subtle.decrypt(
            { name: "AES-GCM", iv: initializationVector },
            key,
            ciphertext
        );
        return JSON.parse(new TextDecoder().decode(decryptedBuffer));
    } catch (decryptError) {
        console.warn('[crypto] 解密失败:', decryptError && decryptError.message);
        return null;
    }
}