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
    if (type === "notice") query = query.eq("notify_notice", true);
    else if (type === "swap") query = query.eq("notify_swap", true);
    else if (type === "vote") query = query.eq("notify_vote", true);
    else if (type === "urgent") query = query.eq("notify_urgent", true);

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
