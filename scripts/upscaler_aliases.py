# Hires upscaler 名の環境差を吸収する変換テーブルとヘルパー
#
# 同じモデルでも reForge / A1111 は組み込みの表示名を持つが、Forge Neo は
# ファイル名の stem をそのまま表示名にする。テンプレート上はファイル名の
# stem を正規形とし、読み込み時に実行環境の表示名へ解決する。
#
# WebUI に依存しない純粋なモジュールに保つこと（単体で import して検証するため）。
import re

# 正規形（モデルファイルの stem） -> reForge / A1111 での表示名
#
# 出典は A1111 の modules/realesrgan_model.py の get_realesrgan_models()。
# 同関数が RealESRGAN 系の各モデルに固有の表示名を割り当てており、reForge も
# これを引き継いでいる。Forge Neo にはこの割り当てが無く stem がそのまま
# 表示名になる。
#
# ここに載せるのは reForge / A1111 側にだけ存在する別名に限る。ユーザーが
# 自分で導入したモデルは両環境とも stem が表示名になるため記載不要。
# 実機で確認していない別名は載せないこと（誤変換は素通しより状況が悪い）。
# SwinIR / ScuNET / DAT 系は表示名が未確認のため対象外。
UPSCALER_ALIASES = {
    'RealESRGAN_x4plus': 'R-ESRGAN 4x+',
    'RealESRGAN_x4plus_anime_6B': 'R-ESRGAN 4x+ Anime6B',
    'RealESRGAN_x2plus': 'R-ESRGAN 2x+',
    'realesr-general-x4v3': 'R-ESRGAN General 4xV3',
    'realesr-general-wdn-x4v3': 'R-ESRGAN General WDN 4xV3',
    'realesr-animevideov3': 'R-ESRGAN AnimeVideo',
}

# 別名 -> 正規形の逆引き
_ALIAS_TO_CANONICAL = {alias: canonical for canonical, alias in UPSCALER_ALIASES.items()}

# パラメータ行の "Hires upscaler: <値>" を捉える。
# 値から \r を除外するのは、CRLF 改行のテンプレで値が行末（末尾カンマ無し）に
# 来たときに CRLF を LF へ壊さないため。キーと値の間を [ \t]* に限定するのは、
# \s* だと改行を跨いで次の行を値として拾いうるため。
_UPSCALER_PATTERN = re.compile(r'(Hires upscaler:[ \t]*)([^,\r\n]+)')


def to_canonical(value):
    """別名なら正規形（stem）へ、表に無ければそのまま返す"""
    return _ALIAS_TO_CANONICAL.get(value, value)


def candidates_for(value):
    """value が属するグループ（正規形 + 別名）を返す。表に無ければ [value]"""
    canonical = to_canonical(value)
    alias = UPSCALER_ALIASES.get(canonical)
    if alias is None:
        return [value]
    return [canonical, alias]


def _replace(text, resolver):
    """Hires upscaler の値だけを resolver の戻り値で置換する

    ファイル全文を対象にする。プロンプト本文に "Hires upscaler:" が現れることは
    実質無いため、パラメータ行を判別するロジックは持たない。
    """
    return _UPSCALER_PATTERN.sub(
        lambda match: match.group(1) + resolver(match.group(2).strip()),
        text,
    )


def to_storage(text):
    """保存用: Hires upscaler を常に正規形（stem）にする。実行環境に依存しない"""
    return _replace(text, to_canonical)


def to_display(text, available_names):
    """読み込み用: Hires upscaler を実行環境で選択できる名前に解決する

    戻り値は (変換後テキスト, 解決できなかった値のリスト)。
    警告の出力は呼び出し側に任せる。1 リクエストで全テンプレートを処理するため、
    ここで print するとコンソールが流れるため。

    available_names が空のときは解決材料が無いので素通しする。
    """
    if not available_names:
        return text, []

    available = set(available_names)
    unresolved = []

    def resolve(value):
        if value in available:
            return value
        for candidate in candidates_for(value):
            if candidate in available:
                return candidate
        unresolved.append(value)
        return value

    return _replace(text, resolve), unresolved
