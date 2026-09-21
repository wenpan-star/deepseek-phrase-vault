// filename: scripts/tools/generate-pinyin-data.js

/**
 * generate-pinyin-data.js — 从《通用规范汉字表》xlsx 生成
 *                            src/utils/pinyin-data.js（ES Module）
 *
 * 【定位】
 *   辅助工具。将 xlsx 中的 (汉字, 拼音首字母) 数据导出为 ES Module，
 *   供 src/utils/pinyin.js 运行时查询。项目源码中不硬编码任何拼音数据。
 *
 * 【依赖】
 *   xlsx 包。需手动安装（不污染项目根 package.json）：
 *     cd scripts/tools
 *     npm install --no-save xlsx
 *
 * 【用法】
 *   cd scripts/tools
 *   node generate-pinyin-data.js
 *
 * 【输入】
 *   通用规范汉字表.xlsx（放在以下任一位置均可）：
 *     - scripts/data/通用规范汉字表.xlsx
 *     - 项目根/通用规范汉字表.xlsx
 *     - scripts/tools/通用规范汉字表.xlsx
 *   预期三张 sheet：Level_1 / Level 2 / Level_3
 *   每张 sheet 从第 2 行起：
 *     - 第 B 列（index 1）：汉字
 *     - 第 C 列（index 2）：带声调拼音（如 shí），作为 I 列为空时的回退
 *     - 第 I 列（index 8）：拼音首字母（如 sh），优先使用
 *
 * 【输出】
 *   src/utils/pinyin-data.js
 *   内容格式（ES Module）：
 *     // 本文件由 scripts/tools/generate-pinyin-data.js 自动生成
 *     export const PINYIN_INITIAL_DATA = {
 *         a: "阿啊哀挨...",
 *         b: "八巴扒吧...",
 *         ...
 *     };
 *
 * 【字符串输出的安全性】
 *   每个首字母分组的汉字串使用 JSON.stringify 序列化后写入，
 *   而非手工拼接单引号。JSON.stringify 会自动转义：
 *     - 单引号 / 双引号 / 反斜杠
 *     - 换行 / 回车 / 制表符 / 其他控制字符
 *     - 不成对的 surrogate code unit（转为 \uXXXX）
 *   从而杜绝"字符串提前闭合 → 语法错误"这一类运行时故障。
 *
 * 【重要说明】
 *   - 输出文件会被覆盖。若曾手工编辑，请先自行备份。
 *   - 首次运行会在 src/utils/ 下创建 pinyin-data.js.bak 备份（若已存在）。
 *
 * 【兼容性】
 *   Node 14.0.0+（无 node: 前缀，无 ES2020+ 语法）。
 *   本脚本不含 shebang（#!），因为 Windows 下用 node 显式调用，
 *   且项目约定首行为 // filename 标注。
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

const OUTPUT_FILE = path.join(
    PROJECT_ROOT,
    'src',
    'utils',
    'pinyin-data.js'
);
const OUTPUT_BACKUP_FILE = OUTPUT_FILE + '.bak';

const WORKBOOK_CANDIDATE_PATHS = [
    path.join(PROJECT_ROOT, 'scripts', 'data', '通用规范汉字表.xlsx'),
    path.join(PROJECT_ROOT, '通用规范汉字表.xlsx'),
    path.join(SCRIPT_DIRECTORY, '通用规范汉字表.xlsx')
];

const SHEET_NAMES = ['Level_1', 'Level 2', 'Level_3'];

// 汉语拼音中可作为首字母的字母（无 i、u、v）
const VALID_INITIAL_LETTERS = 'abcdefghjklmnopqrstwxyz'.split('');

// ==================== 工具函数 ====================

/**
 * 去掉拼音中的声调符号（用于从 pinyin 列推导首字母）。
 *
 * @param {string} pinyin
 * @returns {string}
 */
