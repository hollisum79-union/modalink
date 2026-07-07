// netlify/functions/read-form.js  (개선판 v4)
// 근무행로 사진에서 "근무형태 약어"(예: 대온,온도대) + "열번 목록" + "열번별 출발-종착역"을 AI로 읽어옵니다.
// read-dia.js 와 같은 구조입니다. (같은 ANTHROPIC_API_KEY 환경변수)
//
// v4 개선점 (v3 기능은 그대로 유지):
//  - 열번마다 '출발역-종착역'(PAIRS)을 추가로 뽑음 → 홀짝 검산 재료
//  - JS 코드가 홀짝 규칙(지침 10번)으로 직접 판정 → AI가 읽은 열번이 방향과 안 맞으면 경고(warnings)만 붙임
//  - 열번(trains)은 절대 고치지 않음. 오직 warnings 배열만 추가로 돌려줌 (덮어쓰기 금지 원칙)
//  - 앱은 아직 warnings 를 안 써도 됨 → 올려도 기존 약어/열번 추출은 그대로 동작 (하위호환)
//
// ※ 오류가 나면 read-dia.js 를 열어 model 값과 anthropic-version 값을 똑같이 맞춰주세요.

// ── 역 순서표 (왼쪽 → 오른쪽, 지침 7번·10번). 숫자가 클수록 온수/석남 방면(하선 방향) ──
const STATIONS = {
  "도기": 0, "장": 1, "도": 2, "수": 3, "태": 4, "대": 5, "건": 6, "청": 7, "내": 8,
  "보": 9, "신": 10, "가": 11, "광": 12, "천": 13, "온": 14, "부": 15, "석": 16, "천기": 17,
};
const DEPOTS = ["도기", "천기"]; // 기지 = 출고/입고 판정용

