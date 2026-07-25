from pathlib import Path
import os

import gradio as gr
from fastapi import FastAPI
import yaml
from modules import scripts, script_callbacks, shared

FILE_DIR = Path().absolute()
BASE_DIR = Path(scripts.basedir())
TEMP_DIR = FILE_DIR.joinpath('tmp')

TAGS_DIR = BASE_DIR.joinpath('tags')
TEMPLATE_DIR = BASE_DIR.joinpath('templates')

os.makedirs(TEMP_DIR, exist_ok=True)

def tag_files():
    return TAGS_DIR.rglob("*.yml")

def template_files():
    return TEMPLATE_DIR.rglob("*.txt")

tags = {}

def load_tags():
    global tags
    tags = {}

    for filepath in tag_files():
        with open(filepath, "r", encoding="utf-8") as file:
            yml = yaml.safe_load(file)
            tags[filepath.stem] = yml

    return tags

def get_tags():
    return tags

class EasyTemplateError(Exception):
    def __init__(self, message: str, status_code: int = 400):
        self.message = message
        self.status_code = status_code
        super().__init__(self.message)

def error_handler(error: EasyTemplateError) -> dict:
    return {"error": error.message}, error.status_code

def api_networks(_: gr.Blocks, app: FastAPI):
    app.add_exception_handler(EasyTemplateError, error_handler)

    @app.get("/easy-template/templates")
    async def get_templates():
        try:
            templates = {}
            for filepath in template_files():
                # 相対パスを取得
                rel_path = filepath.relative_to(TEMPLATE_DIR)
                parts = rel_path.parts
                
                # 階層構造を作成
                current = templates
                for part in parts[:-1]:  # 最後のファイル名以外のパス部分
                    if part not in current:
                        current[part] = {}
                    current = current[part]
                
                # 最後のファイル名でテキストを保存
                with open(filepath, 'r', encoding='utf-8') as f:
                    current[filepath.stem] = f.read()
            
            return templates
        except Exception as e:
            raise EasyTemplateError(f"テンプレートの取得に失敗しました: {str(e)}")

    @app.get("/easy-template/tags")
    async def get_tags():
        try:
            tags = {}
            for filepath in tag_files():
                with open(filepath, 'r', encoding='utf-8') as f:
                    tags[filepath.stem] = f.read()
            return tags
        except Exception as e:
            raise EasyTemplateError(f"タグの取得に失敗しました: {str(e)}")

    @app.get("/easy-template/opts-infotext")
    async def get_opts_infotext():
        """infotext 名 → 現在の設定値のマップを返す。

        テンプレ保存時に Settings タブの DOM を読む代わりに使う。
        DOM は Settings タブが未描画だと取得できず不安定なため。
        対象は shared.opts.data_labels のうち infotext 名を持つ設定に限る
        （どの設定が infotext に出るかは本体側の定義に従い、拡張側では持たない）。

        注意: Model キーは Forge が管理する生の checkpoint 文字列で、
        JS 側の getCurrentModel() が返す加工済みの名前とは形式が異なる。
        Model をこの API 経由に移す場合は形式変換が必要。

        失敗しても致命的ではないため例外は投げず、空の dict を返す
        （JS 側は空 dict を受けて従来の DOM 読み取りへフォールバックする）。
        """
        try:
            result = {}
            for setting_name, info in shared.opts.data_labels.items():
                if not getattr(info, 'infotext', None):
                    continue
                result[info.infotext] = getattr(shared.opts, setting_name, None)
            return result
        except Exception as e:
            print(f'[easy-template] 設定値の取得に失敗しました: {e}')
            return {}

    @app.post("/easy-template/save-template")
    async def save_template(request: dict):
        filename = request.get('templatename')
        content = request.get('content')
        
        if not filename or not content:
            raise EasyTemplateError("テンプレート名と内容が必要です", 400)

        try:
            # ファイル名からパスを生成して、TEMPLATE_DIR内にあることを確認
            template_path = TEMPLATE_DIR.joinpath(filename)
            template_path.resolve().relative_to(TEMPLATE_DIR.resolve())
        except Exception as e:
            raise EasyTemplateError("無効なテンプレート名です", 400)

        try:
            # 親ディレクトリが存在しない場合は作成
            template_path.parent.mkdir(parents=True, exist_ok=True)

            with open(template_path, 'w', encoding='utf-8') as f:
                f.write(content)

            return {"status": "success"}
        except Exception as e:
            raise EasyTemplateError(f"テンプレートの保存に失敗しました: {str(e)}")

    @app.post("/easy-template/reload")
    async def reload(request: dict):
        load_tags()
        return {"status": "success"}


script_callbacks.on_app_started(api_networks)
