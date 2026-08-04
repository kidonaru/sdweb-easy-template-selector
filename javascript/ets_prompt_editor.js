// プロンプトテキストのセクション分解とタグの追加・削除・移動・選択状態管理
class ETSPromptEditor {
  // キャレットが動くキー。上下移動はセクションをまたぐので必須
  static CARET_KEYS = [
    'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
    'Home', 'End', 'PageUp', 'PageDown',
  ]

  // キャレット位置が属するセクションの添字を返す（範囲外は -1）。
  // splitSections() の結果は '\n' で join すると元テキストに戻るので、
  // 各セクションの長さ + 区切りの 1 文字を積み上げれば位置を特定できる
  static indexOfSectionAtCaret(sections, caret) {
    let offset = 0

    for (let i = 0; i < sections.length; i++) {
      const end = offset + sections[i].length
      if (caret <= end) {
        return i
      }
      offset = end + 1 // join('\n') の区切り分
    }

    return -1
  }

  // 選択の同期対象となるセクションか。確定済みのコメント行は必ず `,` で終わる
  // （ETSSection.toString()）ので、入力途中の `#細めた` のような行と区別できる
  static isSyncableSection(sectionText) {
    const head = sectionText.split('\n')[0]
    return head.startsWith('#') && head.endsWith(',')
  }

  constructor({ ids, history, templateManager }) {
    this.ids = ids
    this.history = history
    this.templateManager = templateManager
    this.currentSection = new ETSSection(null, null, null)
    this.caretSyncAttached = false
  }

  // 選択状態を初期化しタグ情報ドロップダウンを更新する
  selectNone() {
    this.currentSection = new ETSSection(null, null, null)
    this.updateTagInfo()
  }

