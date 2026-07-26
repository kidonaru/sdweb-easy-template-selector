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
    CONTAINER: 'easy_template_selector_container',
    COMPLETION_POPUP: 'easy_template_selector_completion_popup'
  }

  constructor(yaml, gradioApp) {
    this.yaml = yaml
    this.gradioApp = gradioApp
    this.visible = true
    this.replaceExisting = true
    this.tags = undefined
    this.currentTab = null
    this.history = new ETSHistory({ ids: EasyTemplateSelector.IDS })
    // this.tags は init() 完了後に再代入されるため、値ではなく getter を渡す
    this.templateManager = new ETSTemplateManager({
      ids: EasyTemplateSelector.IDS,
      history: this.history,
      getTags: () => this.tags,
      reinit: async () => await this.init(),
    })
    this.promptEditor = new ETSPromptEditor({
      ids: EasyTemplateSelector.IDS,
      history: this.history,
      templateManager: this.templateManager,
    })
    this.completion = new ETSCompletion({
      ids: EasyTemplateSelector.IDS,
      history: this.history,
    })
    this.templateManager.setPromptEditor(this.promptEditor)
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

    // Reload でタグが差し替わるのでインデックスを作り直す
    this.completion.setIndex(new ETSCompletionIndex(this.tags))

    gradioApp()
      .getElementById('txt2img_toprow')
      .after(this.render())

    this.completion.attach()
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
        onClick: () => this.templateManager.saveTemplate()
      })

      const upButton = ETSElementBuilder.upButton({
        onClick: () => this.promptEditor.moveTag(this.promptEditor.currentSection, -1)
      })

      const downButton = ETSElementBuilder.downButton({
        onClick: () => this.promptEditor.moveTag(this.promptEditor.currentSection, +1)
      })

      const deleteButton = ETSElementBuilder.deleteButton({
        onClick: () => this.promptEditor.removeTag(this.promptEditor.currentSection)
      })

      const tagInfoSelect = ETSElementBuilder.dropDown(EasyTemplateSelector.IDS.TAG_INFO, [], {
        onChange: (value) => {
          if (!value) return
          const selectedSection = this.promptEditor.parseSection(value)
          this.promptEditor.selectCurrent(selectedSection)
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

      // テンプレートタブの末尾に設定グループを表示
      if (key === '00_テンプレート') {
        fields.append(this.renderTemplateSettings())
      }

      content.appendChild(fields)
    })

    return content
  }

  // テンプレートタブ内の設定グループ（99_設定）を生成する
  renderTemplateSettings() {
    const fields = ETSElementBuilder.tagFields()
    fields.style.flexDirection = 'column'

    // 既存カテゴリと同じ見た目のヘッダーボタン（クリック動作は不要）
    const header = ETSElementBuilder.baseButton('99_設定', { color: 'primary' })
    header.style.cursor = 'default'
    fields.append(header)

    // テンプレート適用時にモデル（checkpoint）を切り替えるかのトグル
    const buttons = ETSElementBuilder.tagFields()
    buttons.id = 'buttons'
    const applyModelCheckbox = ETSElementBuilder.checkbox('モデル反映', this.templateManager.applyModel, {
      onChange: (checked) => {
        this.templateManager.applyModel = checked
      }
    })
    buttons.append(applyModelCheckbox)
    fields.append(buttons)

    return fields
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

        this.promptEditor.addTag(comment, tag, category, e.metaKey || e.ctrlKey)
      },
      onRightClick: (e) => {
        e.preventDefault();

        const targetSection = new ETSSection(comment, tag, category)
        this.promptEditor.removeTag(targetSection)
      },
      color
    })
  }

  // Util
  changeVisibility(node, visible) {
    node.style.display = visible ? 'flex' : 'none'
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
