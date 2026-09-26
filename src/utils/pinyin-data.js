/**
 * pinyin-data.js — 汉字拼音首字母数据表（ES Module）
 *
 * ⚠️ 本文件为**占位版本**，必须在首次部署前通过运行以下脚本
 *    自动生成完整数据：
 *
 *      cd scripts/tools
 *      npm install --no-save xlsx
 *      node generate-pinyin-data.js
 *
 *    生成脚本会读取《通用规范汉字表.xlsx》（三张 sheet：Level_1 /
 *    Level 2 / Level_3），输出覆盖全部 8105 个汉字的完整数据。
 *
 * 【为什么需要这份占位文件】
 *   历史上，本文件曾被意外覆盖为 Node.js 脚本（含 require('fs')），
 *   导致浏览器加载时抛出 ReferenceError: require is not defined，
 *   整个应用白屏。
 *
 *   提供一份**结构正确、格式合法**的 ES Module 占位文件，
 *   可以让应用在任何情况下都能启动（首字母搜索暂时禁用），
 *   而不会因为数据文件问题导致整个应用崩溃。
 *
 *   src/utils/pinyin.js 中的 buildCharacterToInitialMap 已加入守卫：
 *   当 PINYIN_INITIAL_DATA 为空对象或非对象时，仅禁用首字母搜索，
 *   不影响字面搜索、批量、导入导出等其他任何功能。
 *
 * 【格式说明】
 *   每个键为汉语拼音首字母（a-z，不含 i/u/v），
 *   值为该首字母下所有汉字的连续字符串。
 *   例：{ a: "阿啊哀", b: "八巴扒" }
 *
 * 【完整版本示例】
 *   运行生成脚本后，本文件的首行会是：
 *     export const PINYIN_INITIAL_DATA = {
 *         a: "艾凹安阿哎挨...",
 *         b: "卜八匕不巴...",
 *         ...
 *     };
 *
 * 【生成脚本的字符串安全性】
 *   generate-pinyin-data.js 使用 JSON.stringify 序列化每个分组，
 *   自动转义引号、反斜杠、控制字符，无论 xlsx 中出现什么意外字符，
 *   输出的字符串字面量永远是合法的 JS 代码。
 */

export const PINYIN_INITIAL_DATA = {};