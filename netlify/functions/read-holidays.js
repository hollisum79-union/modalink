// 한국천문연구원 특일정보 API - 그 해 공휴일+국경일 날짜 목록 반환
//
// [2026-07 수정] 예전에는 2개 API × 12개월 = 24번을 하나씩 순서대로(await) 불러서
//   Netlify 함수 10초 제한에 걸려 죽었음 → 앱은 공휴일 0개를 받아 주말만 빨갛게 표시됐음.
//   이제 ① 연 단위로 2번만 부르고(numOfRows=100) ② 모자라면 월별 24번을 "한꺼번에"(병렬) 보충.
//   결과(날짜 목록)를 만드는 규칙은 예전과 동일 — 급여 계산에 영향 없음.

const _cache = new Map(); // 함수가 깨어있는 동안 같은 해는 재사용

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

    if (_cache.has(year)) {
      return {
        statusCode: 200,
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ year, holidays: _cache.get(year), cached: true }),
      };
    }

    const key = process.env.HOLIDAY_API_KEY;
    if (!key) {
      return {
        statusCode: 200,
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ year, holidays: [], error: "HOLIDAY_API_KEY 없음" }),
      };
    }

    const base = "https://apis.data.go.kr/B090041/openapi/service/SpcdeInfoService";
    const ops = ["getRestDeInfo", "getHoliDeInfo"];

    // 한 번 부르기 (6초 넘으면 포기 — 전체가 10초에 죽지 않게)
    let failCount = 0; // 하나라도 실패하면 "반쪽 목록"일 수 있으니 캐시하지 않음
    const grab = async (url) => {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 6000);
      try {
        const resp = await fetch(url, { signal: ctrl.signal });
        return await resp.text();
      } catch (e) {
        failCount++;
        return "";
      } finally {
        clearTimeout(timer);
      }
    };

    // 예전과 동일한 규칙: locdate를 전부 담는다
    const collect = (xml, set) => {
      const re = /<locdate>(\d{8})<\/locdate>/g;
      let m;
      while ((m = re.exec(xml)) !== null) {
        const d = m[1];
        set.add(d.slice(0, 4) + "-" + d.slice(4, 6) + "-" + d.slice(6, 8));
      }
    };

    const dates = new Set();
    let via = "year";

    // ① 연 단위 2번 (동시에) — numOfRows=100 필수 (기본값 10이라 안 넣으면 잘림)
    const yearXmls = await Promise.all(
      ops.map((op) => grab(`${base}/${op}?serviceKey=${key}&solYear=${year}&numOfRows=100`))
    );
    yearXmls.forEach((x) => collect(x, dates));

    // ② 너무 적으면 월별로 보충 — 24번을 "한꺼번에" (순서대로가 아니라)
    if (dates.size < 5) {
      via = "month";
      const urls = [];
      for (const op of ops) {
        for (let mon = 1; mon <= 12; mon++) {
          const mm = String(mon).padStart(2, "0");
          urls.push(`${base}/${op}?serviceKey=${key}&solYear=${year}&solMonth=${mm}&numOfRows=50`);
        }
      }
      const xmls = await Promise.all(urls.map(grab));
      xmls.forEach((x) => collect(x, dates));
    }

    const list = Array.from(dates).sort();
    // 전부 성공했고 개수가 정상일 때만 캐시 (반쪽 목록이 함수에 눌러앉는 것 방지)
    if (failCount === 0 && list.length >= 10) _cache.set(year, list);

    return {
      statusCode: 200,
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ year, holidays: list, count: list.length, via }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ error: String(err) }),
    };
  }
};