function stripTone(pinyin) {
    const toneCharacterMap = {
        'ā': 'a', 'á': 'a', 'ǎ': 'a', 'à': 'a',
        'ē': 'e', 'é': 'e', 'ě': 'e', 'è': 'e',
        'ī': 'i', 'í': 'i', 'ǐ': 'i', 'ì': 'i',
        'ō': 'o', 'ó': 'o', 'ǒ': 'o', 'ò': 'o',
        'ū': 'u', 'ú': 'u', 'ǔ': 'u', 'ù': 'u',
        'ǖ': 'v', 'ǘ': 'v', 'ǚ': 'v', 'ǜ': 'v', 'ü': 'v',
        'ń': 'n', 'ň': 'n', 'ǹ': 'n',
        'ḿ': 'm'
    };

    let strippedResult = '';
    for (let index = 0; index < pinyin.length; index++) {
        const character = pinyin[index];
        strippedResult += toneCharacterMap[character] || character;
    }
    return strippedResult;
}

/**
 * 判断字符串是否恰好是一个 CJK 汉字。
 * 覆盖扩展 A-H 与兼容表意文字。
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
 * 从 xlsx 行数据中提取 (汉字, 首字母)。
 * 优先使用 pinyin_initial 列（index 8）；若为空，退而从 pinyin 列（index 2）提取。
 *
 * @param {Array} row
 * @returns {{character: string, initial: string}|null}
 */
function extractCharacterAndInitial(row) {
    if (!Array.isArray(row)) return null;

    const wordCell = row[1];
    if (!isHanCharacter(wordCell)) return null;
    const character = String(wordCell).trim();

    let initial = '';

    // 策略 1：pinyin_initial 列
    const pinyinInitialCell = row[8];
    if (typeof pinyinInitialCell === 'string') {
        const trimmedInitialCell = pinyinInitialCell.trim().toLowerCase();
        if (
            trimmedInitialCell.length > 0 &&
            /^[a-z]/.test(trimmedInitialCell)
        ) {
            const firstCharacter = trimmedInitialCell.charAt(0);
            if (VALID_INITIAL_LETTERS.indexOf(firstCharacter) !== -1) {
                initial = firstCharacter;
            }
        }
    }

    // 策略 2：从 pinyin 列推导
    if (!initial) {
        const pinyinCell = row[2];
        if (typeof pinyinCell === 'string') {
            const firstPinyin = pinyinCell.split(',')[0].trim();
            if (firstPinyin) {
                const strippedPinyin = stripTone(firstPinyin);
                const firstCharacter = strippedPinyin
                    .charAt(0)
                    .toLowerCase();
                if (VALID_INITIAL_LETTERS.indexOf(firstCharacter) !== -1) {
                    initial = firstCharacter;
                }
            }
        }
    }

    if (!initial) return null;
    return { character: character, initial: initial };
}

/**
 * 将 (汉字 → 首字母) 反查表按首字母分组为字符串。
 *
 * @param {Map<string, string>} characterToInitial
 * @returns {Map<string, string>}
 */
function groupByInitial(characterToInitial) {
    const groupedCharacters = new Map();
    for (
        let letterIndex = 0;
        letterIndex < VALID_INITIAL_LETTERS.length;
        letterIndex++
    ) {
        groupedCharacters.set(VALID_INITIAL_LETTERS[letterIndex], []);
    }

    characterToInitial.forEach(function (initial, character) {
        if (groupedCharacters.has(initial)) {
            groupedCharacters.get(initial).push(character);
        }
    });

    const groupedStrings = new Map();
    groupedCharacters.forEach(function (characterList, initial) {
        groupedStrings.set(initial, characterList.join(''));
    });
    return groupedStrings;
}

/**
 * 生成 ES Module 文件内容。
 *
 * 【字符串输出方式】
 *   每个首字母分组的汉字串使用 JSON.stringify 序列化后写入。
 *   JSON.stringify 会：
 *     - 用双引号包裹
 *     - 转义内部的双引号、反斜杠
 *     - 转义控制字符（\n、\r、\t、\u0000 等）
 *     - 保留合法的 surrogate pair
 *     - 将孤立的 surrogate code unit 转义为 \uXXXX
 *   从而保证输出的字符串字面量永远是合法的 JS 代码，
 *   不会因为 xlsx 单元格内的意外字符而破坏语法。
 *
 * @param {Map<string, string>} groupedByInitial
 * @param {number} totalCharacters
 * @param {number} duplicatesSkipped
 * @returns {string}
 */
