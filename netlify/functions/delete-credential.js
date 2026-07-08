// netlify/functions/delete-credential.js
// 조합원 로그인 계정(member_auth) 삭제용. service_role 전용.
// 방출/탈퇴/조합원 해제 시 이 함수를 불러 로그인을 차단한다.
//
// ⚠️ 환경변수 이름은 기존 set-credential.js 와 똑같아야 합니다.
//    (set-credential.js 를 열어서 SUPABASE_URL / 서비스키 변수명을 확인해 맞춰주세요.)
//    아래는 흔한 두 가지 이름을 모두 지원합니다.

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      body: JSON.stringify({ result: "method_not_allowed" }),
    };
  }

  try {
    const { employee_number } = JSON.parse(event.body || "{}");
    if (!employee_number) {
      return {
        statusCode: 400,
        body: JSON.stringify({ result: "no_employee_number" }),
      };
    }

    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SERVICE_KEY =
      process.env.SUPABASE_SERVICE_ROLE_KEY ||
      process.env.SUPABASE_SERVICE_KEY;

    if (!SUPABASE_URL || !SERVICE_KEY) {
      return { statusCode: 500, body: JSON.stringify({ result: "env_missing" }) };
    }

    const url =
      `${SUPABASE_URL}/rest/v1/member_auth?employee_number=eq.` +
      encodeURIComponent(String(employee_number));

    const res = await fetch(url, {
      method: "DELETE",
      headers: {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
    });

    if (!res.ok) {
      const detail = await res.text();
      return {
        statusCode: 500,
        body: JSON.stringify({ result: "error", detail }),
      };
    }

    // 계정이 없어도(이미 삭제/미가입) 성공으로 처리 — 멱등
    return { statusCode: 200, body: JSON.stringify({ result: "ok" }) };
  } catch (e) {
    return {
      statusCode: 500,
      body: JSON.stringify({
        result: "error",
        detail: String((e && e.message) || e),
      }),
    };
  }
};
