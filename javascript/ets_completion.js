// プロンプト欄でのタグ補完（トリガ判定・ポップアップ制御・確定処理）
class ETSCompletion {
  // 補完を配線する textarea と、そこで出す候補の種別
  static TARGETS = [
    { id: 'txt2img_prompt', target: 'positive' },
    { id: 'txt2img_neg_prompt', target: 'negative' },
  ]

  // 行に含まれていたら補完を出さない文字（既存のコメント行と区別するため）
  static STOP_CHARS = /[,()]/

  // カーソル行から補完クエリを取り出す。補完を出さない状況では null を返す
  static extractQuery(value, caret) {
    const lineStart = value.lastIndexOf('\n', caret - 1) + 1
    let lineEnd = value.indexOf('\n', caret)
    if (lineEnd === -1) {
      lineEnd = value.length
    }

    const line = value.slice(lineStart, lineEnd)
    if (!line.startsWith('#')) {
      return null
    }
    if (ETSCompletion.STOP_CHARS.test(line)) {
      return null
    }

    const query = value.slice(lineStart + 1, caret)
    if (query.length < 1) {
      return null
    }

    return { lineStart, lineEnd, query }
  }

  // カーソル行を sectionText で置き換えた結果と、置換後のキャレット位置を返す
  static buildReplacement(value, range, sectionText) {
    const before = value.slice(0, range.lineStart)
    const after = value.slice(range.lineEnd)

    return {
      value: `${before}${sectionText}${after}`,
      caret: range.lineStart + sectionText.length,
    }
  }
}