function buildFileContent(
    groupedByInitial,
    totalCharacters,
    duplicatesSkipped
) {
    const fileHeaderLines = [
        '/**',
        ' * pinyin-data.js — 汉字拼音首字母数据表（ES Module）',
        ' *',
        ' * 本文件由 scripts/tools/generate-pinyin-data.js 自动生成。',
        ' * 请勿手动编辑 —— 重新运行生成脚本会覆盖本文件。',
        ' *',
        ' * 数据来源：通用规范汉字表.xlsx（Level_1 / Level 2 / Level_3 三张 sheet）',
        ' *',
        ' * 生成统计：',
        ' *   - 收录汉字总数：' + totalCharacters + ' 字',
        ' *   - 因多音字被跳过的重复项：' + duplicatesSkipped + ' 项',
        ' *',
        ' * 字符串安全说明：',
        ' *   本文件中每个首字母分组的汉字串均由 JSON.stringify 生成，',
        ' *   自动转义引号、反斜杠、控制字符；若 xlsx 单元格意外包含',
        ' *   特殊字符，也不会破坏本文件的语法。',
        ' *',
        ' * 格式说明：',
        ' *   每个键为汉语拼音首字母（a-z，不含 i/u/v），',
        ' *   值为该首字母下所有汉字的连续字符串。',
        ' *   多音字取首次出现的读音（xlsx 中的主读音）。',
        ' */',
        '',
        'export const PINYIN_INITIAL_DATA = {'
    ];

    const dataLines = [];
    for (
        let letterIndex = 0;
        letterIndex < VALID_INITIAL_LETTERS.length;
        letterIndex++
    ) {
        const initialLetter = VALID_INITIAL_LETTERS[letterIndex];
        const characterString =
            groupedByInitial.get(initialLetter) || '';
        const isLastLetter =
            letterIndex === VALID_INITIAL_LETTERS.length - 1;

        // 使用 JSON.stringify 序列化字符串，自动处理所有特殊字符
        dataLines.push(
            "    " +
                initialLetter +
                ": " +
                JSON.stringify(characterString) +
                (isLastLetter ? '' : ',')
        );
    }

    return (
        fileHeaderLines.join('\n') +
        '\n' +
        dataLines.join('\n') +
        '\n};\n'
    );
}

// ==================== 主流程 ====================

