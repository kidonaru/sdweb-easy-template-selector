// UI 用 DOM 要素（ボタン・ドロップダウン・テキストエリア等）の生成
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

  // 説明・補足の小さめテキスト。見た目は style.css の .easy_template_hint に持たせる
  static hintText(lines) {
    const container = document.createElement('div')
    container.classList.add('easy_template_hint')

    lines.forEach((line) => {
      const row = document.createElement('div')
      row.textContent = line
      container.appendChild(row)
    })

    return container
  }

  // Gradio の Svelte はハッシュ付きクラス名でスタイルを当てるため、既存要素から拾って同じものを付ける。
  // inputSelector は入力要素のタグ名（単一行なら 'input'、複数行なら 'textarea'）
  static applySvelteClasses(container, label, input, inputSelector) {
    const targets = [
      [container, '.gradio-textbox'],
      [label, '.gradio-textbox label'],
      [input, `.gradio-textbox ${inputSelector}`]
    ]

    targets.forEach(([element, selector]) => {
      const svelteClass = gradioApp().querySelector(selector)?.classList
        .toString()
        .match(/svelte-[a-z0-9]+/)?.[0]
      if (svelteClass) {
        element.classList.add(svelteClass)
      }
    })
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

    ETSElementBuilder.applySvelteClasses(container, label, input, 'input')

    input.addEventListener('input', () => {
      onChange(input.value)
    })

    label.appendChild(input)
    container.appendChild(label)

    return container
  }

  // 複数行入力用のテキストエリア。単一行の textarea() とは別物（あちらは <input type="text">）
  static multilineTextarea(id, placeholder, value, { onInput }) {
    const container = document.createElement('div')
    container.id = id
    container.classList.add('block', 'gradio-textbox', 'padded')
    container.style.borderStyle = 'solid'
    container.style.overflow = 'hidden'
    container.style.width = '100%'
    container.style.marginTop = '4px'
    container.style.borderWidth = 'var(--block-border-width)'

    const label = document.createElement('label')

    const input = document.createElement('textarea')
    input.setAttribute('data-testid', 'textbox')
    input.classList.add('scroll-hide')
    input.setAttribute('dir', 'ltr')
    input.rows = 2
    input.placeholder = placeholder
    input.value = value
    input.style.width = '100%'
    input.style.resize = 'vertical'

    ETSElementBuilder.applySvelteClasses(container, label, input, 'textarea')

    input.addEventListener('input', () => {
      onInput(input.value)
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

  // 補完候補のポップアップ本体
  static completionPopup(id) {
    const popup = document.createElement('div')
    popup.id = id
    popup.classList.add('easy_template_completion_popup')
    popup.style.display = 'none'

    return popup
  }

  // 補完候補の 1 行
  static completionItem(entry, selected, { onSelect, onHover }) {
    const item = document.createElement('div')
    item.classList.add('easy_template_completion_item')
    if (selected) {
      item.classList.add('selected')
    }

    const label = document.createElement('span')
    label.classList.add('easy_template_completion_label')
    label.textContent = `${entry.category} (${entry.comment})`

    const tag = document.createElement('span')
    tag.classList.add('easy_template_completion_tag')
    tag.textContent = entry.tag

    item.appendChild(label)
    item.appendChild(tag)

    // click だと先に textarea の blur が走ってポップアップが閉じるため mousedown を使う
    item.addEventListener('mousedown', (event) => {
      event.preventDefault()
      onSelect()
    })
    item.addEventListener('mouseenter', onHover)

    return item
  }
}