// 열번 하나의 홀짝을 규칙으로 검산. 문제가 있으면 경고 문자열, 정상/판단불가면 null.
function checkParity(trainStr, startAb, endAb) {
  const sIdx = STATIONS[startAb];
  const eIdx = STATIONS[endAb];
  if (sIdx === undefined || eIdx === undefined) return null; // 모르는 역 → 검산 건너뜀
  const num = parseInt(trainStr, 10);
  if (!Number.isFinite(num)) return null;

  const lastDigit = num % 10;
  const actual = (lastDigit % 2 === 0) ? "짝수" : "홀수";

  // 출고/입고(기지)가 방향 홀짝보다 우선 (지침 10번)
  let expected, reason;
  if (DEPOTS.includes(startAb)) { expected = "홀수"; reason = "출고"; }
  else if (DEPOTS.includes(endAb)) { expected = "짝수"; reason = "입고"; }
  else if (eIdx > sIdx) { expected = "홀수"; reason = "하선"; }   // 장암 → 온수 방면
  else if (eIdx < sIdx) { expected = "짝수"; reason = "상선"; }   // 온수 → 장암 방면
  else return null; // 출발=종착 → 방향 판단 불가 → 건너뜀

  if (actual === expected) return null; // 정상
  return `열번 ${trainStr}: ${startAb}→${endAb}(${reason})이면 뒷자리 ${expected}여야 하는데 ${lastDigit}(${actual}) → 확인 필요`;
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: JSON.stringify({ error: "POST 요청만 받아요." }) };
  }

  try {
    const body = JSON.parse(event.body || "{}");
    const image = body.image;
    const mediaType = body.mediaType || "image/jpeg";
    if (!image) {
      return { statusCode: 400, body: JSON.stringify({ error: "이미지가 없어요." }) };
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return { statusCode: 500, body: JSON.stringify({ error: "ANTHROPIC_API_KEY 환경변수가 없어요." }) };
    }

    const prompt = [
      "당신은 서울 지하철 7호선 승무 근무행로표를 읽는 전문가입니다.",
      "이 이미지는 '선으로 그린 근무행로표'입니다. 동그라미 안에 열번(예: 7306, 1960)이 있고,",
      "그 열번에서 가로선이 왼쪽/오른쪽 역 칸까지 그어져 있습니다. 선의 양 끝이 닿는 역을 읽어야 합니다.",
      "",
      "◆ 역 칸은 왼쪽부터 오른쪽으로 이 순서입니다 (괄호는 약어):",
      "도봉기(도기) · 장암(장) · 도봉산(도) · 수락산(수) · 태릉입(태) · 어린이(대) · 건대입(건) ·",
      "청담(청) · 내방(내) · 보라매(보) · 신풍(신) · 가산디(가) · 광명사(광) · 천왕(천) ·",
      "온수(온) · 부평구(부) · 석남(석) · 천왕기(천기)",
      "",
      "◆ [약어] 만드는 법:",
      "1) 열번(동그라미)을 위에서 아래로 하나씩 봅니다.",
      "2) 각 열번의 가로선이 '어느 역 칸에서 시작해서 어느 역 칸까지 가는지' 봅니다.",
      "   그 열차가 지나는 주요 역(출발역, 회차역, 종착역)을 이동 순서대로 약어로 이어 붙입니다.",
      "   예) 어린이대공원에서 출발해 온수까지 = '대온'.  온수→도봉산→어린이 = '온도대'.",
      "3) 열번마다 만든 약어들을 쉼표(,)로 이어 붙입니다.",
      "4) 점선으로 그려지고 '편승'이라 적힌 구간은 앞에 '편승'을 붙입니다. 예: '편승장대'.",
      "5) 시각(06:51 등)과 열번 숫자(7306 등)는 약어에 넣지 않습니다.",
      "",
      "◆ 올바른 [약어] 결과 예시(형식 참고용):",
      "  대온,온도대,대장대",
      "  대신,신장대,대장대",
      "  대온,온대,대장,장온,온대",
      "  대도대,대도도기,장온,온대",
      "",
      "◆ [열번] 모으는 법:",
      "1) 동그라미 안의 열번 숫자(예: 7306, 1960)를 위에서 아래로 순서대로 모읍니다.",
      "2) 한 동그라미에 여러 열번이 쉼표로 같이 있으면(예: 7082,1712) 각각 따로 셉니다.",
      "3) 점선으로 그려지고 '편승'이라 적힌 열번은 제외합니다. (운전하는 열번만)",
      "4) 시각(06:51 등)이나 역 이름은 열번이 아닙니다. 넣지 마세요.",
      "",
      "◆ [열번-방향] 만드는 법 (검산용):",
      "1) 운전하는 열번마다, 그 열차가 '어느 역에서 출발해서 어느 역에 도착하는지'를",
      "   이동한 순서대로 출발역·종착역 딱 두 역만 약어로 적습니다.",
      "2) 형식은 '열번:출발-종착' 입니다. 예) 7306:대-온 (어린이대공원 출발, 온수 도착).",
      "3) 방향이 중요합니다. 대→온 이면 '대-온', 온→대 이면 '온-대' 로 적습니다.",
      "4) 여러 열번은 쉼표로 잇습니다. 예) 7306:대-온,1960:온-대",
      "5) 편승 열번은 여기에도 넣지 않습니다. 시각 숫자도 넣지 않습니다.",
      "",
      "◆ 답하는 방법:",
      "먼저 각 열번을 하나씩 짚으며 어느 역에서 어느 역까지 가는지 짧게 확인하세요.",
      "그리고 맨 마지막에, 아래 세 줄을 반드시 이 형식 그대로 쓰세요(다른 글자 없이):",
      "<<<FORM:여기에 약어 문자열>>>",
      "<<<TRAINS:여기에 열번들을 쉼표로>>>",
      "<<<PAIRS:여기에 열번:출발-종착 들을 쉼표로>>>",
      "예) <<<FORM:대온,온도대>>>",
      "    <<<TRAINS:7306,1960>>>",
      "    <<<PAIRS:7306:대-온,1960:온-대>>>",
    ].join("\n");

    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 2048,
        messages: [
          {
            role: "user",
            content: [
              { type: "image", source: { type: "base64", media_type: mediaType, data: image } },
              { type: "text", text: prompt },
            ],
          },
        ],
      }),
    });

    const data = await resp.json();
    if (data.error) {
      return { statusCode: 500, body: JSON.stringify({ error: (data.error && data.error.message) || "AI 호출 오류" }) };
    }

    // AI 답변 글자 모으기
    const raw = (data.content || [])
      .filter((c) => c.type === "text")
      .map((c) => c.text)
      .join("");

    // 맨 끝의 <<<FORM:...>>> 안에서 약어만 뽑기 (v2 그대로)
    let form = "";
    const m = raw.match(/<<<FORM:([\s\S]*?)>>>/);
    if (m) {
      form = m[1].trim();
    } else {
      // 혹시 형식을 안 지켰으면, 마지막 줄을 후보로 사용
      const lines = raw.split("\n").map((s) => s.trim()).filter(Boolean);
      form = lines.length ? lines[lines.length - 1] : "";
    }

    // <<<TRAINS:...>>> 안에서 열번 목록 뽑기 (v3 그대로)
    let trains = [];
    const t = raw.match(/<<<TRAINS:([\s\S]*?)>>>/);
    if (t) {
      trains = t[1]
        .split(",")
        .map((s) => s.trim())
        .filter((s) => /^\d+$/.test(s)); // 숫자만 남김
    }

    // <<<PAIRS:...>>> 안에서 열번별 출발-종착 뽑아 홀짝 검산 (v4 추가)
    // 열번(trains)은 절대 안 고침. 이상하면 warnings 에만 담음.
    let warnings = [];
    const p = raw.match(/<<<PAIRS:([\s\S]*?)>>>/);
    if (p) {
      const items = p[1].split(",").map((s) => s.trim()).filter(Boolean);
      for (const item of items) {
        const idx = item.indexOf(":");
        if (idx < 0) continue;
        const trainStr = item.slice(0, idx).trim();
        const route = item.slice(idx + 1).trim();
        const stops = route.split("-").map((s) => s.trim()).filter(Boolean);
        if (!/^\d+$/.test(trainStr) || stops.length < 2) continue;
        const w = checkParity(trainStr, stops[0], stops[stops.length - 1]);
        if (w) warnings.push(w);
      }
    }

    // 앱이 기대하는 형태 { text: '{"form":"...","trains":[...],"warnings":[...]}' } 로 돌려줌
    return {
      statusCode: 200,
      body: JSON.stringify({ text: JSON.stringify({ form: form, trains: trains, warnings: warnings }) }),
    };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: String(e) }) };
  }
};