function main() {
    console.log('========================================');
    console.log('  拼音数据表生成工具（xlsx → ES Module）');
    console.log('========================================');
    console.log('');

    // ---- 1. 定位 xlsx ----
    let workbookPath = null;
    for (
        let pathIndex = 0;
        pathIndex < WORKBOOK_CANDIDATE_PATHS.length;
        pathIndex++
    ) {
        if (fs.existsSync(WORKBOOK_CANDIDATE_PATHS[pathIndex])) {
            workbookPath = WORKBOOK_CANDIDATE_PATHS[pathIndex];
            break;
        }
    }
    if (!workbookPath) {
        console.error(
            '❌ 未找到《通用规范汉字表.xlsx》。请放到以下任一位置：'
        );
        WORKBOOK_CANDIDATE_PATHS.forEach(function (candidatePath) {
            console.error('   - ' + candidatePath);
        });
        process.exit(1);
    }
    console.log('源文件：' + workbookPath);
    console.log('');

    // ---- 2. 读取工作簿 ----
    let workbook;
    try {
        workbook = XLSX.readFile(workbookPath);
    } catch (error) {
        console.error('❌ 读取 xlsx 失败：' + error.message);
        process.exit(1);
    }

    // ---- 3. 合并三张 sheet ----
    const characterToInitial = new Map();
    let totalScannedRowCount = 0;
    let duplicatesSkippedCount = 0;

    for (
        let sheetIndex = 0;
        sheetIndex < SHEET_NAMES.length;
        sheetIndex++
    ) {
        const sheetName = SHEET_NAMES[sheetIndex];
        if (!workbook.Sheets[sheetName]) {
            console.log(
                '⚠️  跳过 sheet「' + sheetName + '」（不存在）'
            );
            continue;
        }

        const rows = XLSX.utils.sheet_to_json(
            workbook.Sheets[sheetName],
            {
                header: 1,
                blankrows: false
            }
        );

        let sheetAddedCount = 0;
        let sheetDuplicateCount = 0;

        for (let rowIndex = 1; rowIndex < rows.length; rowIndex++) {
            const extracted = extractCharacterAndInitial(rows[rowIndex]);
            if (!extracted) continue;
            totalScannedRowCount++;

            if (characterToInitial.has(extracted.character)) {
                duplicatesSkippedCount++;
                sheetDuplicateCount++;
                continue;
            }

            characterToInitial.set(
                extracted.character,
                extracted.initial
            );
            sheetAddedCount++;
        }

        console.log(
            '✅ ' +
                sheetName +
                '：新增 ' +
                sheetAddedCount +
                ' 字，跳过重复 ' +
                sheetDuplicateCount +
                ' 字'
        );
    }

    console.log('');
    console.log('共扫描：' + totalScannedRowCount + ' 行');
    console.log('去重后收录：' + characterToInitial.size + ' 字');
    console.log(
        '跳过重复：' +
            duplicatesSkippedCount +
            ' 字（多音字取首次出现）'
    );
    console.log('');

    if (characterToInitial.size === 0) {
        console.error(
            '❌ 未提取到任何汉字。请检查 xlsx 的 B 列与 I 列，' +
                '并确认 sheet 名是否为：' + SHEET_NAMES.join(' / ')
        );
        process.exit(1);
    }

    // ---- 4. 分组 ----
    const groupedByInitial = groupByInitial(characterToInitial);

    // ---- 5. 生成内容 ----
    const fileContent = buildFileContent(
        groupedByInitial,
        characterToInitial.size,
        duplicatesSkippedCount
    );

    // ---- 5.1 语法自检（防御性检查）----
    // 用 new Function 尝试解析生成的内容，捕获任何非预期的语法错误。
    // 由于内容会以 CommonJS 的 'use strict' 模式注入模块函数，
    // 这里包一层把 export 语法替换掉，模拟浏览器 ESM 解析行为。
    try {
        const checkCode = fileContent.replace(
            /^export\s+const\s+/m,
            'const '
        );
        // eslint-disable-next-line no-new-func
        new Function(checkCode);
    } catch (syntaxCheckError) {
        console.error('');
        console.error('❌ 生成的代码存在语法错误：');
        console.error('   ' + syntaxCheckError.message);
        console.error('');
        console.error('   这通常意味着 xlsx 中存在异常字符。');
        console.error('   请联系维护者并附上 xlsx 数据。');
        process.exit(1);
    }

    // ---- 6. 确保输出目录存在 ----
    const outputDirectory = path.dirname(OUTPUT_FILE);
    if (!fs.existsSync(outputDirectory)) {
        fs.mkdirSync(outputDirectory, { recursive: true });
    }

    // ---- 7. 备份原文件（若已存在且备份不存在）----
    if (
        fs.existsSync(OUTPUT_FILE) &&
        !fs.existsSync(OUTPUT_BACKUP_FILE)
    ) {
        fs.copyFileSync(OUTPUT_FILE, OUTPUT_BACKUP_FILE);
        console.log('已备份原文件到：' + OUTPUT_BACKUP_FILE);
    }

    // ---- 8. 写入 ----
    fs.writeFileSync(OUTPUT_FILE, fileContent, 'utf-8');
    console.log('✅ 已写入：' + OUTPUT_FILE);
    console.log('');

    // ---- 9. 展示各首字母组统计 ----
    console.log('首字母分组统计：');
    for (
        let letterIndex = 0;
        letterIndex < VALID_INITIAL_LETTERS.length;
        letterIndex++
    ) {
        const initialLetter = VALID_INITIAL_LETTERS[letterIndex];
        const characterString =
            groupedByInitial.get(initialLetter) || '';
        const previewString =
            characterString.length > 30
                ? characterString.substring(0, 30) + '...'
                : characterString;

        console.log(
            '  ' +
                initialLetter +
                ' (' +
                characterString.length +
                ' 字)：' +
                previewString
        );
    }
    console.log('');
    console.log('下一步：');
    console.log('  1. 在浏览器中刷新应用');
    console.log('  2. 搜索框中输入 "zfb"，应能命中"支付宝"');
}

main();