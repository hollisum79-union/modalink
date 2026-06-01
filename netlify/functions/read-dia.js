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
      "이 이미지는 지하철 승무 다이아(운행) 시간표입니다. 아래쪽 표에서 데이터를 정확히 읽어주세요. " +
      "시간 값(인정근무·운전·대기·편승·감시·교육·준비·정리·심야)은 사진에 적힌 그대로 'HH:MM:SS' 문자열로 읽으세요. 절대 소수나 다른 단위로 바꾸지 마세요. 예: 03:33:40 은 \"03:33:40\" 그대로. " +
      "다이아번호(dia_no)는 정수, 주행키로(distance_km)는 숫자로 읽으세요. 출근시간(start_time)도 HH:MM:SS 문자열로 읽으세요. " +
      "반드시 아래 JSON 형식으로만 답하세요. 설명이나 다른 말은 절대 쓰지 마세요. 읽을 수 없는 값은 시간은 \"00:00:00\", 숫자는 0으로 두세요.\n" +
      '{"dia_no":0,"distance_km":0,"start_time":"00:00:00","work_hours":"00:00:00","drive_hours":"00:00:00","wait_hours":"00:00:00","ride_hours":"00:00:00","watch_hours":"00:00:00","edu_hours":"00:00:00","prep_hours":"00:00:00","clean_hours":"00:00:00","night_hours":"00:00:00"}';
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
