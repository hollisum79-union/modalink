// 한국천문연구원 특일정보 API - 그 해 공휴일+국경일 날짜 목록 반환
exports.handler = async (event) => {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS, GET",
  };
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers, body: "" };
  }
  try {
    let year = new Date().getFullYear();
    if (event.body) {
      try { const b = JSON.parse(event.body); if (b.year) year = b.year; } catch (e) {}
    }
    if (event.queryStringParameters && event.queryStringParameters.year) {
      year = Number(event.queryStringParameters.year);
    }

    const key = process.env.HOLIDAY_API_KEY;
    const base = "https://apis.data.go.kr/B090041/openapi/service/SpcdeInfoService";
    const dates = new Set();

    const ops = ["getRestDeInfo", "getHoliDeInfo"];
    for (const op of ops) {
      for (let mon = 1; mon <= 12; mon++) {
        const mm = String(mon).padStart(2, "0");
        const url = `${base}/${op}?serviceKey=${key}&solYear=${year}&solMonth=${mm}&numOfRows=50`;
        const resp = await fetch(url);
        const xml = await resp.text();
        const re = /<locdate>(\d{8})<\/locdate>/g;
        let m;
        while ((m = re.exec(xml)) !== null) {
          const d = m[1];
          dates.add(d.slice(0, 4) + "-" + d.slice(4, 6) + "-" + d.slice(6, 8));
        }
      }
    }

    const list = Array.from(dates).sort();
    return {
      statusCode: 200,
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ year, holidays: list }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ error: String(err) }),
    };
  }
};
