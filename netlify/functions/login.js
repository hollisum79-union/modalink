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
    const { employee_number, name, password } = JSON.parse(event.body || "{}");
    if (!employee_number || !name || !password) {
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
      "&select=*",
      { headers: auth }
    );
    if (!memResp.ok) {
      const t = await memResp.text();
      return { statusCode: 200, headers, body: JSON.stringify({ result: "server", detail: "mem " + memResp.status + ": " + t }) };
    }
    const memRows = await memResp.json();
    const member = Array.isArray(memRows) && memRows.length > 0 ? memRows[0] : null;

    if (!member) {
      return { statusCode: 200, headers, body: JSON.stringify({ result: "not_found" }) };
    }
    if (member.status === "대기") {
      return { statusCode: 200, headers, body: JSON.stringify({ result: "pending" }) };
    }
    if (member.status === "차단") {
      return { statusCode: 200, headers, body: JSON.stringify({ result: "blocked" }) };
    }
    // 조합원 전용 — 비조합원 로그인 차단 (운용기관사 별도 접속은 추후 처리)
    if (member.is_union !== true) {
      return { statusCode: 200, headers, body: JSON.stringify({ result: "not_union" }) };
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

    if (!cred || !cred.password) {
      return { statusCode: 200, headers, body: JSON.stringify({ result: "no_password" }) };
    }
    if (cred.password !== password) {
      return { statusCode: 200, headers, body: JSON.stringify({ result: "wrong_password" }) };
    }

    const safeMember = { ...member };
    delete safeMember.password;

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        result: "ok",
        member: safeMember,
        is_temp_password: !!cred.is_temp_password,
      }),
    };
  } catch (e) {
    return { statusCode: 200, headers, body: JSON.stringify({ result: "server", detail: "catch: " + String(e && e.message ? e.message : e) }) };
  }
};
