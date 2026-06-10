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

    const proj = "https://svbvawioldgundtpogkc.supabase.co/rest/v1";
    const emp = encodeURIComponent(String(employee_number).trim());
    const auth = { apikey: key, Authorization: "Bearer " + key };

    const memResp = await fetch(
      proj + "/members?employee_number=eq." + emp +
      "&name=eq." + encodeURIComponent(String(name).trim()) +
      "&select=employee_number",
      { headers: auth }
    );
    if (!memResp.ok) {
      const t = await memResp.text();
      return { statusCode: 200, headers, body: JSON.stringify({ result: "server", detail: "mem " + memResp.status + ": " + t }) };
    }
    const memRows = await memResp.json();
    if (!Array.isArray(memRows) || memRows.length === 0) {
      return { statusCode: 200, headers, body: JSON.stringify({ result: "not_found" }) };
    }

    const authResp = await fetch(
      proj + "/member_auth?employee_number=eq." + emp + "&select=*",
      { headers: auth }
    );
    if (!authResp.ok) {
      const t = await authResp.text();
      return { statusCode: 200, headers, body: JSON.stringify({ result: "server", detail: "auth " + authResp.status + ": " + t }) };
    }
    const authRows = await authResp.json();
    const cred = Array.isArray(authRows) && authRows.length > 0 ? authRows[0] : null;
    if (!cred || cred.password !== current_password) {
      return { statusCode: 200, headers, body: JSON.stringify({ result: "wrong_password" }) };
    }

    const patchResp = await fetch(proj + "/member_auth?employee_number=eq." + emp, {
      method: "PATCH",
      headers: {
        apikey: key,
        Authorization: "Bearer " + key,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify({ password: new_password, is_temp_password: false }),
    });
    if (!patchResp.ok) {
      const t = await patchResp.text();
      return { statusCode: 200, headers, body: JSON.stringify({ result: "server", detail: "patch " + patchResp.status + ": " + t }) };
    }

    return { statusCode: 200, headers, body: JSON.stringify({ result: "ok" }) };
  } catch (e) {
    return { statusCode: 200, headers, body: JSON.stringify({ result: "server", detail: "catch: " + String(e && e.message ? e.message : e) }) };
  }
};
