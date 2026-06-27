# ImageToolForLLM

[English](README.md) · **한국어**

> 화면을 캡처하고, 그 위에 영역을 라벨링한 뒤, 이미지와 구조화된 참조 정보를
> LLM 코딩 에이전트에게 함께 넘겨줍니다.

[![License: Apache-2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](./LICENSE)
![Status: early / work in progress](https://img.shields.io/badge/status-early%20%7C%20WIP-orange)

**제작: Humblebee — THE BETTER COMPANY AI.**

---

## ⚡ 빠른 설치

Claude Code 에서:

```bash
/plugin marketplace add chldbwnstm/imagetoolforllm
/plugin install imagetoolforllm@chldbwnstm-imagetoolforllm
```

Claude Code 를 재시작한 뒤 **`/imagetoolforllm:image`** 을 실행하세요. 브라우저 주석 도구가 열리고, 다음을 할 수 있습니다:

- **화면 캡처** — 모니터 하나 전체, 모든 모니터를 한 번에, 또는 특정 창(드롭다운에서 소스 선택). 원하는 만큼 다시 캡처할 수 있습니다.
- **라벨이 달린 영역 그리기** — 캡처 위에 상자를 드래그해 그리고, 각 상자에 번호 + 라벨 + 메모를 붙입니다.
- **확대 & 이동** — Ctrl + 스크롤로 확대, 드래그로 이동(크거나 멀티모니터 캡처에 유용).
- **이름 지정 & 저장 폴더 선택** — 내보낼 파일의 이름과 저장 위치를 정합니다.
- **LLM 으로 전송** — 주석이 달린 이미지(또는 단일 영역만)를 Claude Code 채팅으로 바로 보냅니다. 에이전트가 도착하는 캡처를 하나씩 설명합니다.
- **경로 복사** — 전송 대신 파일을 저장하고 경로를 복사합니다: 전체 이미지, 또는 선택한 영역만(한 번에 하나 또는 여러 개).

플랫폼 세부사항과 문제 해결은 아래에 있습니다.

---

## 문제

오늘날 LLM 코딩 에이전트(Claude Code, Cursor, Copilot 등)에 스크린샷을 넣으려면:
캡처 → 저장 → 파일 찾기 → 끌어다 넣거나 경로 붙여넣기 과정을 거칩니다. 그리고
넣고 나면 에이전트는 픽셀만 볼 뿐 — *저 상자*가 "메뉴" 버튼이고 *이 상자*가
"종료"라는 걸 전혀 알지 못합니다.

**ImageToolForLLM** 은 빠진 계층을 더합니다: **스크린샷 위에 영구적으로 남는,
라벨이 달린 영역 참조**. 덕분에 에이전트는 시각적 맥락*과* 구조화된 맥락을 한
번에 얻고 — 이미지를 다시 열 때마다 UI 의 각 부분이 무엇인지 다시 설명할 필요가
없습니다.

## 무엇이 다른가

기존 도구들([감사의 말](#acknowledgements--prior-art) 참고)은 *캡처 → 붙여넣기*
쪽을 해결합니다. ImageToolForLLM 은 그 위에 **라벨이 달린 영역 참조 계층**을 더합니다:

- 캡처 위에 상자를 그리고 각각에 라벨을 붙입니다(`1 = Menu`, `2 = Exit`, …).
- 번호가 매겨진 주석 이미지 **그리고** 구조화된 사이드카 파일을 함께 저장합니다.
- 사이드카는 편집 가능하고 영구적입니다 — 사용자와 에이전트가 함께 쓰는 공유 메모리입니다.
  나중에 이미지를 다시 열면 모든 영역이 그대로 돌아옵니다.

## 상태

🚧 **초기 단계지만, 핵심 루프는 처음부터 끝까지 동작합니다.** 솔직한 현황
(실제 하드웨어, Windows 에서 검증):

- ✅ **캡처** — 모니터, 특정 창, 그리고 **여러 모니터를 하나의 이미지로 이어붙이기**까지.
  작은 사전 빌드 네이티브 모듈로 처리하며 MCP 도구로 노출됩니다.
- ✅ **주석** — 브라우저 캔버스: 영역 상자를 그리고, 각각에 번호 + 라벨 + 메모,
  크거나 멀티모니터 캡처를 위한 **확대(Ctrl+휠)와 스크롤/이동**.
- ✅ **전달(Handoff)** — `<name>.annotated.png`(번호 상자가 새겨진 이미지) +
  `<name>.regions.json` 범례를 저장하고, `capture_and_annotate` 도구가 경로를 반환합니다.
- ✅ **Claude Code 통합** — 플러그인(스킬 + MCP 서버)으로 번들 제공.
- 🔜 **예정** — macOS/Linux 지원, 이미지 내 창 선택기 / `/annotate` 재열기,
  원커맨드 설치, 선택적 전역 단축키 헬퍼.

## 작동 방식

전체가 하나의 통합으로 제공됩니다(무거운 데스크톱 앱 없음). **캡처**는 작은
MCP 서버가 네이티브로 처리하고, **주석 UI**는 기존 브라우저에서 렌더링되는
로컬 웹 페이지입니다.

```
  내 LLM 코딩 에이전트에서
    │  /capture-region  ·  /capture-window  ·  /annotate <file>
    ▼
  MCP 서버 (Node)
    │  1. 네이티브 화면 / 창 캡처  (node-screenshots)
    │  2. 로컬 웹 서버 시작  →  브라우저에서 주석 도구 열기
    ▼
  브라우저 캔버스
    │  영역 상자 그리기 · 각각 번호 + 라벨 + 메모 · 자르기(crop)
    │  "전송"  →  주석 PNG + 영역 데이터 내보내기
    ▼
  MCP 서버
    │  3.  <name>.annotated.png  +  <name>.regions.json  기록
    │  4. 에이전트에게 경로 반환
    ▼
  에이전트가 둘 다 읽음 — 시각적 앵커 + 구조화된 범례를 함께.
```

### 전달 형식

같은 위치에 놓이는 두 개의 산출물:

- `<name>.annotated.png` — 번호 상자가 이미지에 새겨진 파일(시각적 앵커)
- `<name>.regions.json` — 범례: 좌표 + 라벨 + 메모(편집 가능, 영구)

사이드카 예시:

```json
{
  "schema": "imagetoolforllm/regions@1",
  "source": "window",
  "image": { "annotated": "login.annotated.png", "width": 960, "height": 600 },
  "bboxFormat": "xywh",
  "regions": [
    { "id": 1, "label": "Menu button", "note": "top-left hamburger", "bbox": [12, 8, 44, 44] },
    { "id": 2, "label": "Exit button", "note": "top-right X",        "bbox": [904, 8, 44, 44] }
  ]
}
```

> `bbox` 는 픽셀 단위 `[x, y, width, height]` 이며 원점은 좌측 상단입니다(`bboxFormat: "xywh"`).

## 설치 (원클릭 — 빌드 불필요)

Claude Code 에서 이 저장소를 플러그인 마켓플레이스로 추가하고 설치하세요:

```bash
/plugin marketplace add chldbwnstm/imagetoolforllm
/plugin install imagetoolforllm@chldbwnstm-imagetoolforllm
```

Claude Code 를 재시작하면 `capture_and_annotate` 도구와 `/imagetoolforllm:image`
명령이 준비됩니다. **`npm install` 도, 빌드도 필요 없습니다.** MCP 서버는 단일
자체 완결형 번들(`server/dist/index.js`, 의존성 인라인)로 제공되며, 네이티브
`node-screenshots` 사전 빌드 바이너리가 모든 데스크톱 플랫폼용으로 커밋되어 있습니다:

| OS | 창 드롭다운 | 비고 |
|----|-----------------|-------|
| **Windows** x64 | ✅ PrintWindow — 가려진 창도 캡처 | 바로 동작 |
| **macOS** arm64 / Intel x64 | ✅ CGWindowList | 첫 캡처 시: 터미널에 **화면 기록(Screen Recording)** 권한 부여(시스템 설정 → 개인정보 보호 및 보안 → 화면 기록) 후 재실행 |
| **Linux** x64 (glibc) | ✅ | 가능한 범위에서 지원 — X11 동작; Wayland 캡처는 제한될 수 있음 |

> 사전 번들 제외: Windows arm64, Linux musl / arm64. 해당 플랫폼에서는 MCP 서버가
> 시작되기 전에 맞는 `node-screenshots` 사전 빌드가 필요합니다.

<details>
<summary><b>Windows: "Failed to finalize marketplace cache / EBUSY: resource busy or locked"</b></summary>

이것은 일시적인 Windows 파일 잠금입니다(보통 캐시 단계에서 Microsoft Defender 가
갓 클론된 네이티브 바이너리를 검사하면서 발생). 캐시를 지우고 다시 시도해 해결하세요:

```powershell
Remove-Item -Recurse -Force "$env:USERPROFILE\.claude\plugins\marketplaces\chldbwnstm-imagetoolforllm" -ErrorAction SilentlyContinue
Remove-Item -Recurse -Force "$env:USERPROFILE\.claude\plugins\marketplaces\chldbwnstm-ImageToolForLLM" -ErrorAction SilentlyContinue
```

그런 다음 두 개의 `/plugin` 명령을 다시 실행하세요. 계속되면 다른 Claude Code
인스턴스를 모두 닫고 Defender 예외를 추가(관리자 PowerShell):
`Add-MpPreference -ExclusionPath "$env:USERPROFILE\.claude"` 한 뒤 다시 시도하세요.

</details>

### 로컬 클론에서 실행

작업 사본에서 바로 로드할 수도 있습니다:

```bash
claude --plugin-dir /abs/path/to/ImageToolForLLM
```

…또는 MCP 를 지원하는 아무 에이전트에나 MCP 서버만 등록할 수도 있습니다:

```json
{
  "mcpServers": {
    "imagetoolforllm": {
      "command": "node",
      "args": ["/absolute/path/to/ImageToolForLLM/server/dist/index.js"]
    }
  }
}
```

도구:
- **`capture_and_annotate`** — 핵심 도구. `monitor: "all" | "primary" | <id>`,
  또는 특정 창을 주석하려면 `window: <id>`(`list_windows` 에서 선택).
- **`reopen_annotation`** — 저장된 `*.annotated.png` / `*.regions.json` 을 다시 열어
  영역을 편집하고 같은 파일에 저장.
- `list_monitors`, `list_windows`, `capture_monitor`, `capture_window` — 기본 구성 요소.

번들된 `imagetool-format` 스킬이 에이전트에게 `annotated.png` + `regions.json`
쌍을 읽는 법을 가르칩니다.

## 지원 플랫폼

| 플랫폼          | 영역 캡처 | 창 캡처 | 비고 |
|-----------------|:--------------:|:--------------:|-------|
| Windows         | ✅ | ✅ | 주요 대상 |
| macOS           | ✅ | ✅ | 화면 기록 권한 필요; 배포용 서명 필요 |
| Linux (X11)     | ✅ | ✅ | |
| Linux (Wayland) | 🟡 | 🔴 | 캡처가 데스크톱 포털을 거침; 창별 캡처는 제한됨 |

## 로드맵

- [x] 네이티브 화면 + 창 캡처(MCP 도구)
- [x] 멀티모니터 캡처(이어붙이기)
- [x] 브라우저 영역 주석 도구 + `annotated.png` / `regions.json` 전달
- [x] 주석 도구 내 확대 + 스크롤/이동
- [x] 저장된 주석 다시 열기 & 편집
- [x] 형식을 읽는 법을 에이전트에게 가르치는 스킬
- [x] 플러그인 매니페스트(스킬 + MCP 서버)
- [x] 원클릭 설치 — 빌드 제로, 사전 빌드 네이티브 바이너리 커밋(Win / macOS / Linux x64)
- [ ] 브라우저 내 창 썸네일 선택기
- [x] macOS / Linux (X11) 지원 — 번들된 `node-screenshots` 로 창 드롭다운
- [ ] 선택적 전역 단축키 헬퍼
- [ ] 도구 비종속 내보내기(Cursor / Copilot / 모든 LLM)

---

## 프로젝트 상태 & 기대치

이것은 **개인이 최선을 다해 만드는 오픈소스 프로젝트**이며, 있는 그대로
제공됩니다. **SLA 없음, 지원 보장 없음, 이슈나 PR 에 특정 기한 내 응답한다는
약속도 없습니다.** 가능할 때 작업합니다. 그 점을 감안해 기대치를 잡아 주세요 —
제가 만들지 않는 기능이 필요하다면 자유롭게 포크하셔도 됩니다.

## 기여하기

기여는 환영합니다. 한 가지 중요한 사항이 있습니다:

> **기여자 라이선스 동의(CLA):** 기여를 제출하면 [`CLA.md`](./CLA.md) 의 조건에
> 동의하는 것입니다. 이는 프로젝트의 라이선스 선택지를 열어 두는 데(향후 코드를
> 다른 라이선스로 제공하는 것 포함) 필요한 권리를 메인테이너에게 부여합니다.
> 나중에 상용 에디션을 제공할 수 있는 프로젝트에서는 표준적인 절차입니다. CLA 가
> 부담스럽다면, 이슈와 토론을 여는 것은 언제든 환영합니다.

## 무료 코어 vs. Pro (오픈코어)

위에서 설명한 캡처 + 주석 + LLM 전달은 **Apache-2.0 하에 영원히 무료이며
오픈소스입니다.** 로컬에서 작업하는 개인에게는 이것이 제품의 전부입니다.

별도의 **선택적** Pro 에디션이 나중에 생길 수 있습니다. *팀* 단위로 가치가
커지거나 *대규모에서의 워크플로 마찰*을 줄이는 기능들 — 예: 기기 간 동기화,
팀 공유 주석 라이브러리, OCR 자동 라벨링, 주석 히스토리 등. Pro(출시된다면)는
별도 저장소에 둘 것입니다. **그 무엇도 코어 기능을 막지 않습니다.**

> 상태: Pro 는 **제공되지 않으며** 영영 나오지 않을 수도 있습니다. 처음부터
> 경계를 분명히 하려고 여기 적어 둘 뿐입니다.

## 라이선스

Apache License 2.0 — [`LICENSE`](./LICENSE) 참조.

ImageToolForLLM 은 캡처 위에 **라벨이 달린 영역 참조 계층**을 더한다는 점이 다릅니다.
