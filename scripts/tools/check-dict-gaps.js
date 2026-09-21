// filename: scripts/tools/check-dict-gaps.js

/**
 * check-dict-gaps.js — 校验 src/utils/pinyin-data.js
 *                       对《通用规范汉字表.xlsx》的覆盖率
 *
 * 【定位】
 *   辅助工具。与 generate-pinyin-data.js 同源（都读取 xlsx），
 *   用于确认生成的数据模块完整覆盖了 xlsx 中的全部汉字。
 *
 * 【依赖】
 *   xlsx 包。与 generate 共用：
 *     cd scripts/tools
 *     npm install --no-save xlsx
 *
 * 【用法】
 *   cd scripts/tools
 *   node check-dict-gaps.js
 *
 * 【输入】
 *   - 通用规范汉字表.xlsx（查找顺序同 generate-pinyin-data.js）
 *   - src/utils/pinyin-data.js（被校验对象）
 *
 * 【输出】
 *   - 控制台报告：覆盖率、缺失字符清单、多余字符清单
 *   - 退出码：0 = 校验通过；1 = 存在缺失或多余字符 / 输入文件缺失
 *
 * 【解析策略（重要）】
 *   本脚本不再使用"正则匹配单引号字符串行"的方式提取汉字——
 *   因为那种方式无法应对不同的引号风格（单引号 / 双引号），也无法
 *   正确处理字符串内的转义字符（\" \\ \n \t 等）。
 *
 *   现在改为：把 PINYIN_INITIAL_DATA 的数据块内容作为一个 JS 对象字面量
 *   表达式，交给 new Function 求值，直接得到解析后的对象。
 *   该策略天然兼容：
 *     - 单引号字符串：a: '阿啊哀'
 *     - 双引号字符串：a: "阿啊哀"
 *     - 任意转义序列：\" \' \\ \n \r \t \uXXXX
 *     - 未来可能的格式调整（只要仍是合法 JS 对象字面量）
 *
 * 【兼容性】
 *   Node 14.0.0+
 *
 * 【本脚本不含 shebang（#!）】
 *   因为 Windows 下用 node 显式调用，且项目约定首行为 // filename 标注。
 */

'use strict';

const fs = require('fs');
const path = require('path');

// ==================== 依赖检查 ====================

let XLSX;
try {
    XLSX = require('xlsx');
} catch (error) {
    console.error('');
    console.error('❌ 未找到 xlsx 依赖。请先安装：');
    console.error('     cd scripts/tools');
    console.error('     npm install --no-save xlsx');
    console.error('');
    process.exit(1);
}

// ==================== 路径 ====================

const SCRIPT_DIRECTORY = __dirname;
const PROJECT_ROOT = path.resolve(SCRIPT_DIRECTORY, '..', '..');

const PINYIN_DATA_FILE = path.join(
    PROJECT_ROOT,
    'src',
    'utils',
    'pinyin-data.js'
);

const WORKBOOK_CANDIDATE_PATHS = [
    path.join(PROJECT_ROOT, 'scripts', 'data', '通用规范汉字表.xlsx'),
    path.join(PROJECT_ROOT, '通用规范汉字表.xlsx'),
    path.join(SCRIPT_DIRECTORY, '通用规范汉字表.xlsx')
];

const SHEET_NAMES = ['Level_1', 'Level 2', 'Level_3'];

// ==================== 工具函数 ====================

/**
 * 判断一个值是否恰好是单个 CJK 汉字。
 *
 * @param {*} value
 * @returns {boolean}
 */
function isHanCharacter(value) {
    if (typeof value !== 'string') return false;

    const trimmedValue = value.trim();
    if (trimmedValue.length === 0) return false;

    let characterCount = 0;
    let singleCharacter = '';
    for (const character of trimmedValue) {
        characterCount++;
        singleCharacter = character;
        if (characterCount > 1) return false;
    }
    if (characterCount !== 1) return false;

    const codePoint = singleCharacter.codePointAt(0);
    return (
        (codePoint >= 0x3400 && codePoint <= 0x4DBF) ||
        (codePoint >= 0x4E00 && codePoint <= 0x9FFF) ||
        (codePoint >= 0xF900 && codePoint <= 0xFAFF) ||
        (codePoint >= 0x20000 && codePoint <= 0x2A6DF) ||
        (codePoint >= 0x2A700 && codePoint <= 0x2B73F) ||
        (codePoint >= 0x2B740 && codePoint <= 0x2B81F) ||
        (codePoint >= 0x2B820 && codePoint <= 0x2CEAF) ||
        (codePoint >= 0x2CEB0 && codePoint <= 0x2EBEF) ||
        (codePoint >= 0x30000 && codePoint <= 0x3134F) ||
        (codePoint >= 0x31350 && codePoint <= 0x323AF)
    );
}

