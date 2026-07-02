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
    // 화면에서 PDF 파일을 받아요
    const { pdf } = JSON.parse(event.body);

    // AI에게 시킬 말: 제목은 반복하지 말고, 알맹이(안건/결정)만 요약하라
    const prompt =
      "첨부한 PDF 문서의 '실제 내용'을 읽고, 자료실 검색과 요약에 쓸 정보를 만들어 주세요.\n" +
      "매우 중요한 규칙:\n" +
      "1) 파일 이름이 아니라 문서 안에 적힌 실제 내용(항목, 안건, 결정사항, 숫자, 날짜 등)을 근거로 만드세요.\n" +
      "2) 제목은 만들지 마세요.\n" +
      "3) description에는 문서 제목이나 '무슨무슨 의결서' 같은 문서 종류명을 반복해서 넣지 마세요. " +
      "제목만 봐서는 알 수 없는 '알맹이'(어떤 안건을 다뤘는지, 무엇을 결정했는지, 핵심 수치 등)만 한 문장(50자 이내)으로 요약하세요.\n" +
      "4) keywords는 문서 안에 실제로 등장하는 구체적인 안건명·항목명 4~6개를 쉼표로 구분해 넣으세요. " +
      "(예: 간이화장실 교체, 모기 훈증기 설치 등 — '산업안전보건위원회' 같은 일반적인 기구 이름은 넣지 마세요.)\n" +
      "5) 반드시 아래 JSON 형식으로만 답하고, 다른 말은 절대 쓰지 마세요.\n" +
      '{"description":"","keywords":""}';

    // AI(Claude)에게 PDF와 지시를 보내요 (열쇠는 창고에서 꺼내 씀)
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

    // AI 답을 화면에 돌려줘요
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
