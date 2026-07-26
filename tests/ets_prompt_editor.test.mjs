// ETSPromptEditor の DOM 非依存部分（キャレット位置 → セクション対応付け）の単体テスト
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

// ets_prompt_editor.js は実行時に ETSSection を参照するので、先に評価しておく
const sectionSrc = readFileSync(new URL('../javascript/ets_section.js', import.meta.url), 'utf8')
const editorSrc = readFileSync(new URL('../javascript/ets_prompt_editor.js', import.meta.url), 'utf8')
const ETSPromptEditor = new Function(
  `${sectionSrc}\n${editorSrc}\nreturn ETSPromptEditor`
)()

// DOM を触らないメソッドだけを使うので、依存はダミーで良い
const newEditor = () => new ETSPromptEditor({ ids: {}, history: null, templateManager: null })

// カーソル位置を | で表した文字列から、セクション配列とキャレット位置を作る
const indexAt = (text) => {
  const value = text.replace('|', '')
  return ETSPromptEditor.indexOfSectionAtCaret(newEditor().splitSections(value), text.indexOf('|'))
}

const PROMPT = [
  '# 01_クオリティ (標準),',
  'masterpiece,',
  '# 20_目の状態 (細めた目),',
  'narrowed eyes,',
].join('\n')

test('splitSections の結果は join で原文に戻る（オフセット計算の前提）', () => {
  const sections = newEditor().splitSections(PROMPT)
  assert.equal(sections.join('\n'), PROMPT)
})

test('コメント行のキャレットはそのセクションを指す', () => {
  assert.equal(indexAt(PROMPT.replace('# 20_目の状態', '# 20_目|の状態')), 1)
})

test('タグ行のキャレットは同じセクションを指す', () => {
  assert.equal(indexAt(PROMPT.replace('narrowed eyes,', 'narrowed |eyes,')), 1)
})

test('先頭のキャレットは最初のセクションを指す', () => {
  assert.equal(indexAt(`|${PROMPT}`), 0)
})

test('セクション末尾のキャレットはそのセクションを指す', () => {
  assert.equal(indexAt(PROMPT.replace('masterpiece,', 'masterpiece,|')), 0)
})

test('次セクションの行頭のキャレットは次のセクションを指す', () => {
  assert.equal(indexAt(PROMPT.replace('# 20_目の状態', '|# 20_目の状態')), 1)
})

test('プロンプト末尾のキャレットは最後のセクションを指す', () => {
  assert.equal(indexAt(`${PROMPT}|`), 1)
})

// splitSections() は `#` 以外の行が来るたびに区切るので、コメント行を持たない
// タグ行はそれ自体が 1 セクションになる（＝同期対象外になる）
test('コメント行に属さないタグ行は独立したセクションになる', () => {
  assert.equal(indexAt('# 01_クオリティ (標準),\nmasterpiece,\nbest quality|,'), 1)
})

test('空行はそれ自体が 1 セクションになる', () => {
  const text = '# 01_クオリティ (標準),\nmasterpiece,\n|\nblush,'
  assert.equal(indexAt(text), 1)
  assert.equal(newEditor().splitSections(text.replace('|', ''))[1], '')
})

test('範囲外のキャレットは -1', () => {
  const sections = newEditor().splitSections(PROMPT)
  assert.equal(ETSPromptEditor.indexOfSectionAtCaret(sections, PROMPT.length + 1), -1)
})

test('確定済みのコメント行を持つセクションだけ同期対象', () => {
  assert.equal(ETSPromptEditor.isSyncableSection('# 20_目の状態 (細めた目),\nnarrowed eyes,'), true)
  assert.equal(ETSPromptEditor.isSyncableSection('# 20_目の状態 (細めた目),'), true)
})

test('入力途中のコメント行・コメントを持たない行は同期対象外', () => {
  assert.equal(ETSPromptEditor.isSyncableSection('#細めた'), false)
  assert.equal(ETSPromptEditor.isSyncableSection('masterpiece,'), false)
  assert.equal(ETSPromptEditor.isSyncableSection('BREAK'), false)
  assert.equal(ETSPromptEditor.isSyncableSection(''), false)
})