/**
 * 定位 xlsx 文件。
 *
 * @returns {string|null}
 */
function locateWorkbookPath() {
    for (
        let pathIndex = 0;
        pathIndex < WORKBOOK_CANDIDATE_PATHS.length;
        pathIndex++
    ) {
        const candidatePath = WORKBOOK_CANDIDATE_PATHS[pathIndex];
        if (fs.existsSync(candidatePath)) {
            return candidatePath;
        }
    }
    return null;
}

/**
 * 从 xlsx 中提取全部汉字（按 sheet 逐行扫描 B 列）。
 *
 * @param {string} workbookPath
 * @returns {Set<string>}
 */
function extractCharactersFromWorkbook(workbookPath) {
    const workbook = XLSX.readFile(workbookPath);
    const extractedCharacters = new Set();

    for (
        let sheetIndex = 0;
        sheetIndex < SHEET_NAMES.length;
        sheetIndex++
    ) {
        const sheetName = SHEET_NAMES[sheetIndex];
        const worksheet = workbook.Sheets[sheetName];
        if (!worksheet) continue;

        const rows = XLSX.utils.sheet_to_json(worksheet, {
            header: 1,
            blankrows: false
        });

        for (let rowIndex = 1; rowIndex < rows.length; rowIndex++) {
            const row = rows[rowIndex];
            if (!Array.isArray(row)) continue;

            const characterCell = row[1];
            if (isHanCharacter(characterCell)) {
                extractedCharacters.add(String(characterCell).trim());
            }
        }
    }

    return extractedCharacters;
}

/**
 * 从 src/utils/pinyin-data.js 中提取全部汉字。
 *
 * 【解析策略】
 *   1. 用正则定位 `export const PINYIN_INITIAL_DATA = { ... };`
 *      中花括号之间的数据块内容。
 *   2. 把该数据块内容作为一个 JS 对象字面量交给 new Function 求值，
 *      直接得到解析后的对象。
 *
 *   这样做的好处：
 *     - 不依赖字符串的引号风格（单引号 / 双引号均可）
 *     - 自动处理转义序列（\" \\ \n \t \uXXXX 等）
 *     - 与 JavaScript 引擎使用完全相同的解析规则，
 *       不会因为手动正则的疏漏而漏掉或多算字符
 *
 * @param {string} filePath
 * @returns {Set<string>}
 */
function extractCharactersFromPinyinData(filePath) {
    const fileContent = fs.readFileSync(filePath, 'utf-8');

    // 匹配 export const PINYIN_INITIAL_DATA = { ... };
    // 说明：
    //   花括号之间的内容用 [\s\S]*? 非贪婪匹配，直到第一个 "};" 为止。
    //   由于生成脚本输出的每个值都是一个单行字符串，其中不会出现
    //   单独的 "};" 序列，因此非贪婪匹配在本项目中安全可靠。
    const dataBlockPattern =
        /export\s+const\s+PINYIN_INITIAL_DATA\s*=\s*\{([\s\S]*?)\};/;
    const dataBlockMatch = fileContent.match(dataBlockPattern);
    if (!dataBlockMatch) {
        throw new Error(
            '无法在 ' +
                filePath +
                ' 中解析 PINYIN_INITIAL_DATA —— ' +
                '文件格式可能已被破坏，请重新运行 generate-pinyin-data.js。'
        );
    }

    const dataBlockBody = dataBlockMatch[1];

    // 将数据块内容当作对象字面量求值。
    // new Function 的返回值是一个函数，调用它即得到对象。
    // 注意：这里包裹 `return { ... }`，等价于把数据块作为表达式求值。
    let parsedData;
    try {
        // eslint-disable-next-line no-new-func
        parsedData = new Function('return {' + dataBlockBody + '}')();
    } catch (parseError) {
        throw new Error(
            '解析 PINYIN_INITIAL_DATA 数据块失败：' +
                (parseError && parseError.message
                    ? parseError.message
                    : String(parseError))
        );
    }

    if (!parsedData || typeof parsedData !== 'object') {
        throw new Error(
            'PINYIN_INITIAL_DATA 解析结果不是对象 —— ' +
                '文件格式可能已被破坏，请重新运行 generate-pinyin-data.js。'
        );
    }

    const extractedCharacters = new Set();
    const initialLetters = Object.keys(parsedData);

    for (
        let letterIndex = 0;
        letterIndex < initialLetters.length;
        letterIndex++
    ) {
        const initialLetter = initialLetters[letterIndex];
        const characterString = parsedData[initialLetter];
        if (typeof characterString !== 'string') continue;

        // 用 for...of 遍历 codePoint，确保生僻字 / emoji 正确处理
        for (const character of characterString) {
            extractedCharacters.add(character);
        }
    }

    return extractedCharacters;
}

