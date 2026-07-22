// テンプレートの適用・保存とメタ情報（モデル・解像度等）の読み書き
class ETSTemplateManager {
  constructor({ ids, history, getTags, reinit }) {
    this.ids = ids
    this.history = history
    this.getTags = getTags
    this.reinit = reinit
    this.promptEditor = null

    // テンプレート適用時にモデル（checkpoint）を切り替えるか（セッション限り、永続化しない）
    this.applyModel = true

    this.metaInfoMap = [
      { key: 'Template name', id: ids.TEMPLATE_NAME, type: 'input' },
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

  // 循環参照回避のため生成後に注入する
  setPromptEditor(promptEditor) {
    this.promptEditor = promptEditor
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

    const imageInfo = gradioApp().getElementById(this.ids.IMAGE_INFO).querySelector('textarea')
    const applyButton = gradioApp().getElementById(this.ids.APPLY_BUTTON)

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
    if (this.applyModel && modelName != this.getCurrentModel()) {
      setTimeout(() => {
        console.log('selectCheckpoint', modelName)
        selectCheckpoint(modelName)
      }, 100)
    }

    this.promptEditor.selectNone()
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
    let currentLevel = this.getTags()['00_テンプレート']
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
      await this.reinit()
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
}
