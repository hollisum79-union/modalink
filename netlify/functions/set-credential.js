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
    const { employee_number, password, is_temp_password } = JSON.parse(event.body || "{}");
    if (!employee_number || !password) {
      return { statusCode: 200, headers, body: JSON.stringify({ result: "missing" }) };
    }

    const key = process.env.SUPABASE_SERVICE_ROLE;
    if (!key) {
      return { statusCode: 200, headers, body: JSON.stringify({ result: "server", detail: "no_key" }) };
    }

    const proj = "https://svbvawioldgundtpogkc.supabase.co/rest/v1";
    const resp = await fetch(proj + "/member_auth", {
      method: "POST",
      headers: {
        apikey: key,
        Authorization: "Bearer " + key,
        "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates,return=minimal",
      },
      body: JSON.stringify({
        employee_number: String(employee_number).trim(),
        password: String(password),
        is_temp_password: is_temp_password === false ? false : true,
      }),
    });
    if (!resp.ok) {
      const t = await resp.text();
      return { statusCode: 200, headers, body: JSON.stringify({ result: "server", detail: "auth " + resp.status + ": " + t }) };
    }

    return { statusCode: 200, headers, body: JSON.stringify({ result: "ok" }) };
  } catch (e) {
    return { statusCode: 200, headers, body: JSON.stringify({ result: "server", detail: "catch: " + String(e && e.message ? e.message : e) }) };
  }
};
