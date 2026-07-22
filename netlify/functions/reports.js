// 익명제보 서버 API (reports.js)
//
// [배경] 익명제보가 anon 키로 직접 읽고 쓰여서, 기술을 아는 사람이면 제보 전체를
//        통째로 뽑을 수 있었음. → 모든 접근을 이 함수(service_role)로만 하고
//        DB의 anon 권한은 끊는다.
//
// [규칙]
//  - 제보 작성(create)·내 제보 확인(check)은 누구나 — 단, check는 6자리 비밀번호가 맞아야만.
//  - 목록(list)·답변(reply)·읽음(markRead)·안읽음 수(unreadCount)는
//    사번을 받아 members.is_admin을 서버에서 직접 확인한 뒤에만 처리.
//    (화면의 is_admin 값은 위조 가능하므로 믿지 않는다)

const { createClient } = require("@supabase/supabase-js");

const supabase = createClient(
  "https://svbvawioldgundtpogkc.supabase.co",
  process.env.SUPABASE_SERVICE_ROLE || process.env.SUPABASE_SERVICE_KEY
);

const json = (code, body) => ({
  statusCode: code,
  headers: {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json; charset=utf-8",
  },
  body: JSON.stringify(body),
});

// 관리자 확인 — 사번으로 members.is_admin을 서버에서 직접 조회
async function isAdmin(emp) {
  if (!emp) return false;
  const { data } = await supabase
    .from("members")
    .select("is_admin")
    .eq("employee_number", String(emp))
    .maybeSingle();
  return !!(data && data.is_admin);
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return json(200, {});
  try {
    const body = JSON.parse(event.body || "{}");
    const action = body.action;

    // ── 제보 작성 (누구나 · 작성자 정보 없음 = 완전 익명) ──
    if (action === "create") {
      const { category, title, content, access_code } = body;
      if (!category || !title || !content || !access_code)
        return json(400, { error: "필수 항목 누락" });
      const { error } = await supabase.from("anonymous_reports").insert({
        category,
        title: String(title).trim(),
        content: String(content).trim(),
        access_code: String(access_code),
      });
      if (error) return json(500, { error: error.message });
      return json(200, { ok: true });
    }

    // ── 내 제보 + 답변 확인 (6자리 비밀번호가 맞아야만) ──
    if (action === "check") {
      const code = String(body.access_code || "").trim();
      if (!code) return json(400, { error: "비밀번호 누락" });
      const { data, error } = await supabase
        .from("anonymous_reports")
        .select("category, title, content, status, admin_reply, created_at")
        .eq("access_code", code)
        .maybeSingle();
      if (error) return json(500, { error: error.message });
      return json(200, { report: data || null });
    }

    // ── 여기부터는 관리자 전용 ──
    const admin = await isAdmin(body.employee_number);
    if (!admin) return json(403, { error: "관리자만 가능합니다" });

    if (action === "list") {
      const { data, error } = await supabase
        .from("anonymous_reports")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) return json(500, { error: error.message });
      return json(200, { reports: data || [] });
    }

    if (action === "reply") {
      const { id, reply } = body;
      if (!id) return json(400, { error: "id 누락" });
      const { error } = await supabase
        .from("anonymous_reports")
        .update({ admin_reply: reply || "", status: "답변완료" })
        .eq("id", id);
      if (error) return json(500, { error: error.message });
      return json(200, { ok: true });
    }

    if (action === "markRead") {
      const { error } = await supabase
        .from("anonymous_reports")
        .update({ admin_read: true })
        .eq("admin_read", false);
      if (error) return json(500, { error: error.message });
      return json(200, { ok: true });
    }

    if (action === "unreadCount") {
      const { count, error } = await supabase
        .from("anonymous_reports")
        .select("id", { count: "exact", head: true })
        .eq("admin_read", false);
      if (error) return json(500, { error: error.message });
      return json(200, { count: count || 0 });
    }

    return json(400, { error: "알 수 없는 action" });
  } catch (e) {
    return json(500, { error: String(e) });
  }
};
