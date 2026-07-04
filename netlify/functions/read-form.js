// netlify/functions/read-form.js
// 근무행로 사진에서 "근무형태 약어"(예: 대온,온도대)를 AI로 읽어오는 서버 함수입니다.
// read-dia.js 와 같은 구조입니다. (같은 ANTHROPIC_API_KEY 환경변수, 같은 방식)
//
// ※ 만약 실행했을 때 오류가 나면, read-dia.js 파일을 열어서
//    아래 model 값과 anthropic-version 값이 똑같은지 비교해 맞춰주세요.

exports.handler = async (event) => {
  // 1) POST 요청만 받습니다.
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: JSON.stringify({ error: "POST 요청만 받아요." }) };
  }

  try {
    // 2) 앱이 보낸 사진(base64)과 형식을 꺼냅니다.
    const body = JSON.parse(event.body || "{}");
    const image = body.image;
    const mediaType = body.mediaType || "image/jpeg";
    if (!image) {
      return { statusCode: 400, body: JSON.stringify({ error: "이미지가 없어요." }) };
    }

    // 3) API 키 확인 (Netlify 환경변수)
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return { statusCode: 500, body: JSON.stringify({ error: "ANTHROPIC_API_KEY 환경변수가 설정되지 않았어요." }) };
    }

    // 4) AI에게 줄 지시문 (7호선 역 약어표 포함)
    const prompt = [
      "당신은 서울 지하철 7호선 승무 근무행로표를 읽는 전문가입니다.",
      "첨부한 근무행로 이미지를 보고, 그 다이아의 '근무형태 약어' 문자열을 만들어 주세요.",
      "",
      "역 이름 → 약어 대응표:",
      "도봉기지=도기, 장암=장, 도봉산=도, 수락산=수, 태릉입구=태, 어린이대공원=대,",
      "건대입구=건, 청담=청, 내방=내, 보라매=보, 신풍=신, 가산디지털단지=가,",
      "광명사거리=광, 천왕=천, 온수=온, 부평구청=부, 석남=석, 천왕기지=천기",
      "",
      "규칙:",
      "1) 이미지에 이미 '대온,온도대' 같은 약어 문자열이 인쇄돼 있으면, 그것을 그대로 옮겨 적으세요.",
      "2) 인쇄돼 있지 않으면, 각 열차 운행(열번)마다 출발역·회차역·도착역을 위 약어표로 이어 붙이세요.",
      "   예: 어린이대공원 출발 → 온수 도착 = '대온'",
      "3) 운행(열번)이 여러 개면 쉼표(,)로 구분하세요. 예: '대온,온도대'",
      "4) 약어만 쓰고, 시각(예: 06:51)이나 열번 숫자(예: 7074)는 넣지 마세요.",
      "5) 손님으로 타고 이동하는 '편승'이 있으면 그 구간 앞에 '편승'을 붙이세요. 예: '편승장대'",
      "",
      "반드시 아래 JSON 형식 하나로만 답하세요. 설명·인사·코드블록 표시(```)는 절대 넣지 마세요:",
      '{"form": "여기에 약어 문자열"}',
    ].join("\n");

    // 5) Anthropic API 호출 (read-dia.js 와 동일한 방식)
    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 1024,
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

    // 6) API 오류 처리
    if (data.error) {
      return { statusCode: 500, body: JSON.stringify({ error: (data.error && data.error.message) || "AI 호출 오류" }) };
    }

    // 7) AI 답변에서 글자 부분만 모아서 { text } 로 돌려줍니다.
    const text = (data.content || [])
      .filter((c) => c.type === "text")
      .map((c) => c.text)
      .join("");

    return { statusCode: 200, body: JSON.stringify({ text }) };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: String(e) }) };
  }
};
