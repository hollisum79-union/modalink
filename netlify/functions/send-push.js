const webpush = require("web-push");
const { createClient } = require("@supabase/supabase-js");

// [2026-07 수정] 문제 2개를 고침:
//   ① 152명에게 한 명씩 순서대로(await) 발송 → Netlify 10초 제한에 걸려
//      앞사람 일부만 받고 나머지는 발송 자체가 안 됐음.
//      → 한꺼번에(병렬) 발송. 152명이어도 1~2초.
//   ② urgency 미설정(기본 normal) → Apple이 배터리 절약으로 배달을 미뤄뒀다가
//      기기가 깨어날 때(앱 열 때) 몰아서 줌. "접속할 때 알림 옴"의 원인.
//      → urgency: "high" + TTL 24시간.

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

    // 즉시 배달 + 24시간 안에 못 주면 버림 (묵은 알림이 나중에 몰려오는 것 방지)
    const pushOptions = { TTL: 60 * 60 * 24, urgency: "high" };

    // 전원에게 "한꺼번에" 발송 (한 명씩 기다리지 않음)
    const results = await Promise.allSettled(
      (subs || []).map((s) =>
        webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          payload,
          pushOptions
        )
      )
    );

    // 결과 집계 + 죽은 구독(404/410) 정리
    let sent = 0;
    let failed = 0;
    const deadEndpoints = [];
    results.forEach((r, i) => {
      if (r.status === "fulfilled") {
        sent++;
      } else {
        failed++;
        const code = r.reason && r.reason.statusCode;
        if ((code === 404 || code === 410) && subs[i]) deadEndpoints.push(subs[i].endpoint);
      }
    });
    if (deadEndpoints.length > 0) {
      await supabase.from("push_subscriptions").delete().in("endpoint", deadEndpoints);
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ sent, failed, total: (subs || []).length, cleaned: deadEndpoints.length }),
    };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: String(e) }) };
  }
};
