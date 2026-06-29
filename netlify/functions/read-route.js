exports.handler = async (event) => {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers, body: "" };
  }
  try {
    const { image, mediaType } = JSON.parse(event.body);
    const prompt =
      "이 이미지는 지하철 승무 '근무행로' 다이어그램입니다. 상단에는 각 열차(열번)가 선과 동그라미로 그려져 있고, 선의 양 끝에 시각이 적혀 있습니다. 하단에는 다이아 시간 표가 있습니다.\n\n" +
      "[열번별 행로 읽기 규칙]\n" +
      "1. 동그라미 안의 숫자가 열번(train_no)입니다. 예: 7045, 7096.\n" +
      "2. 각 열차 선의 양 끝에 적힌 두 시각을 읽으세요. 두 시각 중 '이른 시각'이 출발(start_time), '늦은 시각'이 도착(end_time)입니다. 선이 왼쪽/오른쪽 어디서 시작하든, 오직 시각의 빠르고 늦음으로만 출발·도착을 정하세요.\n" +
      "3. 시각은 사진에 적힌 그대로 'HHMMSS' 6자리 숫자 문자열로 읽으세요. 예: 07:57:40 → \"075740\". 콜론(:)은 빼고 숫자만.\n" +
      "4. 구간(section)은 읽기 어려우므로 항상 빈 문자열 \"\"로 두세요. (사람이 직접 입력합니다)\n" +
      "5. 위에서 아래 순서대로, 보이는 모든 열차를 배열에 담으세요.\n\n" +
      "[하단 다이아 표 읽기 규칙]\n" +
      "시간 값(인정근무·운전·대기·편승·감시·교육·준비·정리·심야)은 'HH:MM:SS' 문자열 그대로 읽으세요. 다이아번호는 정수, 주행키로는 숫자, 출근시간은 'HH:MM:SS'.\n\n" +
      "반드시 아래 JSON 형식으로만 답하세요. 설명이나 다른 말은 절대 쓰지 마세요. 읽을 수 없는 값은 시간은 \"00:00:00\", 숫자는 0, 열번 시각은 \"000000\"으로 두세요.\n" +
      '{"runs":[{"train_no":"0000","section":"","start_time":"000000","end_time":"000000"}],"dia":{"dia_no":0,"distance_km":0,"start_time":"00:00:00","work_hours":"00:00:00","drive_hours":"00:00:00","wait_hours":"00:00:00","ride_hours":"00:00:00","watch_hours":"00:00:00","edu_hours":"00:00:00","prep_hours":"00:00:00","clean_hours":"00:00:00","night_hours":"00:00:00"}}';
    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 2000,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "image",
                source: { type: "base64", media_type: mediaType, data: image },
              },
              { type: "text", text: prompt },
            ],
          },
        ],
      }),
    });
    const data = await resp.json();
    const text = (data.content || [])
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("");
    return { statusCode: 200, headers, body: JSON.stringify({ text }) };
  } catch (err) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: String(err) }),
    };
  }
};