// ==================== 主流程 ====================

function main() {
    console.log('========================================');
    console.log('  拼音字典覆盖率校验');
    console.log('========================================');
    console.log('');

    // ---- 1. 定位 xlsx ----
    const workbookPath = locateWorkbookPath();
    if (!workbookPath) {
        console.error(
            '❌ 未找到《通用规范汉字表.xlsx》。请放到以下任一位置：'
        );
        WORKBOOK_CANDIDATE_PATHS.forEach(function (candidatePath) {
            console.error('   - ' + candidatePath);
        });
        process.exit(1);
    }
    console.log('基准数据源：' + workbookPath);

    // ---- 2. 检查被校验对象 ----
    if (!fs.existsSync(PINYIN_DATA_FILE)) {
        console.error('❌ 未找到被校验文件：' + PINYIN_DATA_FILE);
        console.error(
            '   请先运行 generate-pinyin-data.js 生成数据模块。'
        );
        process.exit(1);
    }
    console.log('被校验对象：' + PINYIN_DATA_FILE);
    console.log('');

    // ---- 3. 提取基准字符集 ----
    let expectedCharacters;
    try {
        expectedCharacters = extractCharactersFromWorkbook(workbookPath);
    } catch (error) {
        console.error('❌ 读取 xlsx 失败：' + error.message);
        process.exit(1);
    }

    // ---- 4. 提取实际字符集 ----
    let actualCharacters;
    try {
        actualCharacters =
            extractCharactersFromPinyinData(PINYIN_DATA_FILE);
    } catch (error) {
        console.error(
            '❌ 解析 pinyin-data.js 失败：' + error.message
        );
        process.exit(1);
    }

    // ---- 5. 对比 ----
    const missingCharacters = [];
    expectedCharacters.forEach(function (character) {
        if (!actualCharacters.has(character)) {
            missingCharacters.push(character);
        }
    });

    const extraCharacters = [];
    actualCharacters.forEach(function (character) {
        if (!expectedCharacters.has(character)) {
            extraCharacters.push(character);
        }
    });

    // ---- 6. 报告 ----
    const expectedCharacterCount = expectedCharacters.size;
    const actualCharacterCount = actualCharacters.size;
    const coveragePercent =
        expectedCharacterCount > 0
            ? ((actualCharacterCount / expectedCharacterCount) * 100).toFixed(
                  2
              )
            : '0.00';

    console.log('----------------------------------------');
    console.log('  xlsx 基准字符数：' + expectedCharacterCount + ' 字');
    console.log('  数据模块字符数：' + actualCharacterCount + ' 字');
    console.log('  覆盖率：' + coveragePercent + '%');
    console.log('----------------------------------------');
    console.log('');

    if (missingCharacters.length > 0) {
        console.log(
            '⚠️  缺失字符（' + missingCharacters.length + ' 个）：'
        );
        const missingPreview = missingCharacters.slice(0, 100).join(' ');
        console.log(
            '   ' +
                missingPreview +
                (missingCharacters.length > 100 ? ' ...' : '')
        );
        console.log('');
    }

    if (extraCharacters.length > 0) {
        console.log(
            '⚠️  多余字符（' + extraCharacters.length + ' 个）：'
        );
        const extraPreview = extraCharacters.slice(0, 100).join(' ');
        console.log(
            '   ' +
                extraPreview +
                (extraCharacters.length > 100 ? ' ...' : '')
        );
        console.log('');
    }

    if (
        missingCharacters.length === 0 &&
        extraCharacters.length === 0
    ) {
        console.log('✅ 校验通过：数据模块与 xlsx 完全一致');
        console.log('');
        process.exit(0);
    } else {
        console.log('❌ 校验未通过');
        console.log('');
        console.log('   可能原因：');
        console.log('   1. pinyin-data.js 被手工修改或损坏；');
        console.log('   2. xlsx 已更新但数据模块未重新生成；');
        console.log(
            '   3. 生成脚本存在逻辑缺陷（请检查 generate-pinyin-data.js）。'
        );
        console.log('');
        console.log(
            '   建议：重新运行 generate-pinyin-data.js 后再校验。'
        );
        process.exit(1);
    }
}

main();