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
      "이 이미지는 식당 주간 식단표입니다. 월요일부터 일요일까지 각 요일의 아침, 점심, 저녁 메뉴를 읽어주세요. " +
      "반드시 아래 JSON 형식으로만 답하세요. 설명이나 다른 말은 절대 쓰지 마세요. " +
      '날짜를 알 수 있으면 date에 "6/2" 형식으로, 모르면 빈 문자열로 두세요. ' +
      '메뉴가 없는 칸은 빈 문자열로 두세요.\n' +
      '{"days":[{"day":"월","date":"","breakfast":"","lunch":"","dinner":""},{"day":"화","date":"","breakfast":"","lunch":"","dinner":""},{"day":"수","date":"","breakfast":"","lunch":"","dinner":""},{"day":"목","date":"","breakfast":"","lunch":"","dinner":""},{"day":"금","date":"","breakfast":"","lunch":"","dinner":""},{"day":"토","date":"","breakfast":"","lunch":"","dinner":""},{"day":"일","date":"","breakfast":"","lunch":"","dinner":""}]}';

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
