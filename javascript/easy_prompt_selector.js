class EasyTemplateSelector {
  // ID定数
  static IDS = {
    AREA: 'easy_template_selector_area',
    SELECT: 'easy_template_selector_select',
    CONTENT: 'easy_template_selector_content',
    HEADER: 'easy_template_selector_header',
    TAG_INFO: 'easy_template_selector_tag_info',
    TEMPLATE_NAME: 'easy_template_selector_template_name',
    IMAGE_INFO: 'easy_template_selector_image_info',
    APPLY_BUTTON: 'easy_template_selector_apply_button',
    UNDO_BUTTON: 'easy_template_selector_undo_button',
    REDO_BUTTON: 'easy_template_selector_redo_button',
    CONTAINER: 'easy_template_selector_container'
  }

  constructor(yaml, gradioApp) {
    this.yaml = yaml
    this.gradioApp = gradioApp
    this.visible = true
    this.replaceExisting = true
    this.tags = undefined
    this.currentTab = null
    this.currentSection = new ETSSection(null, null, null)
    this.history = new ETSHistory({ ids: EasyTemplateSelector.IDS })

    this.metaInfoMap = [
      { key: 'Template name', id: EasyTemplateSelector.IDS.TEMPLATE_NAME, type: 'input' },
      { key: 'Steps', id: 'txt2img_steps', type: 'input' },
      { key: 'Sampler', id: 'txt2img_sampling', type: 'dropdown' },
      { key: 'Schedule type', id: 'txt2img_scheduler', type: 'dropdown' },
      { key: 'CFG Scale', id: 'txt2img_cfg_scale', type: 'input' },
      { key: 'Seed', id: 'txt2img_seed_row', type: 'input' },
      { key: 'Size', id: '', type: '' },
      { key: 'Width', id: 'txt2img_width', type: 'input' },
      { key: 'Height', id: 'txt2img_height', type: 'input' },
      { key: 'Model', id: 'setting_sd_model_checkpoint', type: 'dropdown' },
      { key: 'Denoising strength', id: 'txt2img_denoising_strength', type: 'input' },
      { key: 'Clip skip', id: 'setting_CLIP_stop_at_last_layers', type: 'input' },
      { key: 'Hires visible', id: 'txt2img_hr-visible-checkbox', type: 'checkbox' },
      { key: 'Hires CFG Scale', id: 'txt2img_hr_cfg', type: 'input' },
      { key: 'Hires upscale', id: 'txt2img_hr_scale', type: 'input' },
      { key: 'Hires steps', id: 'txt2img_hires_steps', type: 'input' },
      { key: 'Hires upscaler', id: 'txt2img_hr_upscaler', type: 'dropdown' },
    ]
  }

  async init() {
    // ツールチップ用のスタイルを追加
    const style = document.createElement('style')
    style.textContent = `
      [easy-template-tooltip]:hover::before {
        content: attr(easy-template-tooltip);
        position: absolute;
        top: 100%;
        left: 50%;
        transform: translateX(-50%);
        padding: 4px 8px;
        background-color: rgba(102, 102, 102, 0.7);
        color: #ffffff;
        border: none;
        border-radius: 0;
        font-size: 12px;
        white-space: nowrap;
        z-index: 1000;
        pointer-events: none;
        margin-top: 4px;
      }
    `
    document.head.appendChild(style)

    this.tags = await this.fetchTags()

    gradioApp()
      .getElementById('txt2img_toprow')
      .after(this.render())
  }

  async readFile(filepath) {
    const response = await fetch(`file=${filepath}?${new Date().getTime()}`);

    return await response.text();
  }

  async fetchTags() {
    try {
      // テンプレートの取得
      const templateResponse = await fetch('/easy-template/templates');
      if (!templateResponse.ok) {
        throw new Error('テンプレートの取得に失敗しました');
      }
      const templates = await templateResponse.json();
      const tags = { '00_テンプレート': templates };

      // タグの取得
      const tagResponse = await fetch('/easy-template/tags');
      if (!tagResponse.ok) {
        throw new Error('タグの取得に失敗しました');
      }
      const tagData = await tagResponse.json();
      for (const [filename, content] of Object.entries(tagData)) {
        yaml.loadAll(content, function (doc) {
          tags[filename] = doc;
        });
      }

      return tags;
    } catch (error) {
      console.error('タグ取得エラー:', error);
      alert('タグの取得に失敗しました。\n' + error.message);
      return {};
    }
  }

  // Render
  render() {
    let container = gradioApp().querySelector(`#${EasyTemplateSelector.IDS.AREA}`)
    if (!container) {
      container = ETSElementBuilder.areaContainer(EasyTemplateSelector.IDS.AREA)

      const reloadButton = ETSElementBuilder.reloadButton({
        onClick: () => this.reload()
      })

      const undoButton = ETSElementBuilder.undoButton({
        onClick: () => this.history.undoLastAction()
      })
      undoButton.id = EasyTemplateSelector.IDS.UNDO_BUTTON

      const redoButton = ETSElementBuilder.redoButton({
        onClick: () => this.history.redoLastAction()
      })
      redoButton.id = EasyTemplateSelector.IDS.REDO_BUTTON

      const templateNameArea = ETSElementBuilder.textarea(EasyTemplateSelector.IDS.TEMPLATE_NAME, "テンプレート名", {
        onChange: () => {}
      })

      const saveButton = ETSElementBuilder.saveButton({
        onClick: () => this.saveTemplate()
      })
  
      const upButton = ETSElementBuilder.upButton({
        onClick: () => this.moveTag(this.currentSection, -1)
      })
  
      const downButton = ETSElementBuilder.downButton({
        onClick: () => this.moveTag(this.currentSection, +1)
      })
  
      const deleteButton = ETSElementBuilder.deleteButton({
        onClick: () => this.removeTag(this.currentSection)
      })
  
      const tagInfoSelect = ETSElementBuilder.dropDown(EasyTemplateSelector.IDS.TAG_INFO, [], {
        onChange: (value) => {
          if (!value) return
          const selectedSection = this.parseSection(value)
          this.selectCurrent(selectedSection)
        }
      })
  
      container.header.appendChild(reloadButton)
      container.header.appendChild(undoButton)
      container.header.appendChild(redoButton)
      container.header.appendChild(templateNameArea)
      container.header.appendChild(saveButton)
      container.header.appendChild(tagInfoSelect)
      container.header.appendChild(upButton)
      container.header.appendChild(downButton)
      container.header.appendChild(deleteButton)
    }

    const contentArea = container.contentArea

    const row = document.createElement('div')
    row.style.display = 'flex'
    row.style.alignItems = 'center'
    row.style.gap = '10px'

    const tabs = this.renderTabs()
    tabs.style.flex = '1'
    tabs.style.minWidth = '1'
    row.appendChild(tabs)

    while (contentArea.firstChild) {
      contentArea.removeChild(contentArea.firstChild)
    }

    contentArea.appendChild(row)
    contentArea.appendChild(this.renderContent())

    this.history.updateUndoRedoButtons()

    return container
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

  renderTabs() {
    const tabs = document.createElement('div')
    tabs.style.display = 'flex'
    tabs.style.flexWrap = 'wrap'
    tabs.style.gap = '4px'
    tabs.style.padding = '4px'
    tabs.style.backgroundColor = 'var(--block-background-fill)'
    tabs.style.borderRadius = 'var(--block-radius)'

    // Svelteのクラス名を取得
    const svelteClass = gradioApp().querySelector('.gradio-button')?.classList
      .toString()
      .match(/svelte-[a-z0-9]+/)?.[0]

    Object.keys(this.tags).forEach((key) => {
      const tab = document.createElement('button')
      tab.textContent = key

      // 初期タブを設定
      if (this.currentTab === null) {
        this.currentTab = key
      }

      // Gradioのクラスを追加
      tab.classList.add('gradio-button', 'sm', 'secondary')
      
      // Svelteのクラスを追加
      if (svelteClass) {
        tab.classList.add(svelteClass)
      }
      
      // アクティブなタブのスタイル
      if (key === this.currentTab) {
        tab.classList.remove('secondary')
        tab.classList.add('primary')
      }

      tab.addEventListener('click', () => {
        // 同じタブをクリックした場合は非アクティブにする
        if (key === this.currentTab) {
          tab.classList.remove('primary')
          tab.classList.add('secondary')
          this.currentTab = null;

          // すべてのコンテンツを非表示
          const content = gradioApp().getElementById(EasyTemplateSelector.IDS.CONTENT)
          Array.from(content.childNodes).forEach((node) => {
            this.changeVisibility(node, false)
          })
          return;
        }

        // すべてのタブのスタイルをリセット
        Array.from(tabs.children).forEach(t => {
          t.classList.remove('primary')
          t.classList.add('secondary')
        })
        
        // クリックされたタブをアクティブに
        tab.classList.remove('secondary')
        tab.classList.add('primary')
        this.currentTab = key;  // 現在のタブを更新

        // コンテンツの表示を切り替え
        const content = gradioApp().getElementById(EasyTemplateSelector.IDS.CONTENT)
        Array.from(content.childNodes).forEach((node) => {
          const visible = node.id === `${EasyTemplateSelector.IDS.CONTAINER}-${key}`
          this.changeVisibility(node, visible)
        })
      })

      tabs.appendChild(tab)
    })

    return tabs
  }

  renderContent() {
    const content = document.createElement('div')
    content.id = EasyTemplateSelector.IDS.CONTENT

    Object.keys(this.tags).forEach((key) => {
      const values = this.tags[key]

      const fields = ETSElementBuilder.tagFields()
      fields.id = `${EasyTemplateSelector.IDS.CONTAINER}-${key}`
      fields.style.display = key === this.currentTab ? 'flex' : 'none'  // 現在のタブのみ表示
      fields.style.flexDirection = 'column'
      fields.style.marginTop = '10px'

      fields.append(this.renderTagButton(key, `@${key}@`, key))

      const buttons = ETSElementBuilder.tagFields()
      buttons.id = 'buttons'
      fields.append(buttons)
      this.renderTagButtons(values, key).forEach((group) => {
        buttons.appendChild(group)
      })

      content.appendChild(fields)
    })

    return content
  }

  renderTagButtons(tags, prefix = '') {
    if (Array.isArray(tags)) {
      return tags.map((tag) => this.renderTagButton(tag, tag, prefix, 'secondary'))
    } else {
      return Object.keys(tags).map((key) => {
        const values = tags[key]
        const randomKey = `${prefix}:${key}`

        if (typeof values === 'string') { return this.renderTagButton(key, values, prefix, 'secondary') }

        const fields = ETSElementBuilder.tagFields()
        fields.style.flexDirection = 'column'

        fields.append(this.renderTagButton(key, `@${randomKey}@`, randomKey))

        const buttons = ETSElementBuilder.tagFields()
        buttons.id = 'buttons'
        fields.append(buttons)
        this.renderTagButtons(values, randomKey).forEach((button) => {
          buttons.appendChild(button)
        })

        return fields
      })
    }
  }

  renderTagButton(comment, tag, category, color = 'primary') {
    return ETSElementBuilder.tagButton({
      title: comment,
      value: tag,
      onClick: (e) => {
        e.preventDefault();

        this.addTag(comment, tag, category, e.metaKey || e.ctrlKey)
      },
      onRightClick: (e) => {
        e.preventDefault();

        const targetSection = new ETSSection(comment, tag, category)
        this.removeTag(targetSection)
      },
      color
    })
  }

  // Util
  changeVisibility(node, visible) {
    node.style.display = visible ? 'flex' : 'none'
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
        this.applyMeta('Width', width)
        this.applyMeta('Height', height)
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

      this.applyTemplate(tag, templateName)
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
    const tagInfoSelect = gradioApp().getElementById(EasyTemplateSelector.IDS.TAG_INFO)
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

  getMetaElement(key) {
    const metaInfo = this.metaInfoMap.find(param => param.key === key)
    if (!metaInfo || !metaInfo.id) {
      return null
    }

    let element = gradioApp().getElementById(metaInfo.id)?.querySelector('input')
    if (!element && metaInfo.type === 'checkbox') {
      element = gradioApp().getElementById(metaInfo.id)
    }

    if (!element) {
      console.error(`Element with ID ${metaInfo.id} not found`)
      return null
    }
    return element
  }

  applyMeta(key, value) {
    const metaInfo = this.metaInfoMap.find(param => param.key === key)
    const element = this.getMetaElement(key)
    if (!metaInfo || !element) {
      return
    }

    if (metaInfo.type === 'dropdown') {
      //ETSElementBuilder.updateDropdown(element, value)
    } else if (metaInfo.type === 'checkbox') {
      element.checked = value === 'true'
      element.dispatchEvent(new Event('change', { bubbles: true }))
      updateInput(element)
    } else if (metaInfo.type === 'input') {
      element.value = value
      updateInput(element)
    }
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

  applyTemplate(template, templateName) {
    const textarea = gradioApp().getElementById('txt2img_prompt').querySelector('textarea')
    const negTextarea = gradioApp().getElementById('txt2img_neg_prompt').querySelector('textarea')

    // パース
    const parsed = this.parseMetaText(template)
    let prompt = parsed.prompt
    let negPrompt = parsed.negPrompt
    let metaDataMap = parsed.metaDataMap

    // サイズを分解
    if ('Size' in metaDataMap) {
      const [width, height] = metaDataMap['Size'].split('x')
      metaDataMap['Width'] = width
      metaDataMap['Height'] = height
    }

    // テンプレート名を設定
    metaDataMap['Template name'] = templateName

    // Hiresが有効か
    metaDataMap['Hires visible'] = 'Hires upscaler' in metaDataMap ? 'true' : 'false'

    textarea.value = prompt.trim()
    updateInput(textarea)

    negTextarea.value = negPrompt.trim()
    updateInput(negTextarea)

    // テキスト履歴をリセット
    this.history.resetTextHistory()
    this.history.saveTextHistory()

    const imageInfo = gradioApp().getElementById(EasyTemplateSelector.IDS.IMAGE_INFO).querySelector('textarea')
    const applyButton = gradioApp().getElementById(EasyTemplateSelector.IDS.APPLY_BUTTON)

    if (imageInfo && applyButton) {
      imageInfo.value = template
      updateInput(imageInfo)

      applyButton.dispatchEvent(new MouseEvent('click', {
        bubbles: true,
        cancelable: true,
        view: window
      }))
    }

    setTimeout(() => {
      for (const [key, value] of Object.entries(metaDataMap)) {
        this.applyMeta(key, value)
      }
    }, 1500)

    const modelName = metaDataMap['Model']
    if (modelName != this.getCurrentModel()) {
      setTimeout(() => {
        console.log('selectCheckpoint', modelName)
        selectCheckpoint(modelName)
      }, 100)
    }

    this.currentSection = new ETSSection(null, null, null)
    this.updateTagInfo()
  }

  convertToTemplate(prompt, negPrompt, metaDataMap) {
    let metaText = ''

    if (prompt) {
      metaText += `${prompt.trim()}\n`
    }
    if (negPrompt) {
      metaText += `Negative prompt: ${negPrompt.trim()}\n`
    }

    const isHiresVisible = metaDataMap['Hires visible'] === 'true'

    for (const [key, value] of Object.entries(metaDataMap)) {
      if (key == 'Width' || key == 'Height') {
        continue
      }
      if (key == 'Template name') {
        continue
      }
      if (key == 'Hires visible') {
        continue
      }

      if (!isHiresVisible) {
        if (key == 'Hires CFG Scale' || key == 'Hires upscale' || key == 'Hires steps' || key == 'Hires upscaler' || key == 'Denoising strength') {
          continue
        }
      }

      metaText += `${key}: ${value}, `
    }
    return metaText
  }

  parseMetaText(metaText) {
    const result = {
      prompt: '',
      negPrompt: '',
      metaDataMap: {}
    }

    // 行ごとに分割
    const lines = metaText.split('\n')
    let isNegative = false
    let isMetaData = false

    for (let line of lines) {
      // メタデータの開始を検出
      if (line.startsWith('Steps:')) {
        isMetaData = true
      }

      // ネガティブプロンプトの開始を検出
      if (line.startsWith('Negative prompt:')) {
        isNegative = true
        line = line.replace('Negative prompt:', '')
      }

      // メタデータの行を処理
      if (isMetaData) {
        const metaItems = line.split(',').map(item => item.trim())
        for (const item of metaItems) {
          if (item.includes(':')) {
            const [key, value] = item.split(':').map(s => s.trim())
            result.metaDataMap[key] = value
          }
        }
        continue
      }

      // 通常のプロンプト行
      if (!isNegative && !isMetaData) {
        result.prompt += line + '\n'
      } else if (isNegative && !isMetaData) {
        result.negPrompt += line + '\n'
      }
    }

    // 末尾の改行を削除
    result.prompt = result.prompt.trim()
    result.negPrompt = result.negPrompt.trim()

    return result
  }

  getCurrentMetaDataMap() {
    let metaDataMap = {}

    for (const metaInfo of this.metaInfoMap) {
      if (metaInfo.key === 'Model') {
        const modelName = this.getCurrentModel()
        metaDataMap[metaInfo.key] = modelName
        continue
      } else if (metaInfo.key === 'Size') {
        const size = this.getCurrentSize()
        metaDataMap[metaInfo.key] = size
        continue
      }

      const element = this.getMetaElement(metaInfo.key)
      if (element) {
        if (metaInfo.type === 'checkbox') {
          metaDataMap[metaInfo.key] = element.checked.toString()
        } else {
          metaDataMap[metaInfo.key] = element.value
        }
      }
    }

    return metaDataMap
  }

  async saveTemplate() {
    const prompt = gradioApp().getElementById('txt2img_prompt').querySelector('textarea').value
    const negPrompt = gradioApp().getElementById('txt2img_neg_prompt').querySelector('textarea').value

    var metaDataMap = this.getCurrentMetaDataMap()

    // テンプレ名を取得
    const templateName = metaDataMap['Template name']
    if (!templateName) {
      alert('テンプレートの名前を指定してください。')
      return
    }

    // 既存のテンプレートを確認
    const templateParts = templateName.split('/')
    let currentLevel = this.tags['00_テンプレート']
    let exists = false

    // 階層をたどって既存のテンプレートを確認
    for (let i = 0; i < templateParts.length; i++) {
      const part = templateParts[i]
      if (i === templateParts.length - 1) {
        exists = typeof currentLevel[part] === 'string'
      } else {
        if (!currentLevel[part] || typeof currentLevel[part] !== 'object') {
          break
        }
        currentLevel = currentLevel[part]
      }
    }

    if (exists) {
      const confirmed = confirm(`"${templateName}"は既に存在します。上書きしますか？`)
      if (!confirmed) {
        return
      }
    }

    const template = this.convertToTemplate(prompt, negPrompt, metaDataMap)

    // APIを呼び出して保存
    try {
      const response = await fetch('/easy-template/save-template', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          templatename: templateName + '.txt',
          content: template
        })
      })
      
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`${response.status} ${response.statusText}\n${errorText}`);
      }
      
      // 保存成功後、ファイルリストを更新
      await this.init()
    } catch (error) {
      console.error('テンプレート保存エラー:', error);
      alert('テンプレートの保存に失敗しました\n' + error.message);
      return {};
    }
  }

  getCurrentModel() {
    const element = this.getMetaElement('Model')
    if (element) {
      return element.value.split(/[\\/]/).pop().replace(/\.[^/.]+$/, '')
    }
    return ''
  }

  getCurrentSize() {
    const widthElement = this.getMetaElement('Width')
    const heightElement = this.getMetaElement('Height')
    if (widthElement && heightElement) {
      return `${widthElement.value}x${heightElement.value}`
    }
    return ''
  }

  async reload() {
    try {
      const response = await fetch('/easy-template/reload', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({})
      })

      if (!response.ok) {
        throw new Error('更新に失敗しました')
      }

      await this.init()
    } catch (error) {
      console.error('更新エラー:', error)
    }
  }

}

onUiLoaded(async () => {
  yaml = window.jsyaml
  const easyPromptSelector = new EasyTemplateSelector(yaml, gradioApp())

  const txt2imgActionColumn = gradioApp().getElementById('txt2img_actions_column')
  const container = document.createElement('div')
  container.classList.add('easy_template_selector_container')

  txt2imgActionColumn.appendChild(container)

  /*const imageInfo = gradioApp().getElementById(EasyTemplateSelector.IDS.IMAGE_INFO)
  const applyButton = gradioApp().getElementById(EasyTemplateSelector.IDS.APPLY_BUTTON)

  container.appendChild(imageInfo)
  container.appendChild(applyButton)*/

  await easyPromptSelector.init()
})
