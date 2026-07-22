// プロンプトテキストのセクション分解とタグの追加・削除・移動・選択状態管理
class ETSPromptEditor {
  constructor({ ids, history, templateManager }) {
    this.ids = ids
    this.history = history
    this.templateManager = templateManager
    this.currentSection = new ETSSection(null, null, null)
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

    // 現在のセクションを選択
    tagInfoSelect.value = this.currentSection.toString()
  }

  selectCurrent(section) {
    //console.log('selectCurrent', section)

    if (section.isForceAddCategory() || section.isNegativeCategory()) {
      return
    }

    this.currentSection = section
    this.updateTagInfo()
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
