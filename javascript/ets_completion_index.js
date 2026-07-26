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
    // 検索用の正規化はキー入力ごとに全件走るため、エントリ側は構築時に前計算する
    this.entries = ETSCompletionIndex.flatten(tags).map((entry) => ({
      ...entry,
      normalized: {
        comment: ETSCompletionIndex.normalize(entry.comment),
        tag: ETSCompletionIndex.normalize(entry.tag),
        category: ETSCompletionIndex.normalize(entry.category),
        header: ETSCompletionIndex.compact(ETSCompletionIndex.headerOf(entry)),
      },
    }))
  }

  // 検索用の正規化。IME 日本語入力では `(` が全角 `（` になるが、
  // ラベル側は半角で書かれているため NFKC で寄せてから比較する
  static normalize(text) {
    return (text ?? '').normalize('NFKC').toLowerCase()
  }

  // ヘッダー比較用の正規化。空白を落として `カテゴリ(ラベル` のように
  // 空白を省いて打たれた場合も拾えるようにする
  static compact(text) {
    return ETSCompletionIndex.normalize(text).replace(/\s+/g, '')
  }

  // 確定後のコメント行と同じ `カテゴリ (ラベル)` 形式。
  // 入力済みの行を打ち直すときはこの形のまま打つため、これも検索対象にする。
  // ランダムエントリのラベルは ETSSection.toString() に合わせて「ランダム」
  static headerOf(entry) {
    const label = entry.tag?.startsWith('@') ? 'ランダム' : entry.comment
    return `${entry.category} (${label})`
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
    const normalized = ETSCompletionIndex.normalize(query.trim())
    if (!normalized) {
      return []
    }
    const compacted = ETSCompletionIndex.compact(query)

    const wantNegative = target === 'negative'
    const ranked = []

    for (const entry of this.entries) {
      const isNegative = entry.category.startsWith(ETSCompletionIndex.NEGATIVE_CATEGORY)
      if (isNegative !== wantNegative) {
        continue
      }

      const rank = ETSCompletionIndex.rankOf(entry, normalized, compacted)
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
  // entry.normalized は constructor が前計算した検索用の値。
  // query はそのままのクエリ、compactedQuery は空白を落としたクエリ（ヘッダー比較用）
  static rankOf(entry, query, compactedQuery) {
    const { comment, tag, category, header } = entry.normalized
    if (comment.startsWith(query)) return 0
    if (header.startsWith(compactedQuery)) return 1
    if (comment.includes(query)) return 2
    if (header.includes(compactedQuery)) return 3
    if (tag.includes(query)) return 4
    if (category.includes(query)) return 5
    return null
  }
}
