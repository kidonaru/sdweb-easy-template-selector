class ETSElementBuilder {
  // Templates
  static baseButton(text, { size = 'sm', color = 'primary', customColor = null, tooltip = null }) {
    const button = document.createElement('button')
    button.classList.add(
      'gradio-button',
      'lg',
      size
    )
    if (color) {
      button.classList.add(color)
    }

    // ツールチップを追加
    if (tooltip) {
      button.setAttribute('easy-template-tooltip', tooltip)
      button.style.position = 'relative'
      button.style.cursor = 'pointer'
    }

    // カスタムカラーが指定されている場合は直接スタイルを設定
    if (customColor) {
      button.style.backgroundColor = customColor
      button.style.borderColor = customColor
      button.style.color = '#ffffff'

      // 背景色の明るさを計算して、テキストの色を自動調整
      const rgb = this.hexToRgb(customColor)
      if (rgb) {
        const brightness = (rgb.r * 299 + rgb.g * 587 + rgb.b * 114) / 1000
        button.style.color = brightness > 128 ? '#000000' : '#ffffff'
      }
    }

    // Svelteのクラス名を取得して追加
    const svelteClass = gradioApp().querySelector('.gradio-button')?.classList
      .toString()
      .match(/svelte-[a-z0-9]+/)?.[0]
    if (svelteClass) {
      button.classList.add(svelteClass)
    }
    
    button.textContent = text
    button.style.minWidth = 'min-content'
    button.style.height = 'var(--size-7)'

    return button
  }

  // 16進数カラーコードをRGBに変換するヘルパーメソッド
  static hexToRgb(hex) {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex)
    return result ? {
      r: parseInt(result[1], 16),
      g: parseInt(result[2], 16),
      b: parseInt(result[3], 16)
    } : null
  }

  static tagFields() {
    const fields = document.createElement('div')
    fields.style.display = 'flex'
    fields.style.flexDirection = 'row'
    fields.style.flexWrap = 'wrap'
    fields.style.minWidth = 'min(320px, 100%)'
    fields.style.maxWidth = '100%'
    fields.style.flex = '1 calc(50% - 20px)'
    fields.style.borderWidth = '1px'
    fields.style.borderColor = 'var(--block-border-color,#374151)'
    fields.style.borderRadius = 'var(--block-radius,8px)'
    fields.style.padding = '8px'
    fields.style.height = 'fit-content'

    return fields
  }

  // Elements
  static openButton({ onClick }) {
    const button = ETSElementBuilder.baseButton('🔯タグを選択', { size: 'sm', color: 'secondary' })
    button.classList.add('easy_template_selector_button')
    button.addEventListener('click', onClick)

    return button
  }

  static areaContainer(id = undefined) {
    const container = gradioApp().getElementById('txt2img_results').cloneNode()
    container.id = id
    container.style.gap = 0
    container.style.display = 'flex'
    container.style.flexDirection = 'column'

    // アコーディオンヘッダーを追加
    const header = document.createElement('div')
    header.style.display = 'flex'
    header.style.alignItems = 'center'
    header.style.padding = '8px'
    header.style.backgroundColor = 'var(--block-background-fill)'
    header.style.borderRadius = 'var(--block-radius)'
    header.style.marginBottom = '8px'
    header.style.gap = '12px'

    // タイトル部分（開閉可能な領域）
    const titleSection = document.createElement('div')
    titleSection.style.display = 'flex'
    titleSection.style.alignItems = 'center'
    titleSection.style.cursor = 'pointer'
    titleSection.style.gap = '8px'

    // 開閉アイコン
    const icon = document.createElement('span')
    icon.textContent = '▼'
    titleSection.appendChild(icon)

    // タイトル
    const title = document.createElement('span')
    title.textContent = 'EasyTemplateSelector'
    titleSection.appendChild(title)

    // 開閉状態の管理
    let isOpen = true
    titleSection.addEventListener('click', () => {
      isOpen = !isOpen
      icon.textContent = isOpen ? '▼' : '▶'
      content.style.display = isOpen ? 'flex' : 'none'
    })

    header.appendChild(titleSection)

    // コンテンツエリア
    const content = document.createElement('div')
    content.style.display = 'flex'
    content.style.flexDirection = 'column'
    content.style.gap = '8px'

    container.appendChild(header)
    container.appendChild(content)

    // コンテンツエリアへの参照を保持
    container.contentArea = content
    container.header = header

    return container
  }

  static tagButton({ title, value, onClick, onRightClick, color = 'primary' }) {
    // タイトルから色コードを抽出
    const colorMatch = title.match(/\[(#[0-9A-Fa-f]{6})\]/);
    let buttonTitle = title;
    let buttonColor = color;
    let customColor = null;

    if (colorMatch) {
      // 色コードが見つかった場合
      customColor = colorMatch[1];
      buttonTitle = title.replace(/\[#[0-9A-Fa-f]{6}\]/, '').trim();
      buttonColor = null; // カスタムカラーを使用する場合はcolorを空に
    }

    // 改行が含まれていたらtooltipを表示しない
    const tooltip = value.includes('\n') ? null : value

    const button = ETSElementBuilder.baseButton(buttonTitle, { color: buttonColor, customColor, tooltip })
    button.style.height = '2rem'
    button.style.flexGrow = '0'
    button.style.margin = '2px'

    button.addEventListener('click', onClick)
    button.addEventListener('contextmenu', onRightClick)

    return button
  }

  static dropDown(id, options, { onChange }) {
    const select = document.createElement('select')
    select.id = id

    // gradio 3.16
    select.classList.add('gr-box', 'gr-input')

    // gradio 3.22
    select.style.color = 'var(--body-text-color)'
    select.style.backgroundColor = 'var(--input-background-fill)'
    select.style.borderColor = 'var(--block-border-color)'
    select.style.borderRadius = 'var(--block-radius)'
    select.style.margin = '2px'
    select.style.minWidth = '200px'
    select.style.maxWidth = '400px'

    select.addEventListener('change', (event) => { onChange(event.target.value) })

    return select
  }

  static checkbox(text, checked, { onChange }) {
    const label = document.createElement('label')
    label.style.display = 'flex'
    label.style.alignItems = 'center'
    label.style.margin = '0'
    label.style.padding = '0'
    label.style.cursor = 'pointer'

    const checkbox = document.createElement('input')
    checkbox.type = 'checkbox'
    checkbox.classList.add('input-accordion-checkbox')
    checkbox.checked = checked
    
    // Svelteのクラス名を取得して追加
    const svelteClass = gradioApp().querySelector('.input-accordion-checkbox')?.classList
      .toString()
      .match(/svelte-[a-z0-9]+/)?.[0]
    if (svelteClass) {
      checkbox.classList.add(svelteClass)
    }

    checkbox.addEventListener('change', () => {
      onChange(checkbox.checked)
    })

    const span = document.createElement('div')
    span.classList.add('bilingual__trans_wrapper')
    span.textContent = text

    label.appendChild(checkbox)
    label.appendChild(span)

    return label
  }

  static textarea(id, placeholder, { onChange }) {
    const container = document.createElement('div')
    container.id = id
    container.classList.add('block', 'gradio-textbox', 'padded')
    container.style.borderStyle = 'solid'
    container.style.overflow = 'hidden'
    container.style.flexGrow = '0.3'
    container.style.minWidth = '200px'
    container.style.maxWidth = '400px'
    container.style.borderWidth = 'var(--block-border-width)'
    container.style.height = 'var(--size-7)'

    const label = document.createElement('label')

    const input = document.createElement('input')
    input.setAttribute('data-testid', 'textbox')
    input.type = 'text'
    input.classList.add('scroll-hide')
    input.setAttribute('dir', 'ltr')
    input.placeholder = placeholder
    input.style.height = 'var(--size-7)'

    // Svelteのクラス名を取得して追加
    let svelteClass = gradioApp().querySelector('.gradio-textbox')?.classList
      .toString()
      .match(/svelte-[a-z0-9]+/)?.[0]
    if (svelteClass) {
      container.classList.add(svelteClass)
    }

    svelteClass = gradioApp().querySelector('.gradio-textbox label')?.classList
      .toString()
      .match(/svelte-[a-z0-9]+/)?.[0]
    if (svelteClass) {
      label.classList.add(svelteClass)
    }

    svelteClass = gradioApp().querySelector('.gradio-textbox input')?.classList
      .toString()
      .match(/svelte-[a-z0-9]+/)?.[0]
    if (svelteClass) {
      input.classList.add(svelteClass)
    }

    input.addEventListener('input', () => {
      onChange(input.value)
    })

    label.appendChild(input)
    container.appendChild(label)

    return container
  }

  static reloadButton({ onClick }) {
    const button = ETSElementBuilder.baseButton('🔄', { 
      size: 'tool', 
      color: 'secondary',
      tooltip: 'テンプレートとタグを再読み込み'
    })
    button.addEventListener('click', onClick)
    return button
  }
  
  static saveButton({ onClick }) {
    const button = ETSElementBuilder.baseButton('💾', { 
      size: 'tool', 
      color: 'secondary',
      tooltip: '現在のテンプレートを保存'
    })
    button.addEventListener('click', onClick)
    return button
  }

  static upButton({ onClick }) {
    const button = ETSElementBuilder.baseButton('⬆️', { 
      size: 'tool', 
      color: 'secondary',
      tooltip: '編集中のプロンプト行を上に移動'
    })
    button.addEventListener('click', onClick)
    return button
  }

  static downButton({ onClick }) {
    const button = ETSElementBuilder.baseButton('⬇️', { 
      size: 'tool', 
      color: 'secondary',
      tooltip: '編集中のプロンプト行を下に移動'
    })
    button.addEventListener('click', onClick)
    return button
  }

  static deleteButton({ onClick }) {
    const button = ETSElementBuilder.baseButton('🗑️', { 
      size: 'tool', 
      color: 'secondary',
      tooltip: '編集中のプロンプト行を削除'
    })
    button.addEventListener('click', onClick)
    return button
  }

  static undoButton({ onClick }) {
    const button = ETSElementBuilder.baseButton('↩️', { 
      size: 'tool', 
      color: 'secondary',
      tooltip: 'プロンプトの変更を元に戻す'
    })
    button.addEventListener('click', onClick)
    return button
  }

  static redoButton({ onClick }) {
    const button = ETSElementBuilder.baseButton('↪️', { 
      size: 'tool', 
      color: 'secondary',
      tooltip: 'プロンプトの変更をやり直す'
    })
    button.addEventListener('click', onClick)
    return button
  }

  static updateDropdown(element, value) {
    element.value = value

    // 少し待ってからEnterキーを発火
    setTimeout(() => {
      element.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'Enter',
        code: 'Enter',
        keyCode: 13,
        which: 13,
        bubbles: true
      }))
    }, 100)
  }
}

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
}

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
    this.textHistory = []
    this.currentHistoryIndex = -1
    this.maxHistoryLength = 20

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
        onClick: () => this.undoLastAction()
      })
      undoButton.id = EasyTemplateSelector.IDS.UNDO_BUTTON

      const redoButton = ETSElementBuilder.redoButton({
        onClick: () => this.redoLastAction()
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

    this.updateUndoRedoButtons()

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
    this.saveTextHistory()
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
    this.saveTextHistory()
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

    this.saveTextHistory()
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

    textarea.value = prompt.trim()
    updateInput(textarea)

    negTextarea.value = negPrompt.trim()
    updateInput(negTextarea)

    // テキスト履歴をリセット
    this.resetTextHistory()
    this.saveTextHistory()

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

  convertMetaText(prompt, negPrompt, metaDataMap) {
    let metaText = ''

    if (prompt) {
      metaText += `${prompt.trim()}\n`
    }
    if (negPrompt) {
      metaText += `Negative prompt: ${negPrompt.trim()}\n`
    }

    for (const [key, value] of Object.entries(metaDataMap)) {
      if (key == 'Width' || key == 'Height') {
        continue
      }
      if (key == 'Template name') {
        continue
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
          metaDataMap[metaInfo.key] = element.checked
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

    const template = this.convertMetaText(prompt, negPrompt, metaDataMap)

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

  undoLastAction() {
    if (this.currentHistoryIndex > 0) {
      this.restoreFromHistory(this.currentHistoryIndex - 1)
      this.updateUndoRedoButtons()
    }
  }

  redoLastAction() {
    if (this.currentHistoryIndex < this.textHistory.length - 1) {
      this.restoreFromHistory(this.currentHistoryIndex + 1)
      this.updateUndoRedoButtons()
    }
  }

  // テキスト履歴を保存するメソッド
  saveTextHistory() {
    const textarea = gradioApp().getElementById('txt2img_prompt').querySelector('textarea')
    const negTextarea = gradioApp().getElementById('txt2img_neg_prompt').querySelector('textarea')
    
    const currentState = {
      prompt: textarea.value,
      negPrompt: negTextarea.value
    }

    // 現在の位置より後の履歴を削除
    if (this.currentHistoryIndex < this.textHistory.length - 1) {
      this.textHistory = this.textHistory.slice(0, this.currentHistoryIndex + 1)
    }

    // 新しい状態を追加
    this.textHistory.push(currentState)
    
    // 履歴の長さを制限
    if (this.textHistory.length > this.maxHistoryLength) {
      this.textHistory.shift()
    } else {
      this.currentHistoryIndex++
    }

    this.updateUndoRedoButtons()
  }

  resetTextHistory() {
    this.textHistory = []
    this.currentHistoryIndex = -1
    this.updateUndoRedoButtons()
  }

  // 履歴から状態を復元するメソッド
  restoreFromHistory(index) {
    if (index < 0 || index >= this.textHistory.length) return

    const state = this.textHistory[index]
    const textarea = gradioApp().getElementById('txt2img_prompt').querySelector('textarea')
    const negTextarea = gradioApp().getElementById('txt2img_neg_prompt').querySelector('textarea')

    textarea.value = state.prompt
    negTextarea.value = state.negPrompt

    updateInput(textarea)
    updateInput(negTextarea)
    
    this.currentHistoryIndex = index
  }

  // undo/redoボタンの更新
  updateUndoRedoButtons() {
    const undoButton = gradioApp().querySelector(`#${EasyTemplateSelector.IDS.UNDO_BUTTON}`)
    const redoButton = gradioApp().querySelector(`#${EasyTemplateSelector.IDS.REDO_BUTTON}`)

    if (undoButton) {
      undoButton.disabled = this.currentHistoryIndex <= 0
    }
    if (redoButton) {
      redoButton.disabled = this.currentHistoryIndex >= this.textHistory.length - 1
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
