#!/usr/bin/env python3
"""기획서 끝의 '부록 A · 저장소 전체 원문'을 지금 저장소 내용으로 다시 만든다.

사용법 (mac-app 폴더에서): python3 scripts/spec-appendix.py
- git에 올라간 모든 파일(기획서 자신은 빼고)을 경로 순서대로, 글자 하나 바꾸지 않고 코드 블록으로 붙인다.
- 기획서에서 '## 부록 A' 아래는 매번 통째로 새로 쓴다(그 위 본문은 건드리지 않는다).
"""
import os
import subprocess
import sys

DOC = "docs/가상회사 프로젝트 기획서 (맥 앱판).md"
MARK = "## 부록 A · 저장소 전체 원문"

LANG = {
    ".swift": "swift", ".sh": "bash", ".py": "python", ".plist": "xml",
    ".md": "markdown", ".txt": "text", ".example": "bash",
}


def fence_for(text: str) -> str:
    """파일 안에 있는 가장 긴 백틱 줄보다 하나 더 긴 울타리를 쓴다(원문 안의 ``` 때문에 블록이 깨지지 않게)."""
    longest, run = 0, 0
    for ch in text:
        run = run + 1 if ch == "`" else 0
        longest = max(longest, run)
    return "`" * max(3, longest + 1)


def main() -> None:
    root = subprocess.check_output(["git", "rev-parse", "--show-toplevel"], text=True).strip()
    os.chdir(root)
    names = subprocess.check_output(["git", "ls-files", "-z"]).decode("utf-8").split("\0")
    files = sorted(n for n in names if n and n != DOC)

    doc = open(DOC, encoding="utf-8").read()
    head = doc.split(MARK)[0].rstrip() + "\n\n"

    parts = [MARK, "",
             "> 아래는 이 저장소의 모든 파일이다(이 기획서 자신만 뺐다). 경로 그대로 폴더를 만들고 각 블록의 내용을 "
             "**글자 하나 바꾸지 않고** 파일로 저장하면 지금 앱과 같은 앱이 된다. 본문과 부록이 다르면 부록이 맞다. "
             "부록은 `python3 scripts/spec-appendix.py`로 다시 만든다.",
             "", f"파일 {len(files)}개:", ""]
    parts += [f"{i + 1}. `{name}`" for i, name in enumerate(files)]
    parts.append("")
    for name in files:
        data = open(name, "rb").read()
        try:
            text = data.decode("utf-8")
        except UnicodeDecodeError:
            sys.exit(f"글자 파일이 아닙니다: {name}")
        ext = os.path.splitext(name)[1] or os.path.basename(name)
        fence = fence_for(text)
        lines = text.count("\n") + (0 if text.endswith("\n") or not text else 1)
        parts += [f"### `{name}`", "", f"{lines}줄", "", f"{fence}{LANG.get(ext, '')}", text.rstrip("\n"), fence, ""]

    open(DOC, "w", encoding="utf-8").write(head + "\n".join(parts))
    print(f"부록 A: 파일 {len(files)}개를 붙였습니다 → {DOC}")


if __name__ == "__main__":
    main()
