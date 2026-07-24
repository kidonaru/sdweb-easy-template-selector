// プロンプト内のセクション（カテゴリ単位のブロック）の表現・判定・文字列化
class ETSSection {
  constructor(comment, tag, category) {
    this.comment = comment
    this.tag = tag
    this.category = category
  }

  // セクションの完全な文字列表現を生成
  toString() {
    if (!this.isValid()) {
      return ''
    }

    const isForceAddCategory = this.isForceAddCategory()
    const formattedTag = this.getFormattedTag()

    // 強制追加カテゴリの場合はタグのみを返す
    if (isForceAddCategory) {
      return formattedTag || ''
    }

    // ヘッダー部分の生成
    let header = `# ${this.category}`
    if (this.tag?.startsWith('@')) {
      header += ' (ランダム)'
    } else if (this.comment) {
      header += ` (${this.comment})`
    }
    header += ','

    // タグがない場合はヘッダーのみを返す
    if (formattedTag === null) {
      return header
    }

    // タグがある場合はヘッダーとタグを改行で結合
    return `${header}\n${formattedTag}`
  }

  // セクションのヘッダー行のみを取得
  getHeader() {
    return this.toString().split('\n')[0]
  }

  // カテゴリIDを取得
  getCategoryId() {
    if (!this.category) return null
    return this.category.split('_')[0]
  }

  getFormattedTag() {
    if (this.tag === null) {
      return null
    }

    let formattedTag = this.tag.trim()
    if (!formattedTag) {
      return ''
    }

    if (!this.tag.endsWith(',')) {
      formattedTag += ','
    }
    return formattedTag
  }

  // セクションが有効か
  isValid() {
    return this.category
  }

  // セクションがネガティブプロンプトかどうかを判定
  isNegativeCategory() {
    if (!this.category) return false
    return this.category.startsWith('99_ネガティブ')
  }

  // セクションがテンプレートかどうかを判定
  isTemplate() {
    if (!this.category) return false
    return this.category.startsWith('00_テンプレート')
  }

  // セクションが強制追加カテゴリかどうかを判定
  isForceAddCategory() {
    if (!this.category) return false
    return this.category.startsWith('97_Color') || this.category.startsWith('98_特殊')
  }

  // セクションがサブカテゴリマッチかどうかを判定
  isSubCategoryMatch() {
    if (!this.category) return false
    return this.category.startsWith('01_クオリティ') || this.category.startsWith('99_ネガティブ')
  }

  // 解像度カテゴリかどうかを判定
  isResolutionCategory() {
    if (!this.category) return false
    return this.category.startsWith('96_解像度')
  }

  // モデルカテゴリかどうかを判定
  isModelCategory() {
    if (!this.category) return false
    return this.category.startsWith('90_モデル')
  }
}
