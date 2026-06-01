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
      "이 이미지는 지하철 승무 다이아(운행) 시간표입니다. 아래쪽 표에서 숫자 데이터를 읽어주세요. " +
      "시간 값은 '08:56:00' 같은 형식이면 시간 단위 소수로 변환하세요 (예: 08:56:00 → 8.93, 03:24:20 → 3.41). " +
      "반드시 아래 JSON 형식으로만 답하세요. 설명이나 다른 말은 절대 쓰지 마세요. " +
      "읽을 수 없는 값은 0으로 두세요.\n" +
      '{"dia_no":0,"distance_km":0,"start_time":"","work_hours":0,"drive_hours":0,"wait_hours":0,"ride_hours":0,"watch_hours":0,"edu_hours":0,"prep_hours":0,"clean_hours":0,"night_hours":0}';
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
