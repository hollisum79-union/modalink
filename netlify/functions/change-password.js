exports.handler = async (event) => {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers, body: "" };
  }
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers, body: JSON.stringify({ result: "method" }) };
  }

  try {
    const { employee_number, name, current_password, new_password } = JSON.parse(event.body || "{}");
    if (!employee_number || !name || !current_password || !new_password) {
      return { statusCode: 200, headers, body: JSON.stringify({ result: "missing" }) };
    }

    const key = process.env.SUPABASE_SERVICE_ROLE;
    if (!key) {
      return { statusCode: 200, headers, body: JSON.stringify({ result: "server", detail: "no_key" }) };
    }

    const root = "https://svbvawioldgundtpogkc.supabase.co/rest/v1/members";
    const emp = encodeURIComponent(String(employee_number).trim());
    const q =
      "?employee_number=eq." + emp +
      "&name=eq." + encodeURIComponent(String(name).trim()) +
      "&select=*";

    const getResp = await fetch(root + q, {
      headers: { apikey: key, Authorization: "Bearer " + key },
    });
    if (!getResp.ok) {
      const t = await getResp.text();
      return { statusCode: 200, headers, body: JSON.stringify({ result: "server", detail: "db " + getResp.status + ": " + t }) };
    }
    const rows = await getResp.json();
    const member = Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
    if (!member) {
      return { statusCode: 200, headers, body: JSON.stringify({ result: "not_found" }) };
    }
    if (member.password !== current_password) {
      return { statusCode: 200, headers, body: JSON.stringify({ result: "wrong_password" }) };
    }

    const patchResp = await fetch(root + "?employee_number=eq." + emp, {
      method: "PATCH",
      headers: {
        apikey: key,
        Authorization: "Bearer " + key,
        "Content-Type": "application/json",
        Prefer: "return=representation",
      },
      body: JSON.stringify({ password: new_password, is_temp_password: false }),
    });
    if (!patchResp.ok) {
      const t = await patchResp.text();
      return { statusCode: 200, headers, body: JSON.stringify({ result: "server", detail: "patch " + patchResp.status + ": " + t }) };
    }
    const updated = await patchResp.json();
    const m = Array.isArray(updated) && updated.length > 0 ? updated[0] : member;
    const safeMember = { ...m };
    delete safeMember.password;

    return { statusCode: 200, headers, body: JSON.stringify({ result: "ok", member: safeMember }) };
  } catch (e) {
    return { statusCode: 200, headers, body: JSON.stringify({ result: "server", detail: "catch: " + String(e && e.message ? e.message : e) }) };
  }
};
