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

    const base = "https://svbvawioldgundtpogkc.supabase.co/rest/v1/members";
    const q =
      "?employee_number=eq." + encodeURIComponent(String(employee_number).trim()) +
      "&name=eq." + encodeURIComponent(String(name).trim()) +
      "&select=*";

    const resp = await fetch(base + q, {
      headers: {
        apikey: key,
        Authorization: "Bearer " + key,
      },
    });

    if (!resp.ok) {
      const t = await resp.text();
      return { statusCode: 200, headers, body: JSON.stringify({ result: "server", detail: "db " + resp.status + ": " + t }) };
    }

    const rows = await resp.json();
    const member = Array.isArray(rows) && rows.length > 0 ? rows[0] : null;

    if (!member) {
      return { statusCode: 200, headers, body: JSON.stringify({ result: "not_found" }) };
    }
    if (member.status === "대기") {
      return { statusCode: 200, headers, body: JSON.stringify({ result: "pending" }) };
    }
    if (member.status === "차단") {
      return { statusCode: 200, headers, body: JSON.stringify({ result: "blocked" }) };
    }
    if (!member.password) {
      return { statusCode: 200, headers, body: JSON.stringify({ result: "no_password" }) };
    }
    if (member.password !== password) {
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
        is_temp_password: !!member.is_temp_password,
      }),
    };
  } catch (e) {
    return { statusCode: 200, headers, body: JSON.stringify({ result: "server", detail: "catch: " + String(e && e.message ? e.message : e) }) };
  }
};
