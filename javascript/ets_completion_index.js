// タグツリーを平坦化し、プロンプト補完用の候補検索を提供する（DOM 非依存）
class ETSCompletionIndex {
  // テキスト挿入以外の副作用を持つため補完の対象外にするカテゴリ
  static EXCLUDED_CATEGORIES = ['00_テンプレート', '90_モデル', '96_解像度']

  // ETSPromptEditor.applyModelTag() が先頭 1 件だけを差し替える前提で扱うグループ。
  // 補完でセクションが重複するとモデル切替が壊れるため対象外にする
  static EXCLUDED_GROUPS = ['01_クオリティ:Model', '99_ネガティブ:Model']

  // ネガティブプロンプト側のカテゴリ
  static NEGATIVE_CATEGORY = '99_ネガティブ'

  // 候補の表示件数上限
  static MAX_RESULTS = 20

  constructor(tags) {
    this.entries = ETSCompletionIndex.flatten(tags)
  }

  // タグツリーを { comment, tag, category } の配列へ平坦化する
  // 走査の仕方は easy_template_selector.js の renderContent() / renderTagButtons() と同じ
  static flatten(tags) {
    const entries = []

    for (const [filename, values] of Object.entries(tags ?? {})) {
      if (ETSCompletionIndex.EXCLUDED_CATEGORIES.some((prefix) => filename.startsWith(prefix))) {
        continue
      }

      // カテゴリ直下のランダムエントリ
      entries.push({ comment: filename, tag: `@${filename}@`, category: filename })
      ETSCompletionIndex.walk(values, filename, entries)
    }

    return entries
  }

  static walk(node, category, entries) {
    if (Array.isArray(node)) {
      for (const tag of node) {
        entries.push({ comment: tag, tag, category })
      }
      return
    }

    if (typeof node !== 'object' || node === null) {
      return
    }

    for (const [key, values] of Object.entries(node)) {
      if (typeof values === 'string') {
        entries.push({ comment: key, tag: values, category })
        continue
      }

      const groupCategory = `${category}:${key}`
      if (ETSCompletionIndex.EXCLUDED_GROUPS.includes(groupCategory)) {
        continue
      }

      // グループ直下のランダムエントリを作ってから中身を辿る
      entries.push({ comment: key, tag: `@${groupCategory}@`, category: groupCategory })
      ETSCompletionIndex.walk(values, groupCategory, entries)
    }
  }

  // query に一致する候補を優先順に返す
  // target は 'positive' / 'negative' のいずれか
  search(query, target) {
    const normalized = query.trim().toLowerCase()
    if (!normalized) {
      return []
    }

    const wantNegative = target === 'negative'
    const ranked = []

    for (const entry of this.entries) {
      const isNegative = entry.category.startsWith(ETSCompletionIndex.NEGATIVE_CATEGORY)
      if (isNegative !== wantNegative) {
        continue
      }

      const rank = ETSCompletionIndex.rankOf(entry, normalized)
      if (rank === null) {
        continue
      }

      ranked.push({ entry, rank })
    }

    // Array.prototype.sort は安定なので、同順位は this.entries の順（カテゴリ番号順）が保たれる
    ranked.sort((a, b) => a.rank - b.rank)

    return ranked.slice(0, ETSCompletionIndex.MAX_RESULTS).map((item) => item.entry)
  }

  // 一致の強さ。小さいほど上位。一致しない場合は null
  static rankOf(entry, normalized) {
    const comment = entry.comment.toLowerCase()
    if (comment.startsWith(normalized)) return 0
    if (comment.includes(normalized)) return 1
    if (entry.tag.toLowerCase().includes(normalized)) return 2
    if (entry.category.toLowerCase().includes(normalized)) return 3
    return null
  }
}
