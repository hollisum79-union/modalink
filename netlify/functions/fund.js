// 모금 fund.js
const SB_URL = process.env.SUPABASE_URL || "https://svbvawioldgundtpogkc.supabase.co";
const KEY = process.env.SUPABASE_SERVICE_ROLE || process.env.SUPABASE_SERVICE_KEY;

const BASE_HEADERS = {
  apikey: KEY,
  Authorization: "Bearer " + KEY,
  "Content-Type": "application/json",
};

async function sb(path, opt) {
  const o = opt || {};
  const res = await fetch(SB_URL + "/rest/v1/" + path, {
    method: o.method || "GET",
    headers: Object.assign({}, BASE_HEADERS, o.headers || {}),
    body: o.body ? JSON.stringify(o.body) : undefined,
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch (e) { data = text; }
  if (!res.ok) {
    throw new Error(typeof data === "string" ? data : JSON.stringify(data));
  }
  return data;
}

async function isManager(emp) {
  if (!emp) return false;
  const rows = await sb(
    "members?employee_number=eq." + encodeURIComponent(emp) + "&select=is_admin"
  );
  return !!(rows && rows[0] && rows[0].is_admin === true);
}

function ok(body) {
  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify(body),
  };
}
function fail(code, msg) {
  return {
    statusCode: code,
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify({ error: msg }),
  };
}

exports.handler = async function (event) {
  try {
    const qs = event.queryStringParameters || {};
    let body = {};
    if (event.httpMethod === "POST") {
      try { body = JSON.parse(event.body || "{}"); } catch (e) { body = {}; }
    }
    const action = qs.action || body.action || "";

    // ---------- ping ----------
    if (action === "ping") {
      const out = { hasUrl: !!SB_URL, hasKey: !!KEY };
      try {
        await sb("fund_campaigns?select=id&limit=1");
        out.db_read = true;
      } catch (e) {
        out.db_read = false;
        out.read_error = String(e.message || e);
      }
      return ok(out);
    }

    // ---------- campaignList ----------
    if (action === "campaignList") {
      const rows = await sb("fund_campaigns?select=*&order=created_at.desc");
      return ok({ campaigns: rows || [] });
    }

    // ---------- campaignCreate ----------
    if (action === "campaignCreate") {
      const mgr = await isManager(body.employee_number);
      if (!mgr) return fail(403, "manager only");
      if (!body.title) return fail(400, "title required");
      const kind = body.kind === "fixed" ? "fixed" : "free";
      if (kind === "fixed") {
        const fa = Number(body.fixed_amount);
        if (!fa || fa <= 0) return fail(400, "fixed_amount required");
      }
      const row = {
        title: String(body.title).slice(0, 200),
        kind: kind,
        fixed_amount: kind === "fixed" ? Number(body.fixed_amount) : null,
        start_date: body.start_date || null,
        end_date: body.end_date || null,
        account_info: body.account_info || null,
        memo: body.memo || null,
        created_by: String(body.employee_number),
      };
      const ins = await sb("fund_campaigns", {
        method: "POST",
        headers: { Prefer: "return=representation" },
        body: row,
      });
      return ok({ campaign: ins && ins[0] });
    }

    // ---------- campaignStatus (open <-> closed) ----------
    if (action === "campaignStatus") {
      const mgr = await isManager(body.employee_number);
      if (!mgr) return fail(403, "manager only");
      const id = Number(body.campaign_id);
      const status = body.status === "closed" ? "closed" : "open";
      if (!id) return fail(400, "campaign_id required");
      await sb("fund_campaigns?id=eq." + id, {
        method: "PATCH",
        body: { status: status },
      });
      return ok({ done: true, status: status });
    }

    // ---------- summary (everyone) ----------
    if (action === "summary") {
      const cid = Number(qs.campaign_id || body.campaign_id);
      if (!cid) return fail(400, "campaign_id required");
      const recs = await sb(
        "fund_records?campaign_id=eq." + cid +
        "&select=employee_number,amount,action"
      );
      const perPerson = {};
      let total = 0;
      (recs || []).forEach(function (r) {
        const amt = Number(r.amount) || 0;
        const sign = r.action === "cancel" ? -1 : 1;
        total += sign * amt;
        const k = r.employee_number || "?";
        perPerson[k] = (perPerson[k] || 0) + sign * amt;
      });
      let participants = 0;
      Object.keys(perPerson).forEach(function (k) {
        if (perPerson[k] > 0) participants += 1;
      });
      const mem = await sb(
        "members?select=employee_number,name"
      );
      let memberCount = 0;
      (mem || []).forEach(function (m) {
        const nm = m.name || "";
        if (nm.indexOf("\uACB0\uC6D0") !== 0) memberCount += 1;
      });
      return ok({
        total: total,
        participants: participants,
        member_count: memberCount,
      });
    }

    // ---------- my (own records only) ----------
    if (action === "my") {
      const cid = Number(qs.campaign_id || body.campaign_id);
      const emp = qs.employee_number || body.employee_number;
      if (!cid || !emp) return fail(400, "campaign_id, employee_number required");
      const recs = await sb(
        "fund_records?campaign_id=eq." + cid +
        "&employee_number=eq." + encodeURIComponent(emp) +
        "&select=id,amount,action,paid_date,memo,created_at&order=created_at.desc"
      );
      let net = 0;
      (recs || []).forEach(function (r) {
        net += (r.action === "cancel" ? -1 : 1) * (Number(r.amount) || 0);
      });
      return ok({ records: recs || [], net: net });
    }

    // ---------- list (manager only: full records) ----------
    if (action === "list") {
      const mgr = await isManager(qs.employee_number || body.employee_number);
      if (!mgr) return fail(403, "manager only");
      const cid = Number(qs.campaign_id || body.campaign_id);
      if (!cid) return fail(400, "campaign_id required");
      const recs = await sb(
        "fund_records?campaign_id=eq." + cid +
        "&select=*&order=created_at.desc"
      );
      return ok({ records: recs || [] });
    }

    // ---------- add (manager only) ----------
    if (action === "add") {
      const mgr = await isManager(body.employee_number);
      if (!mgr) return fail(403, "manager only");
      const cid = Number(body.campaign_id);
      const amt = Number(body.amount);
      if (!cid) return fail(400, "campaign_id required");
      if (!body.target_employee_number) return fail(400, "target required");
      if (!amt || amt <= 0) return fail(400, "amount must be > 0");
      const row = {
        campaign_id: cid,
        employee_number: String(body.target_employee_number),
        member_name: body.member_name || null,
        amount: amt,
        action: "add",
        paid_date: body.paid_date || null,
        memo: body.memo || null,
        created_by: String(body.employee_number),
      };
      const ins = await sb("fund_records", {
        method: "POST",
        headers: { Prefer: "return=representation" },
        body: row,
      });
      return ok({ record: ins && ins[0] });
    }

    // ---------- cancel (manager only, append cancel row) ----------
    if (action === "cancel") {
      const mgr = await isManager(body.employee_number);
      if (!mgr) return fail(403, "manager only");
      const cid = Number(body.campaign_id);
      const amt = Number(body.amount);
      if (!cid) return fail(400, "campaign_id required");
      if (!body.target_employee_number) return fail(400, "target required");
      if (!amt || amt <= 0) return fail(400, "amount must be > 0");
      const row = {
        campaign_id: cid,
        employee_number: String(body.target_employee_number),
        member_name: body.member_name || null,
        amount: amt,
        action: "cancel",
        paid_date: body.paid_date || null,
        memo: body.memo || null,
        created_by: String(body.employee_number),
      };
      const ins = await sb("fund_records", {
        method: "POST",
        headers: { Prefer: "return=representation" },
        body: row,
      });
      return ok({ record: ins && ins[0] });
    }

    return fail(400, "unknown action");
  } catch (e) {
    return fail(500, String((e && e.message) || e));
  }
};
