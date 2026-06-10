const { createClient } = require("@supabase/supabase-js");

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

    const supabase = createClient(
      "https://svbvawioldgundtpogkc.supabase.co",
      process.env.SUPABASE_SERVICE_ROLE
    );

    const { data: member, error } = await supabase
      .from("members")
      .select("*")
      .eq("employee_number", String(employee_number).trim())
      .eq("name", String(name).trim())
      .maybeSingle();

    if (error) {
      return { statusCode: 200, headers, body: JSON.stringify({ result: "server", detail: error.message }) };
    }
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
    return { statusCode: 200, headers, body: JSON.stringify({ result: "server", detail: String(e && e.message ? e.message : e) }) };
  }
};
