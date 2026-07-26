// netlify/functions/my-pay.js
// ── RLS 3탄: monthly_pay 서버 경유 ──
//   왜: anon 키로 전 조합원 실수령액을 읽고 쓸 수 있던 것을 차단.
//   어떻게: 기기 토큰(device_sessions) → 사번을 서버에서 역추적 → "본인 것만" 저장·조회.
//   클라이언트는 사번을 보내지 않는다 — 토큰이 곧 신분증 (사번 위조 원천 차단).
//   배포 후 SQL로 monthly_pay의 anon 정책을 전부 삭제하면 이 함수가 유일한 통로가 된다.
const { createClient } = require("@supabase/supabase-js");

const SUPABASE_URL = process.env.SUPABASE_URL || "https://svbvawioldgundtpogkc.supabase.co";

function resp(code, obj) {
  return {
    statusCode: code,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(obj),
  };
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return resp(405, { result: "method_not_allowed" });

  let body;
  try {
    body = JSON.parse(event.body || "{}");
  } catch (e) {
    return resp(400, { result: "bad_request" });
  }

  const token = String(body.token || "");
  if (!token) return resp(401, { result: "no_token" });

  const supabase = createClient(SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE);

  // 기기 토큰 → 사번 (본인 확인의 전부 — 토큰 없이는 아무것도 못 함)
  const { data: sess, error: sessErr } = await supabase
    .from("device_sessions")
    .select("employee_number")
    .eq("token", token)
    .maybeSingle();
  if (sessErr || !sess) return resp(401, { result: "invalid_token" });
  const emp = String(sess.employee_number);

  if (body.action === "save_and_prev") {
    const ym = String(body.year_month || "");
    const pym = String(body.prev_year_month || "");
    if (!/^\d{4}-\d{2}$/.test(ym) || !/^\d{4}-\d{2}$/.test(pym)) {
      return resp(400, { result: "bad_month" });
    }
    const net = Math.round(Number(body.net_pay) || 0);
    const gross = Math.round(Number(body.gross_pay) || 0);

    // 이번 달 예상치 저장 (본인 사번 강제 — body의 사번은 아예 안 받음)
    const { error: upErr } = await supabase
      .from("monthly_pay")
      .upsert(
        { employee_number: emp, year_month: ym, net_pay: net, gross_pay: gross },
        { onConflict: "employee_number,year_month" }
      );
    if (upErr) return resp(500, { result: "save_failed" });

    // 전월 대비용 조회 (본인 것만)
    const { data: prev } = await supabase
      .from("monthly_pay")
      .select("net_pay, gross_pay")
      .eq("employee_number", emp)
      .eq("year_month", pym)
      .maybeSingle();

    return resp(200, { result: "ok", prev: prev || null });
  }

  return resp(400, { result: "unknown_action" });
};
