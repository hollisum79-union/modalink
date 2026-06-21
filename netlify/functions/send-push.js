const webpush = require("web-push");
const { createClient } = require("@supabase/supabase-js");

webpush.setVapidDetails(
  process.env.VAPID_SUBJECT,
  process.env.VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY
);

const supabase = createClient(
  "https://svbvawioldgundtpogkc.supabase.co",
  process.env.SUPABASE_SERVICE_KEY
);

exports.handler = async (event) => {
  try {
    const body = JSON.parse(event.body || "{}");
    const { title, message, url, type } = body;

    let query = supabase.from("push_subscriptions").select("*");

    // 특정 대상 / 발신자 제외
    if (body.to) query = query.eq("employee_number", String(body.to));
    if (body.from) query = query.neq("employee_number", String(body.from));

    // ── 알림 종류별 필터 ──
    // 공지(notice)·긴급(urgent)·조합일정(event)은 "중요 알림"이라
    // 사용자 설정과 무관하게 무조건 전체 발송한다. (필터 없음)
    // comment·inquiry는 본인(to)에게만 가므로 추가 필터 없음.
    // 그 외(swap·vote)는 사용자 설정대로 발송한다.
    if (type === "swap") query = query.eq("notify_swap", true);
    else if (type === "vote") query = query.eq("notify_vote", true);

    const { data: subs, error } = await query;
    if (error) return { statusCode: 500, body: JSON.stringify({ error: error.message }) };

    const payload = JSON.stringify({
      title: title || "MODALINK",
      body: message || "",
      url: url || "/",
    });

    let sent = 0;
    let failed = 0;
    for (const s of subs || []) {
      const sub = {
        endpoint: s.endpoint,
        keys: { p256dh: s.p256dh, auth: s.auth },
      };
      try {
        await webpush.sendNotification(sub, payload);
        sent++;
      } catch (e) {
        failed++;
        if (e.statusCode === 404 || e.statusCode === 410) {
          await supabase.from("push_subscriptions").delete().eq("endpoint", s.endpoint);
        }
      }
    }

    return { statusCode: 200, body: JSON.stringify({ sent, failed, total: (subs || []).length }) };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: String(e) }) };
  }
};