  parseSection(section) {
    let lines = section.split('\n')
    let category = null
    let comment = null
    let tag = null

    // 最初の行がコメント行の場合
    if (lines[0].startsWith('#')) {
      const commentLine = lines[0].replace(/^#\s*/, '').replace(/,$/, '')

      // カッコ内のコメントを抽出
      const commentMatch = commentLine.match(/^(.*?)\s*\((.*?)\)$/)
      if (commentMatch) {
        category = commentMatch[1].trim()
        comment = commentMatch[2].trim()
      } else {
        category = commentLine.trim()
      }

      lines.shift() // コメント行を削除
    }

    // タグを取得
    if (lines.length > 0) {
      tag = lines.join('\n')
    }

    return new ETSSection(comment, tag, category)
  }

  splitSections(content) {
    const sections = []
    let currentSection = []

    for (const line of content.split('\n')) {
      // コメントの行でセクションを分ける
      if (line.startsWith('#') && currentSection.length > 0) {
        sections.push(currentSection.join('\n'))
        currentSection = []
      }

      currentSection.push(line)

      // コメント以外は即時にセクションを分ける
      if (!line.startsWith('#')) {
        sections.push(currentSection.join('\n'))
        currentSection = []
      }
    }

    if (currentSection.length > 0) {
      sections.push(currentSection.join('\n'))
    }

    return sections
  }

  // 指定 textarea 内の対象カテゴリセクションを差し替える(存在しない場合は何もしない)
  replaceSection(textareaId, newSection) {
    const textarea = gradioApp().getElementById(textareaId).querySelector('textarea')
    const targetName = `# ${newSection.category}`
    const sections = this.splitSections(textarea.value)
    let found = false

    const newSections = sections.map(section => {
      if (!found && section.startsWith(targetName)) {
        found = true
        return newSection.toString()
      }
      return section
    })

    if (!found) {
      return false
    }

    textarea.value = newSections.join('\n')
    updateInput(textarea)
    return true
  }

  // モデル選択: チェックポイント切替と Model セクションの差し替え
  applyModelTag(modelName, checkpointName) {
    // チェックポイント切り替え(現在と同じ場合はスキップ)
    if (typeof selectCheckpoint !== 'function') {
      console.error('selectCheckpoint が見つかりません。WebUI のバージョンを確認してください')
      return
    }
    if (checkpointName !== this.templateManager.getCurrentModel()) {
      selectCheckpoint(checkpointName)
    }

    // Model セクションの差し替え(01_クオリティ / 99_ネガティブ)
    const tags = this.templateManager.getTags()
    let replaced = false
    let entryFound = false

    const targets = [
      { file: '01_クオリティ', textareaId: 'txt2img_prompt' },
      { file: '99_ネガティブ', textareaId: 'txt2img_neg_prompt' },
    ]
    for (const { file, textareaId } of targets) {
      // 空文字は「タグを付けない」指定なので差し替え対象に含める(未定義のみスキップ)
      const modelTag = tags?.[file]?.['Model']?.[modelName]
      if (modelTag == null) {
        continue
      }
      entryFound = true
      const newSection = new ETSSection(modelName, modelTag, `${file}:Model`)
      if (this.replaceSection(textareaId, newSection)) {
        replaced = true
      }
    }

    // 表記ゆれによるキー不一致の切り分け用(01/99 のどちらにもエントリが無い場合)
    if (!entryFound) {
      console.warn(`Model エントリが見つかりません: ${modelName}(01_クオリティ / 99_ネガティブ の Model: キーと完全一致しているか確認してください)`)
    }

    if (replaced) {
      this.history.saveTextHistory()
    }
  }

  addTag(comment, tag, category, isAddMode) {
    const targetSection = new ETSSection(comment, tag, category)
    const isNegativeCategory = targetSection.isNegativeCategory()
    const isForceAddCategory = targetSection.isForceAddCategory()
    const isSubCategoryMatch = targetSection.isSubCategoryMatch()
    const id = isNegativeCategory ? 'txt2img_neg_prompt' : 'txt2img_prompt'
    const textarea = gradioApp().getElementById(id).querySelector('textarea')

    // 解像度カテゴリの場合、解像度を反映
    if (targetSection.isResolutionCategory()) {
      const [width, height] = tag.split('x').map(Number)
      if (!isNaN(width) && !isNaN(height)) {
        this.templateManager.applyMeta('Width', width)
        this.templateManager.applyMeta('Height', height)
      }
      return
    }

    // モデルカテゴリの場合、モデル切替と Model セクションの差し替えを行う
    if (targetSection.isModelCategory()) {
      this.applyModelTag(comment, tag)
      return
    }

    // テンプレートの場合はテンプレートの反映
    if (targetSection.isTemplate()) {
      if (tag.startsWith('@')) {
        return
      }

      const categories = category.split(':')
      let templateName = ''

      for (let i = 1; i < categories.length; i++) {
        templateName += `${categories[i].trim()}/`
      }

      templateName += comment

      this.templateManager.applyTemplate(tag, templateName)
      return
    }

    // セクションに分割
    const sections = this.splitSections(textarea.value)
    let newSections = []
    let categoryFound = false

    // 完全一致の検索
    if (!isForceAddCategory) {
      let targetName = targetSection.getHeader()
      newSections = []

      for (const section of sections) {
        if (!categoryFound && section.startsWith(targetName)) {
          newSections.push(targetSection.toString())
          categoryFound = true
        } else {
          newSections.push(section)
        }
      }
    }

    // カテゴリの一致を検索
    if (!categoryFound && !isForceAddCategory && !isAddMode) {
      let targetName = `# ${category}`
      newSections = []

      for (const section of sections) {
        if (!categoryFound && section.startsWith(targetName)) {
          newSections.push(targetSection.toString())
          categoryFound = true
        } else {
          newSections.push(section)
        }
      }
    }

    // カテゴリID一致の検索
    if (!categoryFound && !isForceAddCategory && !isAddMode && !isSubCategoryMatch) {
      let targetName = `# ${targetSection.getCategoryId()}_`
      newSections = []

      for (const section of sections) {
        if (!categoryFound && section.startsWith(targetName)) {
          newSections.push(targetSection.toString())
          categoryFound = true
        } else {
          newSections.push(section)
        }
      }
    }

    // 見つからなかった場合、選択中カテゴリの下に追加
    if (!categoryFound && !isForceAddCategory) {
      const targetName = this.currentSection.getHeader()
      newSections = []

      for (const section of sections) {
        newSections.push(section)

        if (!categoryFound && section.startsWith(targetName)) {
          newSections.push(targetSection.toString())
          categoryFound = true
        }
      }
    }

    // それでも見つからない場合最後に追加
    if (!categoryFound) {
      newSections = []
      for (const section of sections) {
        newSections.push(section)
      }

      newSections.push(targetSection.toString())
    }

    textarea.value = newSections.join('\n')
    updateInput(textarea)

    this.selectCurrent(targetSection)
    this.history.saveTextHistory()
  }

  updateTagInfo() {
    const tagInfoSelect = gradioApp().getElementById(this.ids.TAG_INFO)
    const textarea = gradioApp().getElementById('txt2img_prompt').querySelector('textarea')

    // ドロップダウンのオプションを更新
    const sections = this.splitSections(textarea.value)
    tagInfoSelect.innerHTML = ''

    sections.forEach(section => {
      if (!section.startsWith('#')) {
        return
      }

      const optionElement = document.createElement('option')
      optionElement.value = section
      optionElement.textContent = section.split('\n')[0]
      tagInfoSelect.appendChild(optionElement)
    })

    // 現在のセクションを選択。タグ本文ではなくヘッダー行で一致させる
    // （手書きのプロンプトはカンマや空白の揺れでタグ本文が一致しないため）
    const currentHeader = this.currentSection.getHeader()
    tagInfoSelect.selectedIndex = Array.from(tagInfoSelect.options)
      .findIndex(option => option.textContent === currentHeader)
  }

  selectCurrent(section) {
    if (section.isForceAddCategory() || section.isNegativeCategory()) {
      return
    }

    this.currentSection = section
    this.updateTagInfo()
  }

  // キャレット行のセクションを選択状態へ反映する。
  // 同期しないケース(いずれも直前の選択を維持する):
  //   - キャレットが範囲外
  //   - コメント行を持たないセクション / 入力途中のコメント行(isSyncableSection)
  //   - selectCurrent() が弾く除外カテゴリ(97_Color / 98_特殊 / 99_ネガティブ)
  syncFromCaret(textarea) {
    const sections = this.splitSections(textarea.value)
    const index = ETSPromptEditor.indexOfSectionAtCaret(sections, textarea.selectionStart)
    if (index === -1) {
      return
    }

    const sectionText = sections[index]
    if (!ETSPromptEditor.isSyncableSection(sectionText)) {
      return
    }

    const section = this.parseSection(sectionText)
    // ヘッダーで比較する。タグ本文で比べると同一セクションの編集中も差分ありになり、
    // キー入力ごとに updateTagInfo() が select を作り直してしまう
    if (section.getHeader() === this.currentSection.getHeader()) {
      return
    }

    this.selectCurrent(section)
  }

  // キャレット監視の配線。init() は Reload のたびに走るので二重配線を防ぐ。
  // 対象はポジティブ欄のみ(ドロップダウンが txt2img_prompt のセクションしか列挙しないため)
  attachCaretSync() {
    if (this.caretSyncAttached) {
      return
    }

    const textarea = gradioApp().getElementById('txt2img_prompt')?.querySelector('textarea')
    if (!textarea) {
      console.error('キャレット同期の配線に失敗しました: txt2img_prompt の textarea が見つかりません')
      return
    }

    // isTrusted で人手の入力に限定する。textarea.value の代入はキャレットを末尾へ飛ばし、
    // updateInput() が input を発火するため、拾うと moveTag / Undo / 97_98 の追加で
    // 選択が最後のセクションへ化ける(補完確定だけは onConfirm から明示的に呼ぶ)
    const onCaretEvent = (event) => {
      if (!event.isTrusted) {
        return
      }
      this.syncFromCaret(textarea)
    }

    textarea.addEventListener('input', onCaretEvent)
    textarea.addEventListener('click', onCaretEvent)
    textarea.addEventListener('keyup', (event) => {
      // カーソル移動だけでも判定し直す
      if (ETSPromptEditor.CARET_KEYS.includes(event.key)) {
        onCaretEvent(event)
      }
    })

    this.caretSyncAttached = true
  }

  removeTag(targetSection) {
    if (!targetSection.isValid()) {
      return
    }

    const isNegativeCategory = targetSection.isNegativeCategory()
    const id = isNegativeCategory ? 'txt2img_neg_prompt' : 'txt2img_prompt'
    const textarea = gradioApp().getElementById(id).querySelector('textarea')

    // テンプレートの場合は削除しない
    if (targetSection.isTemplate()) {
      return
    }

    // 上書き用セクションを構築
    const overrideSection = new ETSSection('なし', '', targetSection.category)

    // セクションに分割
    const sections = this.splitSections(textarea.value)
    let newSections = []
    let categoryFound = false

    // 該当セクションを削除
    {
      const targetName = targetSection.getHeader()
      for (const section of sections) {
        if (!categoryFound && section.startsWith(targetName)) {
          newSections.push(overrideSection.toString())
          categoryFound = true
        } else {
          newSections.push(section)
        }
      }
    }

    // 見つからなかった場合、カテゴリ一致で削除
    if (!categoryFound) {
      const targetName = `# ${targetSection.category}`
      newSections = []

      for (const section of sections) {
        if (!categoryFound && section.startsWith(targetName)) {
          newSections.push(overrideSection.toString())
          categoryFound = true
        } else {
          newSections.push(section)
        }
      }
    }

    // 見つからなかった場合、カテゴリIDで削除
    if (!categoryFound) {
      const targetName = `# ${targetSection.getCategoryId()}_`
      newSections = []

      for (const section of sections) {
        if (!categoryFound && section.startsWith(targetName)) {
          newSections.push(overrideSection.toString())
          categoryFound = true
        } else {
          newSections.push(section)
        }
      }
    }

    textarea.value = newSections.join('\n')
    updateInput(textarea)

    this.selectCurrent(overrideSection)
    this.history.saveTextHistory()
  }

  moveTag(targetSection, direction) {
    if (!targetSection.isValid()) {
      return
    }

    const isNegativeCategory = targetSection.isNegativeCategory()
    const id = isNegativeCategory ? 'txt2img_neg_prompt' : 'txt2img_prompt'
    const textarea = gradioApp().getElementById(id).querySelector('textarea')

    // テンプレートの場合は移動しない
    if (targetSection.isTemplate()) {
      return
    }

    // セクションに分割
    const sections = this.splitSections(textarea.value)
    let newSections = []
    let targetIndex = -1

    // 対象のセクションを探す
    const targetName = targetSection.getHeader()
    for (let i = 0; i < sections.length; i++) {
      if (sections[i].startsWith(targetName)) {
        targetIndex = i
        break
      }
    }

    // 対象のセクションが見つからない場合は何もしない
    if (targetIndex === -1) {
      console.warn(`Target section not found: ${targetName}`)
      return
    }

    // 移動先のインデックスを計算
    const newIndex = targetIndex + direction

    // 移動先が範囲外の場合は何もしない
    if (newIndex < 0 || newIndex >= sections.length) return

    // セクションを移動
    for (let i = 0; i < sections.length; i++) {
      if (i === newIndex) {
        newSections.push(sections[targetIndex])
      } else if (i === targetIndex) {
        newSections.push(sections[newIndex])
      } else {
        newSections.push(sections[i])
      }
    }

    textarea.value = newSections.join('\n')
    updateInput(textarea)

    this.history.saveTextHistory()
  }
}
