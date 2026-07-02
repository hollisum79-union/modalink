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
    // ① 화면에서 PDF 파일을 받아요 (식단표는 image였지만, 여기선 pdf)
    const { pdf } = JSON.parse(event.body);

    // ② AI에게 시킬 말: 이 문서를 읽고 제목/설명/검색어를 뽑아달라
    const prompt =
      "이것은 노동조합에서 조합원에게 공유하는 자료(PDF 문서)입니다. " +
      "문서를 읽고, 자료실에 등록할 때 쓸 정보를 만들어 주세요. " +
      "반드시 아래 JSON 형식으로만 답하세요. 설명이나 다른 말은 절대 쓰지 마세요.\n" +
      '- title: 문서 제목을 20자 이내로 간결하게\n' +
      '- description: 이 문서가 어떤 내용인지 한두 문장(50자 이내)으로 요약\n' +
      '- keywords: 나중에 검색할 때 쓸 핵심 단어 3~5개를 쉼표로 구분\n' +
      '{"title":"","description":"","keywords":""}';

    // ③ AI(Claude)에게 PDF와 지시를 보내요 (열쇠는 창고에서 꺼내 씀)
    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 1000,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "document",
                source: { type: "base64", media_type: "application/pdf", data: pdf },
              },
              { type: "text", text: prompt },
            ],
          },
        ],
      }),
    });

    // ④ AI 답을 화면에 돌려줘요
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
