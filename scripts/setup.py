from pathlib import Path
import os

import gradio as gr
from fastapi import FastAPI
import yaml
from modules import scripts, script_callbacks, shared

from scripts.upscaler_aliases import to_display, to_storage
from scripts.tag_profiles import (
    DEFAULT_PROFILE,
    list_profiles,
    resolve_tag_files,
    template_root,
    iter_template_files,
)

FILE_DIR = Path().absolute()
BASE_DIR = Path(scripts.basedir())
TEMP_DIR = FILE_DIR.joinpath('tmp')

TAGS_DIR = BASE_DIR.joinpath('tags')
TEMPLATE_DIR = BASE_DIR.joinpath('templates')

os.makedirs(TEMP_DIR, exist_ok=True)

# プロファイル名 → {stem: パース済み YAML}。load_tags() が構築する
tags = {}

def load_tags():
    global tags
    tags = {}

    for profile in list_profiles(TAGS_DIR):
        profile_tags = {}
        for stem, filepath in resolve_tag_files(TAGS_DIR, profile).items():
            with open(filepath, "r", encoding="utf-8") as file:
                profile_tags[stem] = yaml.safe_load(file)
        tags[profile] = profile_tags

    return tags

def get_tags(profile=DEFAULT_PROFILE):
    # 未知プロファイルはベースへフォールバック（生成を止めない）。
    # `or` で書くと空辞書（全カテゴリ除外）まで巻き込むため None 判定にする
    profile_tags = tags.get(profile)
    if profile_tags is None:
        profile_tags = tags.get(DEFAULT_PROFILE, {})
    return profile_tags

def available_upscaler_names():
    """現在の環境で Hires upscaler として選択できる名前の一覧

    取得に失敗しても致命的ではないため例外は投げず、取れた分だけ返す
    （両方失敗すれば空リストになり、呼び出し側は変換をスキップする）。
    片方の失敗でもう片方を巻き添えにしないよう個別に握る。
    """
    names = []
    try:
        names += list(shared.latent_upscale_modes)
    except Exception as e:
        print(f'[easy-template] latent upscale モードの取得に失敗しました: {e}')
    try:
        names += [x.name for x in shared.sd_upscalers]
    except Exception as e:
        print(f'[easy-template] upscaler 一覧の取得に失敗しました: {e}')
    return names

class EasyTemplateError(Exception):
    def __init__(self, message: str, status_code: int = 400):
        self.message = message
        self.status_code = status_code
        super().__init__(self.message)

def error_handler(error: EasyTemplateError) -> dict:
    return {"error": error.message}, error.status_code

def validated_profile(profile):
    """クエリ由来のプロファイル名を既知の値へ丸める。

    パス結合に使う値なので、実在するプロファイル以外は既定へ寄せる
    （tag_profiles 側の名前検証と二重の防御。読み取り系は 400 を返さず既定で応答する）。
    """
    if profile in list_profiles(TAGS_DIR):
        return profile
    print(f'[easy-template] 不明なプロファイル "{profile}" のため既定プロファイルで応答します')
    return DEFAULT_PROFILE

def api_networks(_: gr.Blocks, app: FastAPI):
    app.add_exception_handler(EasyTemplateError, error_handler)

    @app.get("/easy-template/profiles")
    async def get_profiles():
        return list_profiles(TAGS_DIR)

    @app.get("/easy-template/templates")
    async def get_templates(profile: str = DEFAULT_PROFILE):
        profile = validated_profile(profile)
        try:
            templates = {}
            upscaler_names = available_upscaler_names()
            unresolved_upscalers = set()
            root = template_root(TEMPLATE_DIR, profile)
            for filepath in iter_template_files(TEMPLATE_DIR, profile, list_profiles(TAGS_DIR)):
                # 相対パスを取得
                rel_path = filepath.relative_to(root)
                parts = rel_path.parts
                
                # 階層構造を作成
                current = templates
                for part in parts[:-1]:  # 最後のファイル名以外のパス部分
                    if part not in current:
                        current[part] = {}
                    current = current[part]
                
                # 最後のファイル名でテキストを保存
                with open(filepath, 'r', encoding='utf-8') as f:
                    content = f.read()

                try:
                    # Hires upscaler を実行環境で選択できる名前へ解決する
                    content, unresolved = to_display(content, upscaler_names)
                    unresolved_upscalers.update(unresolved)
                except Exception as e:
                    # 変換に失敗してもテンプレ自体は返す（読めなくなるより無変換のほうがマシ）
                    print(f'[easy-template] Hires upscaler の解決に失敗しました ({filepath.name}): {e}')

                current[filepath.stem] = content

            if unresolved_upscalers:
                # 未導入モデルや記述ミスに気付けるよう、リクエストごとに 1 行だけ出す
                names = ', '.join(sorted(unresolved_upscalers))
                print(f'[easy-template] 現在の環境に存在しない Hires upscaler: {names}')

            return templates
        except Exception as e:
            raise EasyTemplateError(f"テンプレートの取得に失敗しました: {str(e)}")

    # 関数名が module 関数 get_tags と衝突するため API 側は get_tags_api とする
    # （ルーティングはパスで決まるので改名の影響は無い）
    @app.get("/easy-template/tags")
    async def get_tags_api(profile: str = DEFAULT_PROFILE):
        profile = validated_profile(profile)
        try:
            tags = {}
            for stem, filepath in resolve_tag_files(TAGS_DIR, profile).items():
                with open(filepath, 'r', encoding='utf-8') as f:
                    tags[stem] = f.read()
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
        profile = request.get('profile') or DEFAULT_PROFILE

        if not filename or not content:
            raise EasyTemplateError("テンプレート名と内容が必要です", 400)
        if profile not in list_profiles(TAGS_DIR):
            raise EasyTemplateError(f"不明なプロファイルです: {profile}", 400)

        root = template_root(TEMPLATE_DIR, profile)
        try:
            # ファイル名からパスを生成して、プロファイルのテンプレルート内にあることを確認
            template_path = root.joinpath(filename)
            relative = template_path.resolve().relative_to(root.resolve())
            # 既定プロファイルのルートは templates/ 全体なので、上のチェックだけでは
            # templatename に他プロファイル名を含めて別プロファイルのツリーへ書き込めてしまう
            if relative.parts[0] in [p for p in list_profiles(TAGS_DIR) if p != DEFAULT_PROFILE]:
                raise ValueError('他プロファイルのディレクトリ')
        except Exception as e:
            raise EasyTemplateError("無効なテンプレート名です", 400)

        try:
            # Hires upscaler は環境非依存の正規形（ファイル名 stem）で保存する
            content = to_storage(content)
        except Exception as e:
            # 変換に失敗しても元の内容で保存する
            print(f'[easy-template] Hires upscaler の正規化に失敗しました: {e}')

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
