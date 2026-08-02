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
    COMPLETION_POPUP: 'easy_template_selector_completion_popup',
    BATCH_PROGRESS: 'easy_template_selector_batch_progress',
    EDIT_CONTROLS: 'easy_template_selector_edit_controls',
    BATCH_CONTROLS: 'easy_template_selector_batch_controls',
    BATCH_RUN_BUTTON: 'easy_template_selector_batch_run_button',
    BATCH_STOP_BUTTON: 'easy_template_selector_batch_stop_button'
  }

  // 一括生成モードで選択中のテンプレボタンの見た目
  static BATCH_SELECTED_OUTLINE = '2px solid var(--color-accent, #ff7c00)'

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
      onConfirm: (textarea) => this.promptEditor.syncFromCaret(textarea),
    })
    this.templateManager.setPromptEditor(this.promptEditor)

    // 一括生成モードの状態。selection は「テンプレ名 → テンプレ本文」
    this.batchMode = false
    this.batchSelection = new Map()
    // 差し替えるタグの選択。「カテゴリ + ラベル → セクション文字列」
    this.batchSwapSelection = new Map()
    this.batchRunner = new ETSBatchRunner({
      promptEditor: this.promptEditor,
      templateManager: this.templateManager,
      onProgress: (text) => this.updateBatchProgress(text),
    })
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

    this.promptEditor.attachCaretSync()
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

      // 一括生成の実行中はプロンプト欄を競合して書き換えないよう、ヘッダー操作も無視する
      const reloadButton = ETSElementBuilder.reloadButton({
        onClick: this.guardBatchRunning(() => this.reload())
      })

      const undoButton = ETSElementBuilder.undoButton({
        onClick: this.guardBatchRunning(() => this.history.undoLastAction())
      })
      undoButton.id = EasyTemplateSelector.IDS.UNDO_BUTTON

      const redoButton = ETSElementBuilder.redoButton({
        onClick: this.guardBatchRunning(() => this.history.redoLastAction())
      })
      redoButton.id = EasyTemplateSelector.IDS.REDO_BUTTON

      const templateNameArea = ETSElementBuilder.textarea(EasyTemplateSelector.IDS.TEMPLATE_NAME, "テンプレート名", {
        onChange: () => {}
      })

      const saveButton = ETSElementBuilder.saveButton({
        onClick: this.guardBatchRunning(() => this.templateManager.saveTemplate())
      })

      const upButton = ETSElementBuilder.upButton({
        onClick: this.guardBatchRunning(
          () => this.promptEditor.moveTag(this.promptEditor.currentSection, -1))
      })

      const downButton = ETSElementBuilder.downButton({
        onClick: this.guardBatchRunning(
          () => this.promptEditor.moveTag(this.promptEditor.currentSection, +1))
      })

      const deleteButton = ETSElementBuilder.deleteButton({
        onClick: this.guardBatchRunning(
          () => this.promptEditor.removeTag(this.promptEditor.currentSection))
      })

      const tagInfoSelect = ETSElementBuilder.dropDown(EasyTemplateSelector.IDS.TAG_INFO, [], {
        onChange: this.guardBatchRunning((value) => {
          if (!value) return
          const selectedSection = this.promptEditor.parseSection(value)
          this.promptEditor.selectCurrent(selectedSection)
        })
      })
  
      // 一括生成モード中はまとめて隠すので、編集系はラッパーに入れておく
      const editControls = document.createElement('div')
      editControls.id = EasyTemplateSelector.IDS.EDIT_CONTROLS
      editControls.style.display = 'flex'
      editControls.style.alignItems = 'center'
      editControls.style.gap = '4px'
      editControls.appendChild(tagInfoSelect)
      editControls.appendChild(upButton)
      editControls.appendChild(downButton)
      editControls.appendChild(deleteButton)

      container.header.appendChild(reloadButton)
      container.header.appendChild(undoButton)
      container.header.appendChild(redoButton)
      container.header.appendChild(templateNameArea)
      container.header.appendChild(saveButton)
      container.header.appendChild(editControls)
      // ヘッダーは初回しか構築されないので、操作列も常設して表示だけ切り替える
      container.header.appendChild(this.renderBatchControls())
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
    this.syncBatchModeUi()

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
      onChange: this.guardBatchRunning((checked) => {
        this.templateManager.applyModel = checked
      })
    })
    buttons.append(applyModelCheckbox)

    // 一括生成モードのトグル。ON の間はテンプレ・タグのボタンが選択トグルになる。
    // 実行中に OFF にすると停止ボタンごと消えて止められなくなるのでガードする
    const batchModeCheckbox = ETSElementBuilder.checkbox('一括生成モード', this.batchMode, {
      onChange: this.guardBatchRunning((checked) => {
        this.batchMode = checked
        if (!checked) {
          this.batchSelection.clear()
          this.batchSwapSelection.clear()
        }
        this.render()
        // 操作列はヘッダーに常設で作り直されないため、前回の実行結果が残らないよう更新する
        this.updateBatchProgress(this.batchSelectionSummary())
      })
    })
    buttons.append(batchModeCheckbox)

    fields.append(buttons)

    return fields
  }

  // 一括生成の実行・停止・進捗の操作列。ヘッダーに常設し、表示は syncBatchModeUi() が切り替える
  renderBatchControls() {
    const controls = document.createElement('div')
    controls.id = EasyTemplateSelector.IDS.BATCH_CONTROLS
    controls.style.display = 'none'
    controls.style.alignItems = 'center'
    controls.style.gap = '4px'

    const runButton = ETSElementBuilder.baseButton('▶ 一括生成', { color: 'primary' })
    runButton.id = EasyTemplateSelector.IDS.BATCH_RUN_BUTTON
    runButton.addEventListener('click', this.guardBatchRunning(() => this.startBatch()))
    controls.appendChild(runButton)

    // 停止は実行中に押すボタンなのでガードしない
    const stopButton = ETSElementBuilder.baseButton('■ 停止', { color: 'secondary' })
    stopButton.id = EasyTemplateSelector.IDS.BATCH_STOP_BUTTON
    stopButton.addEventListener('click', () => {
      this.batchRunner.stop()
      this.syncBatchControls()
    })
    controls.appendChild(stopButton)

    const progress = document.createElement('span')
    progress.id = EasyTemplateSelector.IDS.BATCH_PROGRESS
    progress.style.alignSelf = 'center'
    progress.style.whiteSpace = 'nowrap'
    progress.textContent = this.batchSelectionSummary()
    controls.appendChild(progress)

    return controls
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
    // 実行中の無視判定はガードに任せるが、preventDefault はガードの外で必ず行う
    // （実行中でもブラウザ既定の挙動（右クリックメニュー等）は抑止したい）
    const onClick = this.guardBatchRunning((e) => {
      // 一括生成モード中のグループボタンは配下の全選択トグルにする
      if (this.isBatchGroupSelectable(tag, category)) {
        this.toggleBatchGroup(category)
        return
      }

      // 一括生成モード中のテンプレ・タグのボタンは適用せず選択をトグルする
      if (this.isBatchSelectable(tag, category)) {
        this.toggleBatchSelection(button, comment, tag, category)
        return
      }

      this.promptEditor.addTag(comment, tag, category, e.metaKey || e.ctrlKey)
    })
    const onRightClick = this.guardBatchRunning(() => {
      const targetSection = new ETSSection(comment, tag, category)
      this.promptEditor.removeTag(targetSection)
    })

    const button = ETSElementBuilder.tagButton({
      title: comment,
      value: tag,
      onClick: (e) => {
        e.preventDefault();
        onClick(e)
      },
      onRightClick: (e) => {
        e.preventDefault();
        onRightClick(e)
      },
      color
    })

    // 再描画時に選択状態の見た目を復元する
    if (this.isBatchSelectable(tag, category) && this.isBatchSelected({ comment, tag, category })) {
      button.style.outline = EasyTemplateSelector.BATCH_SELECTED_OUTLINE
    }

    return button
  }

  // 一括生成の実行中は競合操作を無視するようハンドラをラップする。
  // 実行中はプロンプト欄をバッチ側が書き換えるため、UI からの編集と競合する
  guardBatchRunning(handler) {
    return (...args) => {
      if (this.batchRunner.running) {
        return
      }
      handler(...args)
    }
  }

  // 一括生成モードで選択の対象になりうるカテゴリか（テンプレ本体 / 差し替え対象の帯）
  isBatchTargetCategory(category) {
    return this.isBatchTemplate(category) || ETSBatchRunner.bandOf(category) !== null
  }

  // 一括生成モード中に選択トグルの対象となるボタンか（テンプレ本体・差し替え対象のタグ）
  isBatchSelectable(tag, category) {
    return this.batchMode && !tag.startsWith('@') && this.isBatchTargetCategory(category)
  }

  // 一括生成モード中に配下の全選択トグルとして働くグループボタンか
  isBatchGroupSelectable(tag, category) {
    return this.batchMode && tag.startsWith('@') && this.isBatchTargetCategory(category)
  }

  // テンプレボタンの category ('00_テンプレート:01_SFW' 等) と comment からテンプレ名を組み立てる
  batchTemplateName(comment, category) {
    const categories = category.split(':')
    let name = ''
    for (let i = 1; i < categories.length; i++) {
      name += `${categories[i].trim()}/`
    }
    return name + comment
  }

  // 選択キー。同名ラベルが別カテゴリにあっても衝突しないようカテゴリを含める
  batchSelectionKey(comment, category) {
    return `${category}\n${comment}`
  }

  // テンプレの選択か（それ以外は差し替えるタグの選択）
  isBatchTemplate(category) {
    return category.startsWith('00_テンプレート')
  }

  // 選択済みか（setBatchSelected と同じリーフを受け取る。tag は使わない）
  isBatchSelected({ comment, category }) {
    if (this.isBatchTemplate(category)) {
      return this.batchSelection.has(this.batchTemplateName(comment, category))
    }
    return this.batchSwapSelection.has(this.batchSelectionKey(comment, category))
  }

  // 選択状態を設定する
  setBatchSelected({ comment, tag, category }, selected) {
    if (this.isBatchTemplate(category)) {
      const name = this.batchTemplateName(comment, category)
      selected ? this.batchSelection.set(name, tag) : this.batchSelection.delete(name)
      return
    }
    const key = this.batchSelectionKey(comment, category)
    if (selected) {
      this.batchSwapSelection.set(key, new ETSSection(comment, tag, category).toString())
    } else {
      this.batchSwapSelection.delete(key)
    }
  }

  // 進捗欄に出す選択件数
  batchSelectionSummary() {
    return `選択中: テンプレ ${this.batchSelection.size} 件 / タグ ${this.batchSwapSelection.size} 件`
  }

  // カテゴリパス（'00_テンプレート:01_SFW' 等）配下のリーフを再帰的に集める。
  // 単体テストのため this に依存させず static にしている
  static collectBatchLeaves(tags, category) {
    let node = tags
    for (const key of category.split(':')) {
      if (!node) {
        return []
      }
      node = node[key]
    }

    const leaves = []
    const walk = (values, path) => {
      if (Array.isArray(values)) {
        // 配列は renderTagButtons と同じくラベル = タグとして扱う
        values.forEach((tag) => leaves.push({ comment: tag, tag, category: path }))
        return
      }
      if (!values || typeof values !== 'object') {
        return
      }
      Object.entries(values).forEach(([key, value]) => {
        if (typeof value === 'string') {
          leaves.push({ comment: key, tag: value, category: path })
        } else {
          walk(value, `${path}:${key}`)
        }
      })
    }
    walk(node, category)
    return leaves
  }

  // グループ配下を再帰的に全選択／全解除する
  toggleBatchGroup(category) {
    const leaves = EasyTemplateSelector.collectBatchLeaves(this.tags, category)
    if (leaves.length === 0) {
      return
    }
    // 1 件でも未選択があれば全選択、すべて選択済みなら全解除
    const selectAll = !leaves.every((leaf) => this.isBatchSelected(leaf))
    leaves.forEach((leaf) => this.setBatchSelected(leaf, selectAll))
    // 枠線の復元は renderTagButton が行うので、まとめて描き直す
    this.render()
    // 操作列はヘッダーに常設で作り直されないため、件数表示は明示的に更新する
    this.updateBatchProgress(this.batchSelectionSummary())
  }

  // 一括生成対象の選択をトグルし、ボタンの見た目と件数表示を更新する
  toggleBatchSelection(button, comment, tag, category) {
    const leaf = { comment, tag, category }
    const selected = !this.isBatchSelected(leaf)
    this.setBatchSelected(leaf, selected)
    button.style.outline = selected ? EasyTemplateSelector.BATCH_SELECTED_OUTLINE : ''
    this.updateBatchProgress(this.batchSelectionSummary())
  }

  // 実行状態に応じて実行/停止ボタンを出し分ける（排他表示）
  syncBatchControls() {
    const running = this.batchRunner.running
    const runButton = gradioApp().getElementById(EasyTemplateSelector.IDS.BATCH_RUN_BUTTON)
    const stopButton = gradioApp().getElementById(EasyTemplateSelector.IDS.BATCH_STOP_BUTTON)
    if (runButton) {
      runButton.style.display = running ? 'none' : ''
    }
    if (stopButton) {
      stopButton.style.display = running ? '' : 'none'
    }
  }

  // 一括生成モードの ON/OFF でヘッダーとプロンプト欄の状態を切り替える。
  // ヘッダーは初回の render() でしか構築されないため、作り直しではなく表示の切り替えで行う
  syncBatchModeUi() {
    const editControls = gradioApp().getElementById(EasyTemplateSelector.IDS.EDIT_CONTROLS)
    if (editControls) {
      editControls.style.display = this.batchMode ? 'none' : 'flex'
    }
    const batchControls = gradioApp().getElementById(EasyTemplateSelector.IDS.BATCH_CONTROLS)
    if (batchControls) {
      batchControls.style.display = this.batchMode ? 'flex' : 'none'
    }
    // モード中の手編集はバッチ側の書き換えと競合するので読み取り専用にする
    this.setPromptsReadOnly(this.batchMode)
    this.syncBatchControls()
  }

  // ポジティブ・ネガティブのプロンプト欄を読み取り専用にする（テンプレ適用による書き換えは readOnly でも通る）
  setPromptsReadOnly(readOnly) {
    for (const id of ['txt2img_prompt', 'txt2img_neg_prompt']) {
      const textarea = gradioApp().getElementById(id)?.querySelector('textarea')
      if (!textarea) {
        continue
      }
      textarea.readOnly = readOnly
      textarea.style.opacity = readOnly ? '0.6' : ''
    }
  }

  // 進捗表示を更新する。進捗は実行の開始・終了に合わせて飛んでくるので、
  // ここで実行/停止ボタンの出し分けも同期する
  updateBatchProgress(text) {
    const progress = gradioApp().getElementById(EasyTemplateSelector.IDS.BATCH_PROGRESS)
    if (progress) {
      progress.textContent = text
    }
    this.syncBatchControls()
  }

  // 一括生成を開始する。実行順は選択順ではなく名前順（一覧の表示順に近い）
  async startBatch() {
    if (this.batchRunner.running) {
      return
    }
    if (this.batchSelection.size === 0) {
      this.updateBatchProgress('テンプレートが選択されていません')
      return
    }
    const items = Array.from(this.batchSelection, ([name, template]) => ({ name, template }))
      .sort((a, b) => a.name.localeCompare(b.name, 'ja'))
    try {
      await this.batchRunner.start(items, Array.from(this.batchSwapSelection.values()))
    } finally {
      this.syncBatchControls()
    }
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
